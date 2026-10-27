/**
 * @file metricas.service.js
 * @description Calcular las métricas del proyecto consultando PostgreSQL.
 * Todas las consultas están escritas contra database/schema.sql (versión 2):
 *   - Una tarea está "Hecha" cuando su columna del tablero tiene es_final = TRUE
 *     (tareas.columna_id -> columnas_tablero.es_final). La tabla tareas NO tiene columna "estado".
 *   - Un impedimento es crítico cuando su severidad es 'alta' (impedimentos.severidad).
 *   - Las horas reales se guardan en registros_horas (una fila por registro de tiempo).
 *   - La velocity se calcula con las decisiones de Review (reviews_historias), no con historias.estado,
 *     porque una historia rechazada regresa al backlog y perdería su sprint de origen.
 * @author Dana
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * Cantidad de sprints que abarca el promedio móvil de la velocity (HU-30).
 * Cambiar este número ajusta la ventana en toda la aplicación.
 */
export const VENTANA_PROMEDIO = 3;

/**
 * Ejecutar una consulta SQL parametrizada y devolver sus filas.
 * Aislar aquí el driver para facilitar un cambio de base de datos.
 * Usar siempre parámetros ($1, $2...) para prevenir inyección SQL.
 *
 * @param {string} sql Consulta con marcadores $1, $2...
 * @param {Array} [params] Valores de los marcadores.
 * @returns {Promise<Array<Object>>} Filas resultantes.
 */
async function consultar(sql, params = []) {
  const { rows } = await consulta(sql, params);
  return rows;
}

/**
 * Redondear un número a un decimal.
 * Convertir con Number() porque pg devuelve NUMERIC como texto.
 *
 * @param {string|number} valor Número o texto numérico.
 * @returns {number} Número con un decimal.
 */
const aUnDecimal = (valor) => Math.round(Number(valor) * 10) / 10;

// ===========================================================================
// Acceso: solo los integrantes del proyecto pueden ver sus métricas
// ===========================================================================

/**
 * Verificar que el usuario autenticado sea un integrante activo del proyecto.
 * Lanzar 403 si no lo es (también cuando el proyecto no existe, para no revelar su existencia).
 * NOTA: cuando HU-42 (requiereRol) y HU-43 (aislamiento por equipo) estén listas,
 * sustituir esta función por sus middlewares.
 *
 * @param {number} usuarioId Identificador del usuario (req.user.id).
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<string>} Rol del usuario en el proyecto.
 * @throws {ErrorApp} 401 sin sesión válida, 403 si no pertenece al proyecto.
 */
export async function exigirIntegranteProyecto(usuarioId, proyectoId) {
  if (!usuarioId) throw new ErrorApp('No has iniciado sesión.', 401);

  const [fila] = await consultar(
    `SELECT mp.rol
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id AND u.activo = TRUE
      WHERE mp.proyecto_id = $1 AND mp.usuario_id = $2`,
    [proyectoId, usuarioId],
  );
  if (!fila) throw new ErrorApp('No tienes acceso a este proyecto.', 403);
  return fila.rol;
}

/**
 * Listar los proyectos (no archivados) a los que pertenece el usuario, con su rol en cada uno.
 * La página de métricas lo usa para elegir el proyecto cuando la URL no trae ?proyecto=.
 *
 * @param {number} usuarioId Identificador del usuario (req.user.id).
 * @returns {Promise<Array<{id: number, nombre: string, rol: string}>>}
 * @throws {ErrorApp} 401 si no hay sesión válida.
 */
export async function listarMisProyectos(usuarioId) {
  if (!usuarioId) throw new ErrorApp('No has iniciado sesión.', 401);

  return consultar(
    `SELECT p.id, p.nombre, mp.rol
       FROM miembros_proyecto mp
       JOIN proyectos p ON p.id = mp.proyecto_id AND p.archivado = FALSE
       JOIN usuarios u  ON u.id = mp.usuario_id AND u.activo = TRUE
      WHERE mp.usuario_id = $1
      ORDER BY p.nombre, p.id`,
    [usuarioId],
  );
}

// ===========================================================================
// HU-35: Dashboard de KPIs
// ===========================================================================

/**
 * Calcular el avance global: porcentaje de tareas en una columna final ("Hecho") sobre el total.
 * Devolver 0 % cuando el proyecto no tiene tareas.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, hechas: number, total: number}>}
 */
async function avanceGlobal(proyectoId) {
  const [fila] = await consultar(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE c.es_final)::int AS hechas
       FROM tareas t
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE t.proyecto_id = $1`,
    [proyectoId],
  );
  const { total, hechas } = fila;
  return { valor: total ? Math.round((hechas / total) * 100) : 0, hechas, total };
}

/**
 * Calcular los días restantes del sprint activo.
 * Devolver valor null cuando no hay sprint activo (el cliente muestra "—").
 * Restar las fechas en SQL (DATE - DATE = días enteros) para evitar errores de zona horaria,
 * y limitar el resultado a 0 cuando la fecha de fin ya pasó.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number|null}>}
 */
async function diasRestantes(proyectoId) {
  const [sprint] = await consultar(
    `SELECT GREATEST(fecha_fin - CURRENT_DATE, 0)::int AS dias
       FROM sprints
      WHERE proyecto_id = $1 AND estado = 'activo'
      LIMIT 1`,
    [proyectoId],
  );
  return { valor: sprint ? sprint.dias : null };
}

/**
 * Contar los impedimentos abiertos y cuántos de ellos son críticos (severidad 'alta').
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, criticos: number}>}
 */
async function impedimentosAbiertos(proyectoId) {
  const [fila] = await consultar(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE severidad = 'alta')::int AS criticos
       FROM impedimentos
      WHERE proyecto_id = $1 AND estado = 'abierto'`,
    [proyectoId],
  );
  return { valor: fila.total, criticos: fila.criticos };
}

/**
 * Calcular la desviación acumulada: horas reales (registros_horas) menos horas estimadas (tareas).
 * Interpretar un valor negativo como "bajo presupuesto" y uno positivo como "sobre presupuesto".
 * Resolver ambas sumas en una sola consulta para ahorrar un viaje a la base de datos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, estimado: number, real: number}>}
 */
async function desviacionAcumulada(proyectoId) {
  const [fila] = await consultar(
    `SELECT COALESCE((SELECT SUM(horas_estimadas) FROM tareas WHERE proyecto_id = $1), 0) AS estimado,
            COALESCE((SELECT SUM(r.horas)
                        FROM registros_horas r
                        JOIN tareas t ON t.id = r.tarea_id
                       WHERE t.proyecto_id = $1), 0) AS real`,
    [proyectoId],
  );
  const estimado = aUnDecimal(fila.estimado);
  const real = aUnDecimal(fila.real);
  return { valor: aUnDecimal(real - estimado), estimado, real };
}

/**
 * Determinar si el proyecto es nuevo y no tiene historias, tareas, sprints ni impedimentos.
 * Usar EXISTS para detenerse en cuanto aparece el primer dato.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<boolean>} true si no existe ningún dato.
 */
async function proyectoVacio(proyectoId) {
  const [fila] = await consultar(
    `SELECT NOT (
              EXISTS (SELECT 1 FROM historias     WHERE proyecto_id = $1)
           OR EXISTS (SELECT 1 FROM tareas        WHERE proyecto_id = $1)
           OR EXISTS (SELECT 1 FROM sprints       WHERE proyecto_id = $1)
           OR EXISTS (SELECT 1 FROM impedimentos  WHERE proyecto_id = $1)
            ) AS vacio`,
    [proyectoId],
  );
  return fila.vacio;
}

/**
 * Calcular todos los KPIs del dashboard en paralelo.
 * Usar Promise.allSettled para aislar fallos: si un cálculo falla,
 * devolver { error: true } solo en ese KPI y entregar los demás normalmente.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{vacio: boolean, kpis: Object, tiempoMs: number}>}
 */
export async function obtenerKpisDashboard(proyectoId) {
  const inicio = Date.now();
  const nombres = ['vacio', 'avance', 'diasRestantes', 'impedimentos', 'desviacion'];

  const resultados = await Promise.allSettled([
    proyectoVacio(proyectoId),
    avanceGlobal(proyectoId),
    diasRestantes(proyectoId),
    impedimentosAbiertos(proyectoId),
    desviacionAcumulada(proyectoId),
  ]);

  // Registrar en consola qué indicador falló para poder depurarlo
  resultados.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[metricas] Falló el KPI "${nombres[i]}":`, r.reason?.message);
  });

  const elegir = (r) => (r.status === 'fulfilled' ? r.value : { error: true });
  const [vacio, avance, dias, impedimentos, desviacion] = resultados;

  return {
    // Si no se pudo saber si está vacío, mostrar los indicadores (cada uno indicará su propio error)
    vacio: vacio.status === 'fulfilled' ? vacio.value : false,
    kpis: {
      avance: elegir(avance),
      diasRestantes: elegir(dias),
      impedimentos: elegir(impedimentos),
      desviacion: elegir(desviacion),
    },
    tiempoMs: Date.now() - inicio,
  };
}

// ===========================================================================
// HU-30: Velocity por sprint
// ===========================================================================

/**
 * Calcular el promedio móvil de una serie de valores.
 * Para cada posición promediar los últimos "ventana" valores; si todavía no hay
 * tantos (primeros sprints), promediar los disponibles e informar cuántos se usaron.
 * Función pura: no consulta la base de datos, por lo que es fácil de probar.
 *
 * @param {number[]} valores Serie ordenada del más antiguo al más reciente.
 * @param {number} [ventana=VENTANA_PROMEDIO] Tamaño máximo de la ventana.
 * @returns {Array<{promedio: number, muestras: number}>} Un elemento por cada valor de entrada.
 */
export function calcularPromedioMovil(valores, ventana = VENTANA_PROMEDIO) {
  return valores.map((_, i) => {
    const tramo = valores.slice(Math.max(0, i - ventana + 1), i + 1);
    const suma = tramo.reduce((acum, v) => acum + v, 0);
    return { promedio: aUnDecimal(suma / tramo.length), muestras: tramo.length };
  });
}

/**
 * Obtener la velocity de cada sprint cerrado del proyecto.
 * Sumar solo los puntos de las historias ACEPTADAS en el Review del sprint;
 * las rechazadas no suman (se cuentan aparte solo para informar).
 * Agregar la línea de promedio móvil y los avisos de ventana incompleta.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{vacio: boolean, ventana: number, ventanaIncompleta: boolean,
 *   promedioActual: number|null, sprints: Array<Object>}>}
 */
export async function obtenerVelocity(proyectoId) {
  const filas = await consultar(
    `SELECT s.id, s.nombre,
            s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin, -- 'AAAA-MM-DD' sin zona horaria
            COALESCE(SUM(h.puntos) FILTER (WHERE r.decision = 'aceptada'), 0)::int AS puntos,
            COUNT(r.id) FILTER (WHERE r.decision = 'aceptada')::int  AS aceptadas,
            COUNT(r.id) FILTER (WHERE r.decision = 'rechazada')::int AS rechazadas
       FROM sprints s
       LEFT JOIN reviews_historias r ON r.sprint_id = s.id
       LEFT JOIN historias h         ON h.id = r.historia_id
      WHERE s.proyecto_id = $1 AND s.estado = 'cerrado'
      GROUP BY s.id
      ORDER BY s.fecha_fin, s.id`,
    [proyectoId],
  );

  // Sin sprints cerrados no hay nada que graficar: el cliente muestra el mensaje de "sin datos"
  if (filas.length === 0) {
    return { vacio: true, ventana: VENTANA_PROMEDIO, ventanaIncompleta: false, promedioActual: null, sprints: [] };
  }

  const promedios = calcularPromedioMovil(filas.map((f) => f.puntos));
  const sprints = filas.map((f, i) => ({
    id: f.id,
    nombre: f.nombre,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    puntos: f.puntos,
    aceptadas: f.aceptadas,
    rechazadas: f.rechazadas,
    promedioMovil: promedios[i].promedio,
    muestras: promedios[i].muestras, // cuántos sprints entraron al promedio de este punto
  }));

  return {
    vacio: false,
    ventana: VENTANA_PROMEDIO,
    // Hay menos sprints cerrados que la ventana: avisar que el promedio usa los disponibles
    ventanaIncompleta: sprints.length < VENTANA_PROMEDIO,
    promedioActual: sprints[sprints.length - 1].promedioMovil,
    sprints,
  };
}

// ===========================================================================
// HU-31: Porcentaje de avance por persona y por equipo
// ===========================================================================

/**
 * Armar el resumen de avance de una persona (o del equipo) a partir de sus horas.
 * Reglas:
 *   - porcentaje = horas estimadas en "Hecho" / horas estimadas asignadas.
 *   - Sin tareas        -> estado 'sin_tareas'  (porcentaje null, no es un error).
 *   - Solo tareas sin estimar -> estado 'sin_estimar' (porcentaje null).
 *   - Las tareas sin horas estimadas no cuentan en el cálculo; solo se informan.
 *
 * @param {{tareas: number, sinEstimar: number, horasAsignadas: number, horasHechas: number}} datos
 * @returns {{estado: string, porcentaje: number|null, tareas: number, tareasSinEstimar: number,
 *   horasAsignadas: number, horasHechas: number}}
 */
function resumirAvance({ tareas, sinEstimar, horasAsignadas, horasHechas }) {
  let estado = 'normal';
  let porcentaje = null;

  if (tareas === 0) estado = 'sin_tareas';
  else if (horasAsignadas <= 0) estado = 'sin_estimar';
  else porcentaje = Math.round((horasHechas / horasAsignadas) * 100);

  return {
    estado,
    porcentaje,
    tareas,
    tareasSinEstimar: sinEstimar,
    horasAsignadas: aUnDecimal(horasAsignadas),
    horasHechas: aUnDecimal(horasHechas),
  };
}

/**
 * Obtener el avance por persona y por equipo del proyecto (opcionalmente de un solo sprint).
 * Incluir a los integrantes actuales aunque no tengan tareas, y también a quienes ya fueron
 * dados de baja pero conservan tareas, para no perder el histórico (se marcan con baja: true).
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number|null} [sprintId] Sprint a filtrar; null o ausente = todo el proyecto.
 * @returns {Promise<{equipo: Object, personas: Array<Object>, sprints: Array<Object>,
 *   sprintId: number|null, tareasSinResponsable: number}>}
 * @throws {ErrorApp} 404 si el sprint no pertenece al proyecto.
 */
export async function obtenerAvance(proyectoId, sprintId = null) {
  // Validar que el sprint solicitado sea de este proyecto (evita leer datos de otro proyecto)
  const sprints = await consultar(
    `SELECT id, nombre, estado FROM sprints WHERE proyecto_id = $1 ORDER BY fecha_inicio, id`,
    [proyectoId],
  );
  if (sprintId !== null && !sprints.some((s) => s.id === sprintId)) {
    throw new ErrorApp('El sprint indicado no pertenece a este proyecto.', 404);
  }

  const [porPersona, integrantes, [equipoFila], [sinResp]] = await Promise.all([
    // Horas por responsable. Se une con usuarios (no con miembros_proyecto) para conservar a las bajas.
    consultar(
      `SELECT t.responsable_id AS usuario_id, u.nombre, u.activo, mp.rol,
              COUNT(*)::int                                          AS tareas,
              COUNT(*) FILTER (WHERE t.horas_estimadas IS NULL)::int AS sin_estimar,
              COALESCE(SUM(t.horas_estimadas), 0)                    AS horas_asignadas,
              COALESCE(SUM(t.horas_estimadas) FILTER (WHERE c.es_final), 0) AS horas_hechas
         FROM tareas t
         JOIN usuarios u ON u.id = t.responsable_id
         LEFT JOIN miembros_proyecto mp ON mp.proyecto_id = t.proyecto_id AND mp.usuario_id = u.id
         LEFT JOIN columnas_tablero c   ON c.id = t.columna_id
        WHERE t.proyecto_id = $1 AND ($2::int IS NULL OR t.sprint_id = $2)
        GROUP BY t.responsable_id, u.nombre, u.activo, mp.rol`,
      [proyectoId, sprintId],
    ),
    // Integrantes actuales (para mostrar "Sin tareas" a quien no tenga ninguna)
    consultar(
      `SELECT u.id AS usuario_id, u.nombre, mp.rol
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id AND u.activo = TRUE
        WHERE mp.proyecto_id = $1`,
      [proyectoId],
    ),
    consultar(
      `SELECT e.id, e.nombre
         FROM proyectos p JOIN equipos e ON e.id = p.equipo_id
        WHERE p.id = $1`,
      [proyectoId],
    ),
    // Tareas sin responsable: no entran al avance por persona, pero se informan
    consultar(
      `SELECT COUNT(*)::int AS total
         FROM tareas
        WHERE proyecto_id = $1 AND responsable_id IS NULL AND ($2::int IS NULL OR sprint_id = $2)`,
      [proyectoId, sprintId],
    ),
  ]);

  // Combinar integrantes actuales con quienes tienen tareas (incluidas las bajas)
  const mapa = new Map();
  for (const i of integrantes) {
    mapa.set(i.usuario_id, {
      usuarioId: i.usuario_id, nombre: i.nombre, rol: i.rol, baja: false,
      datos: { tareas: 0, sinEstimar: 0, horasAsignadas: 0, horasHechas: 0 },
    });
  }
  for (const f of porPersona) {
    const persona = mapa.get(f.usuario_id) || {
      usuarioId: f.usuario_id, nombre: f.nombre, rol: f.rol || null,
      // Baja: la cuenta está inactiva o ya no pertenece al proyecto
      baja: !f.activo || !f.rol, datos: null,
    };
    persona.datos = {
      tareas: f.tareas,
      sinEstimar: f.sin_estimar,
      horasAsignadas: Number(f.horas_asignadas),
      horasHechas: Number(f.horas_hechas),
    };
    mapa.set(f.usuario_id, persona);
  }

  const personas = [...mapa.values()]
    .map((p) => ({ usuarioId: p.usuarioId, nombre: p.nombre, rol: p.rol, baja: p.baja, ...resumirAvance(p.datos) }))
    // Primero activos, luego por nombre
    .sort((a, b) => Number(a.baja) - Number(b.baja) || a.nombre.localeCompare(b.nombre, 'es'));

  // El equipo consolida exactamente las mismas tareas asignadas que se muestran por persona
  const totales = personas.reduce(
    (acum, p) => ({
      tareas: acum.tareas + p.tareas,
      sinEstimar: acum.sinEstimar + p.tareasSinEstimar,
      horasAsignadas: acum.horasAsignadas + p.horasAsignadas,
      horasHechas: acum.horasHechas + p.horasHechas,
    }),
    { tareas: 0, sinEstimar: 0, horasAsignadas: 0, horasHechas: 0 },
  );

  return {
    sprintId,
    sprints,
    equipo: { id: equipoFila?.id ?? null, nombre: equipoFila?.nombre ?? '', ...resumirAvance(totales) },
    personas,
    tareasSinResponsable: sinResp.total,
  };
}