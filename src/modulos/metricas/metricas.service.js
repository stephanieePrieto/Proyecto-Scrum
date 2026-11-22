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
 * 
 * @author Dana Carmona Santamaria
 * @author Citlaly Morales Viveros
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { exigirPermiso } from '../../utils/permisos.js';
import { randomUUID } from 'node:crypto';
import { generarPdf } from './metricas.pdf.js';
import { evaluarDesviacionTarea, evaluarUmbral } from '../desviacion/desviacion.alertas.js';

/**
 * Cantidad de sprints que abarca el promedio móvil de la velocity (HU-30).
 * Cambiar este número ajusta la ventana en toda la aplicación.
 */
export const VENTANA_PROMEDIO = 3;

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

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
 * Lanzar 404 si no lo es (también cuando el proyecto no existe, para no revelar su existencia).
 * NOTA: el acceso ya se decide con la matriz de permisos (exigirPermiso, clave proyecto.ver),
 * que exige seguir en el equipo dueño del proyecto.
 *
 * @param {number} usuarioId Identificador del usuario (req.user.id).
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<string>} Rol del usuario en el proyecto.
 * @throws {ErrorApp} 401 sin sesión válida, 404 si no tiene vínculo con el equipo del proyecto o el proyecto no existe.
 */
export async function exigirIntegranteProyecto(usuarioId, proyectoId) {
  if (!usuarioId) throw new ErrorApp('No has iniciado sesión.', 401);

  // Un identificador mal formado se rechaza antes de consultar la base de datos
  const id = typeof proyectoId === 'string' && !/^\d+$/.test(proyectoId.trim()) ? NaN : Number(proyectoId);
  if (!Number.isInteger(id) || id <= 0 || id > ENTERO_MAXIMO) {
    throw new ErrorApp('El identificador del proyecto no es válido.', 400);
  }

  // Quien no tiene vínculo vigente con el equipo del proyecto recibe 404, igual que si el proyecto no existiera
  return exigirPermiso({ id: usuarioId }, 'proyecto.ver', id);
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

  // Los proyectos salen de los equipos de la persona; el rol queda en null si todavía no tiene uno asignado
  return consultar(
    `SELECT p.id, p.nombre, mp.rol
       FROM miembros_equipo me
       JOIN usuarios u ON u.id = me.usuario_id AND u.activo = TRUE
       JOIN proyectos p ON p.equipo_id = me.equipo_id AND p.archivado = FALSE
       LEFT JOIN miembros_proyecto mp ON mp.proyecto_id = p.id AND mp.usuario_id = me.usuario_id
      WHERE me.usuario_id = $1
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
 * Ahora segmentado por "míos" (los del usuario logueado) y "todos" los del proyecto.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Identificador del usuario actual.
 * @returns {Promise<{mios: Object, todos: Object}>}
 */
async function impedimentosAbiertos(proyectoId, usuarioId) {
  const [filaMios] = await consultar(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE severidad = 'alta')::int AS criticos
       FROM impedimentos
      WHERE proyecto_id = $1 AND estado = 'abierto' AND responsable_id = $2`,
    [proyectoId, usuarioId],
  );

  const [filaTodos] = await consultar(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE severidad = 'alta')::int AS criticos
       FROM impedimentos
      WHERE proyecto_id = $1 AND estado = 'abierto'`,
    [proyectoId],
  );

  return {
    mios: { valor: filaMios.total, criticos: filaMios.criticos },
    todos: { valor: filaTodos.total, criticos: filaTodos.criticos }
  };
}

/**
 * Calcular la desviación acumulada: horas reales (registros_horas) menos horas estimadas (tareas).
 * Interpretar un valor negativo como "bajo presupuesto" y uno positivo como "sobre presupuesto".
 * Resolver ambas sumas en una sola consulta para ahorrar un viaje a la base de datos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, estimado: number, real: number, superaUmbral: boolean, umbral: number}>}
 */
async function desviacionAcumulada(proyectoId) {
  const [fila] = await consultar(
    `SELECT p.umbral_desviacion,
            COALESCE((SELECT SUM(horas_estimadas) FROM tareas WHERE proyecto_id = $1), 0) AS estimado,
            COALESCE((SELECT SUM(r.horas)
                        FROM registros_horas r
                        JOIN tareas t ON t.id = r.tarea_id
                       WHERE t.proyecto_id = $1), 0) AS real
       FROM proyectos p WHERE p.id = $1`,
    [proyectoId],
  );
  const estimado = aUnDecimal(fila.estimado);
  const real = aUnDecimal(fila.real);
  const valor = aUnDecimal(real - estimado);

  // HU-33: Alertas por desviación (Evaluación contra el umbral)
  const porcentajeDesviacion = estimado > 0 ? Math.abs((valor / estimado) * 100) : 0;
  const superaUmbral = porcentajeDesviacion > fila.umbral_desviacion;
  const tareasUmbral = await consultar(
    `SELECT t.horas_estimadas::float AS estimadas, COALESCE(c.es_final, FALSE) AS terminada,
            COALESCE((SELECT SUM(r.horas) FROM registros_horas r WHERE r.tarea_id = t.id), 0)::float AS reales
       FROM tareas t LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE t.proyecto_id = $1 AND t.horas_estimadas > 0`,
    [proyectoId],
  );
  const tareasEnAlerta = tareasUmbral.filter((t) => evaluarUmbral({ ...t, umbral: fila.umbral_desviacion }).supera).length;

  return { valor, estimado, real, superaUmbral, umbral: fila.umbral_desviacion, tareasEnAlerta };
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
 * @param {number} usuarioId Identificador del usuario.
 * @returns {Promise<{vacio: boolean, esScrumMaster: boolean, kpis: Object, tiempoMs: number}>}
 */
export async function obtenerKpisDashboard(proyectoId, usuarioId) {
  const inicio = Date.now();
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);

  const resultados = await Promise.allSettled([
    proyectoVacio(proyectoId),
    avanceGlobal(proyectoId),
    diasRestantes(proyectoId),
    impedimentosAbiertos(proyectoId, usuarioId),
    desviacionAcumulada(proyectoId),
  ]);

  // Registrar en consola qué indicador falló para poder depurarlo
  resultados.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[metricas] Falló un KPI:`, r.reason?.message);
  });

  const elegir = (r) => (r.status === 'fulfilled' ? r.value : { error: true });
  const [vacio, avance, dias, impedimentos, desviacion] = resultados;

  return {
    // Si no se pudo saber si está vacío, mostrar los indicadores (cada uno indicará su propio error)
    vacio: vacio.status === 'fulfilled' ? vacio.value : false,
    esScrumMaster: rol === 'scrum_master',
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
 * Modificado para soportar gráfica agrupada (Comprometidos vs Aceptados/Completados) y filtro individual.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number|null} usuarioIdFiltro Identificador del integrante para velocity individual.
 * @returns {Promise<{vacio: boolean, individual: boolean, ventana: number, ventanaIncompleta: boolean,
 *   promedioActual: number|null, sprints: Array<Object>}>}
 */
export async function obtenerVelocity(proyectoId, usuarioIdFiltro = null) {
  let filas;

  if (usuarioIdFiltro) {
    // Velocity individual en horas (comprometidas vs completadas)
    filas = await consultar(
      `SELECT s.id, s.nombre,
              s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
              COALESCE(SUM(t.horas_estimadas) FILTER (WHERE c.es_final), 0)::int AS puntos,
              COALESCE(SUM(t.horas_estimadas), 0)::int AS puntos_comprometidos,
              0 AS aceptadas, 0 AS rechazadas
         FROM sprints s
         LEFT JOIN tareas t ON t.sprint_id = s.id AND t.responsable_id = $2
         LEFT JOIN columnas_tablero c ON c.id = t.columna_id
        WHERE s.proyecto_id = $1 AND s.estado = 'cerrado'
        GROUP BY s.id
        ORDER BY s.fecha_fin, s.id`,
      [proyectoId, usuarioIdFiltro],
    );
  } else {
    // Velocity del equipo en puntos de historia
    filas = await consultar(
      `SELECT s.id, s.nombre,
              s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
              COALESCE(SUM(h.puntos) FILTER (WHERE r.decision = 'aceptada'), 0)::int AS puntos,
              COALESCE(SUM(h.puntos), 0)::int AS puntos_comprometidos,
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
  }

  // Sin sprints cerrados no hay nada que graficar: el cliente muestra el mensaje de "sin datos"
  if (filas.length === 0) {
    return { vacio: true, individual: !!usuarioIdFiltro, ventana: VENTANA_PROMEDIO, ventanaIncompleta: false, promedioActual: null, sprints: [] };
  }

  const promedios = calcularPromedioMovil(filas.map((f) => f.puntos));
  const sprints = filas.map((f, i) => ({
    id: f.id,
    nombre: f.nombre,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    puntos: f.puntos,
    puntosComprometidos: f.puntos_comprometidos,
    aceptadas: f.aceptadas,
    rechazadas: f.rechazadas,
    promedioMovil: promedios[i].promedio,
    muestras: promedios[i].muestras, // cuántos sprints entraron al promedio de este punto
  }));

  return {
    vacio: false,
    individual: !!usuarioIdFiltro,
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
 * Filtra los datos según el rol: El Scrum Master ve todo, los demás solo ven lo suyo.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number|null} [sprintId] Sprint a filtrar; null o ausente = todo el proyecto.
 * @param {number} usuarioId Usuario solicitando la información.
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si el sprint no pertenece al proyecto.
 */
export async function obtenerAvance(proyectoId, sprintId = null, usuarioId) {
  // Validar que el sprint solicitado sea de este proyecto (evita leer datos de otro proyecto)
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);

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
              AND EXISTS (SELECT 1 FROM proyectos p JOIN miembros_equipo me ON me.equipo_id = p.equipo_id
                           WHERE p.id = mp.proyecto_id AND me.usuario_id = mp.usuario_id)
         LEFT JOIN columnas_tablero c   ON c.id = t.columna_id
        WHERE t.proyecto_id = $1 AND ($2::int IS NULL OR t.sprint_id = $2)
        GROUP BY t.responsable_id, u.nombre, u.activo, mp.rol`,
      [proyectoId, sprintId],
    ),
    // Integrantes actuales (para mostrar "Sin tareas" a quien no tenga ninguna)
    consultar(
      `SELECT u.id AS usuario_id, u.nombre, mp.rol
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id AND (u.activo = TRUE OR u.eliminado_en IS NOT NULL)
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1`,
      [proyectoId],
    ),
    consultar(`SELECT e.id, e.nombre FROM proyectos p JOIN equipos e ON e.id = p.equipo_id WHERE p.id = $1`, [proyectoId]),
    // Tareas sin responsable: no entran al avance por persona, pero se informan
    consultar(
      `SELECT COUNT(*)::int AS total FROM tareas WHERE proyecto_id = $1 AND responsable_id IS NULL AND ($2::int IS NULL OR sprint_id = $2)`,
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
      tareas: f.tareas, sinEstimar: f.sin_estimar,
      horasAsignadas: Number(f.horas_asignadas), horasHechas: Number(f.horas_hechas),
    };
    mapa.set(f.usuario_id, persona);
  }

  let personas = [...mapa.values()]
    .map((p) => ({ usuarioId: p.usuarioId, nombre: p.nombre, rol: p.rol, baja: p.baja, ...resumirAvance(p.datos) }))
    // Primero activos, luego por nombre
    .sort((a, b) => Number(a.baja) - Number(b.baja) || a.nombre.localeCompare(b.nombre, 'es'));

  // REGLA: Si no es Scrum Master, solo ve al equipo completo y a sí mismo
  const esScrumMaster = rol === 'scrum_master';
  if (!esScrumMaster) {
    personas = personas.filter(p => p.usuarioId === usuarioId);
  }

  // El equipo consolida exactamente las mismas tareas asignadas que se muestran por persona
  const totales = porPersona.reduce(
    (acum, p) => ({
      tareas: acum.tareas + p.tareas,
      sinEstimar: acum.sinEstimar + p.sin_estimar,
      horasAsignadas: acum.horasAsignadas + Number(p.horas_asignadas),
      horasHechas: acum.horasHechas + Number(p.horas_hechas),
    }),
    { tareas: 0, sinEstimar: 0, horasAsignadas: 0, horasHechas: 0 },
  );

  return {
    sprintId, sprints,
    esScrumMaster,
    integrantesTotales: integrantes, // Para rellenar el filtro en frontend
    equipo: { id: equipoFila?.id ?? null, nombre: equipoFila?.nombre ?? '', ...resumirAvance(totales) },
    personas,
    tareasSinResponsable: sinResp.total,
  };
}

// ===========================================================================
// HU-29: Gráfica Burndown (correcciones nov 2026)
// ===========================================================================
//
// Antes el burndown era una sola serie por cierre de sprint, en horas estimadas:
// bajaba con las horas estimadas de las tareas terminadas, la línea ideal era una
// recta sintética entre cierres y no aceptaba ?sprintId (el selector de sprint de
// la página no lo movía). Ahora:
//   - Unidad 'horas': serie DIARIA del sprint (fecha_inicio..fecha_fin). La línea
//     real baja con las horas REALES registradas por día (registros_horas.fecha) y
//     la ideal es diaria, del total inicial a 0 el último día del sprint.
//   - Unidad 'puntos': serie DIARIA del sprint con los puntos de las historias.
//     Baja con los puntos ACEPTADOS en el Review cada día (reviews_historias,
//     misma regla que la velocity: una historia en 'hecho' sin Review no descuenta
//     hasta su aceptación, porque no hay fecha fiable de cuándo se terminó).
//     Además se informa puntosNoTerminados = SUM(historias.puntos) de las historias
//     del sprint en estado distinto de 'hecho'/'aceptada', para contrastar.
//   - ?sprintId: el burndown es del sprint indicado. Sin él se usa el sprint activo
//     y, si no hay ninguno, el más reciente por fecha de fin.
//   - El filtro de integrante solo aplica a 'horas' (las tareas tienen responsable;
//     las historias no). En 'puntos' se ignora y la respuesta lleva individual: false.
//   - porSprint conserva la vista general por cierre de sprint, ahora en horas y
//     en puntos, para el resumen bajo la gráfica.
//
// El quemado diario se agrupa por fecha en SQL y el cálculo de la serie lo hacen las
// funciones puras de abajo, en este mismo archivo (antes vivían en burndown.calculo.js;
// se juntaron aquí a petición de Dana, sin pruebas automatizadas).
// Las consultas de horas y de puntos van separadas a propósito: unir tareas y
// reviews en una sola consulta multiplicaría las filas y falsearía las sumas.

/** Día actual en UTC (YYYY-MM-DD), igual que el CFD en burnup.service.js. */
const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Suma días a una fecha en formato YYYY-MM-DD. Trabaja en UTC para no depender de la zona horaria.
 * Función pura (no toca la base de datos).
 */
function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Cantidad de días entre dos fechas, ambas incluidas. Si el fin es anterior al inicio, devuelve 0.
 * Función pura (no toca la base de datos).
 */
function diasEntre(inicio, fin) {
  const d0 = new Date(`${inicio}T00:00:00Z`);
  const d1 = new Date(`${fin}T00:00:00Z`);
  const dias = Math.round((d1 - d0) / 86400000) + 1;
  return dias > 0 ? dias : 0;
}

/**
 * Serie ideal diaria: del total inicial el primer día a 0 el último día, en línea recta.
 * Con un sprint de un solo día no hay recta que trazar: ese día el ideal es el total inicial.
 * Función pura (no toca la base de datos).
 *
 * @param {number} total Trabajo inicial del sprint (horas estimadas o puntos).
 * @param {string} fechaInicio Primer día del sprint (YYYY-MM-DD).
 * @param {string} fechaFin Último día del sprint (YYYY-MM-DD).
 * @returns {Array<{fecha: string, ideal: number}>} Un punto por día del sprint.
 */
function serieIdealDiaria(total, fechaInicio, fechaFin) {
  const n = diasEntre(fechaInicio, fechaFin);
  if (n === 0) return [];
  const totalNum = aUnDecimal(total);
  if (n === 1) return [{ fecha: fechaInicio, ideal: totalNum }];
  const paso = totalNum / (n - 1);
  const serie = [];
  for (let i = 0; i < n; i++) {
    serie.push({ fecha: sumarDias(fechaInicio, i), ideal: aUnDecimal(Math.max(0, totalNum - i * paso)) });
  }
  return serie;
}

/**
 * Serie diaria del burndown de UN sprint, con la línea real (quemado por día) y la ideal.
 * La línea real solo baja con el quemado que se le pasa por día (horas reales registradas
 * o puntos aceptados en Review): sin quemado, no baja. El restante nunca es negativo y
 * los días futuros (después de hoy) llevan restante null. El quemado anterior al inicio
 * del sprint ya cuenta en el primer día; el posterior al fin no entra en la serie.
 * Función pura (no toca la base de datos).
 *
 * @param {Object} datos
 * @param {number} datos.total Trabajo inicial del sprint (horas estimadas o puntos).
 * @param {string} datos.fechaInicio Primer día del sprint (YYYY-MM-DD).
 * @param {string} datos.fechaFin Último día del sprint (YYYY-MM-DD).
 * @param {string} datos.hoy Día actual (YYYY-MM-DD).
 * @param {Array<{fecha: string, cantidad: number}>} [datos.quemadoPorDia] Cuánto se quemó cada día.
 * @returns {{dias: Array<{fecha: string, restante: number|null, ideal: number, quemadoDia: number,
 *   quemadoAcumulado: number, futuro: boolean}>, totalQuemado: number}}
 */
function calcularBurndownDiario({ total, fechaInicio, fechaFin, hoy, quemadoPorDia = [] }) {
  const totalNum = aUnDecimal(total);
  const ideal = serieIdealDiaria(totalNum, fechaInicio, fechaFin);
  const entradas = [...quemadoPorDia]
    .map((q) => ({ fecha: q.fecha, cantidad: Number(q.cantidad) || 0 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const totalQuemado = aUnDecimal(entradas.reduce((acum, e) => acum + e.cantidad, 0));

  // Quemado de un día concreto (las consultas ya lo agrupan, pero no se asume aquí).
  const porDia = new Map();
  for (const e of entradas) porDia.set(e.fecha, (porDia.get(e.fecha) || 0) + e.cantidad);

  let indice = 0;
  let acumulado = 0;
  const dias = ideal.map(({ fecha, ideal: valorIdeal }) => {
    // El quemado con fecha hasta este día (incluido el anterior al inicio) ya cuenta.
    while (indice < entradas.length && entradas[indice].fecha <= fecha) {
      acumulado += entradas[indice].cantidad;
      indice++;
    }
    const futuro = fecha > hoy;
    return {
      fecha,
      restante: futuro ? null : Math.max(0, aUnDecimal(totalNum - acumulado)),
      ideal: valorIdeal,
      quemadoDia: aUnDecimal(porDia.get(fecha) || 0),
      quemadoAcumulado: aUnDecimal(acumulado),
      futuro,
    };
  });

  return { dias, totalQuemado };
}

/**
 * Serie por cierre de sprint para la vista general del proyecto: Inicio + un punto por sprint.
 * El restante acumulado nunca es negativo. Un sprint planificado lleva restante null.
 * Función pura (no toca la base de datos).
 *
 * @param {number} total Trabajo inicial de todo el proyecto (horas estimadas o puntos).
 * @param {Array<{nombre: string, estado: string, quemado: number}>} sprints Sprints en orden
 *   cronológico; quemado es lo descontado al cerrar ese sprint.
 * @returns {Array<{nombre: string, estado: string|null, restante: number|null}>}
 */
function calcularSeriePorSprint(total, sprints = []) {
  let restante = aUnDecimal(total);
  const serie = [{ nombre: 'Inicio', estado: null, restante }];
  for (const s of sprints) {
    if (s.estado === 'planificado') {
      serie.push({ nombre: s.nombre, estado: s.estado, restante: null });
      continue;
    }
    restante = Math.max(0, aUnDecimal(restante - (Number(s.quemado) || 0)));
    serie.push({ nombre: s.nombre, estado: s.estado, restante });
  }
  return serie;
}

/**
 * Burndown diario de un sprint, en horas o en puntos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {Object} [opciones]
 * @param {number} usuarioId Usuario que consulta (para comprobar que pertenece al proyecto).
 * @param {number|null} [opciones.usuarioIdFiltro] Integrante a filtrar; solo aplica a 'horas'.
 * @param {number|null} [opciones.sprintId] Sprint a graficar; null = activo, o el más reciente.
 * @param {string} [opciones.unidad] 'horas' (por defecto) o 'puntos'.
 * @returns {Promise<Object>} Serie diaria del sprint, totales y vista general por sprint.
 * @throws {ErrorApp} 404 si el sprint indicado no pertenece al proyecto.
 */
export async function obtenerBurndown(proyectoId, opciones = {}) {
  const { usuarioId, usuarioIdFiltro = null, sprintId = null, unidad = 'horas' } = opciones;
  if (unidad !== 'horas' && unidad !== 'puntos') {
    throw new ErrorApp("La unidad del burndown debe ser 'horas' o 'puntos'.", 400);
  }
  await exigirIntegranteProyecto(usuarioId, proyectoId);

  const sprints = await consultar(
    `SELECT s.id, s.nombre, s.estado,
            s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
            s.capacidad_horas::float AS capacidad_horas
       FROM sprints s
      WHERE s.proyecto_id = $1
      ORDER BY s.fecha_inicio, s.id`,
    [proyectoId],
  );

  // Sin sprints no hay nada que graficar
  if (sprints.length === 0) {
    return {
      vacio: true, individual: false, unidad, sprintId: null, sprint: null, sprints: [],
      dias: [], horasIniciales: 0, puntosIniciales: 0,
      horasRealesTotales: 0, puntosAceptadosTotales: 0, puntosNoTerminados: 0,
      tareasSinEstimar: 0, historiasSinPuntos: 0, sinHorasReales: true, porSprint: [],
    };
  }

  // Sprint elegido, o activo, o el más reciente por fecha de fin
  let sprint = null;
  if (sprintId !== null) {
    sprint = sprints.find((s) => s.id === sprintId);
    if (!sprint) throw new ErrorApp('El sprint indicado no pertenece a este proyecto.', 404);
  } else {
    sprint = sprints.find((s) => s.estado === 'activo')
      || [...sprints].sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin) || b.id - a.id)[0];
  }

  // Totales del sprint: horas estimadas (y cuántas tareas no tienen estimación) y puntos.
  const [[totHoras], [totPuntos], [noTerm]] = await Promise.all([
    consultar(
      `SELECT COALESCE(SUM(t.horas_estimadas), 0)::float AS total,
              COUNT(*) FILTER (WHERE t.horas_estimadas IS NULL)::int AS sin_estimar
         FROM tareas t
        WHERE t.sprint_id = $1 AND ($2::int IS NULL OR t.responsable_id = $2)`,
      [sprint.id, usuarioIdFiltro],
    ),
    consultar(
      `SELECT COALESCE(SUM(h.puntos), 0)::int AS total,
              COUNT(*) FILTER (WHERE h.puntos IS NULL)::int AS sin_puntos
         FROM historias h
        WHERE h.sprint_id = $1`,
      [sprint.id],
    ),
    // Puntos de historias no terminadas hoy (estado distinto de 'hecho'/'aceptada').
    consultar(
      `SELECT COALESCE(SUM(h.puntos), 0)::int AS restantes
         FROM historias h
        WHERE h.sprint_id = $1 AND h.estado NOT IN ('hecho', 'aceptada')`,
      [sprint.id],
    ),
  ]);
  const horasIniciales = aUnDecimal(totHoras.total);
  const puntosIniciales = totPuntos.total;

  // Quemado por día, según la unidad: horas reales registradas, o puntos aceptados en Review.
  let quemadoPorDia = [];
  if (unidad === 'horas') {
    quemadoPorDia = await consultar(
      `SELECT r.fecha::text AS fecha, SUM(r.horas)::float AS cantidad
         FROM registros_horas r
         JOIN tareas t ON t.id = r.tarea_id
        WHERE t.sprint_id = $1 AND ($2::int IS NULL OR t.responsable_id = $2)
        GROUP BY r.fecha
        ORDER BY r.fecha`,
      [sprint.id, usuarioIdFiltro],
    );
  } else {
    quemadoPorDia = await consultar(
      `SELECT to_char(r.decidido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS fecha,
              COALESCE(SUM(h.puntos), 0)::int AS cantidad
         FROM reviews_historias r
         JOIN historias h ON h.id = r.historia_id
        WHERE r.sprint_id = $1 AND r.decision = 'aceptada'
        GROUP BY 1
        ORDER BY 1`,
      [sprint.id],
    );
  }

  const { dias, totalQuemado } = calcularBurndownDiario({
    total: unidad === 'horas' ? horasIniciales : puntosIniciales,
    fechaInicio: sprint.fecha_inicio,
    fechaFin: sprint.fecha_fin,
    hoy: hoyIso(),
    quemadoPorDia: quemadoPorDia.map((q) => ({ fecha: q.fecha, cantidad: Number(q.cantidad) || 0 })),
  });

  // Vista general por cierre de sprint (horas y puntos). Dos consultas separadas para
  // no multiplicar filas al unir tareas con reviews.
  const [filasHoras, filasPuntos, [totHorasProy], [totPuntosProy]] = await Promise.all([
    consultar(
      `SELECT s.id, s.nombre, s.estado,
              COALESCE(SUM(t.horas_estimadas) FILTER (WHERE c.es_final), 0)::float AS hecho
         FROM sprints s
         LEFT JOIN tareas t ON t.sprint_id = s.id AND ($2::int IS NULL OR t.responsable_id = $2)
         LEFT JOIN columnas_tablero c ON c.id = t.columna_id
        WHERE s.proyecto_id = $1
        GROUP BY s.id, s.nombre, s.estado, s.fecha_inicio
        ORDER BY s.fecha_inicio, s.id`,
      [proyectoId, usuarioIdFiltro],
    ),
    consultar(
      `SELECT s.id,
              COALESCE(SUM(h.puntos) FILTER (WHERE r.decision = 'aceptada'), 0)::int AS aceptados
         FROM sprints s
         LEFT JOIN reviews_historias r ON r.sprint_id = s.id
         LEFT JOIN historias h ON h.id = r.historia_id
        WHERE s.proyecto_id = $1
        GROUP BY s.id, s.fecha_inicio
        ORDER BY s.fecha_inicio, s.id`,
      [proyectoId],
    ),
    consultar(
      `SELECT COALESCE(SUM(horas_estimadas), 0)::float AS total FROM tareas
        WHERE proyecto_id = $1 AND ($2::int IS NULL OR responsable_id = $2)`,
      [proyectoId, usuarioIdFiltro],
    ),
    consultar(
      `SELECT COALESCE(SUM(puntos), 0)::int AS total FROM historias WHERE proyecto_id = $1`,
      [proyectoId],
    ),
  ]);
  const serieHoras = calcularSeriePorSprint(totHorasProy.total, filasHoras.map((s) => ({
    nombre: s.nombre, estado: s.estado, quemado: Number(s.hecho) || 0,
  })));
  const seriePuntos = calcularSeriePorSprint(totPuntosProy.total, filasPuntos.map((s, i) => ({
    // El nombre y el estado vienen de la consulta de horas (mismo orden por fecha de inicio).
    nombre: filasHoras[i]?.nombre ?? `Sprint ${s.id}`, estado: filasHoras[i]?.estado ?? null,
    quemado: Number(s.aceptados) || 0,
  })));
  const porSprint = serieHoras.map((p, i) => ({
    id: filasHoras[i]?.id ?? null,
    nombre: p.nombre,
    estado: p.estado,
    horasRestantes: p.restante,
    puntosRestantes: seriePuntos[i]?.restante ?? null,
  }));

  // Sin valor inicial en la unidad elegida, la gráfica muestra "sin datos" (como antes).
  const inicialUnidad = unidad === 'horas' ? horasIniciales : puntosIniciales;
  return {
    vacio: inicialUnidad === 0,
    individual: unidad === 'horas' && !!usuarioIdFiltro,
    unidad,
    sprintId: sprint.id,
    sprint: {
      id: sprint.id, nombre: sprint.nombre, estado: sprint.estado,
      fechaInicio: sprint.fecha_inicio, fechaFin: sprint.fecha_fin,
      capacidadHoras: sprint.capacidad_horas,
    },
    sprints: sprints.map((s) => ({ id: s.id, nombre: s.nombre, estado: s.estado })),
    dias,
    horasIniciales,
    puntosIniciales,
    horasRealesTotales: unidad === 'horas' ? totalQuemado : null,
    puntosAceptadosTotales: unidad === 'puntos' ? totalQuemado : null,
    puntosNoTerminados: noTerm.restantes,
    tareasSinEstimar: totHoras.sin_estimar,
    historiasSinPuntos: totPuntos.sin_puntos,
    sinHorasReales: unidad === 'horas' && totalQuemado === 0,
    porSprint,
  };
}

// ===========================================================================
// HU-32: Distribución del tiempo
// ===========================================================================

/**
 * Obtener las horas reales registradas, detalladas por dimensiones para su distribución.
 * El backend extrae el detalle plano y el frontend lo agrupa dinámicamente.
 * 
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Identificador del usuario que consulta.
 * @returns {Promise<{esScrumMaster: boolean, datos: Array}>}
 */
export async function obtenerDistribucionTiempo(proyectoId, usuarioId) {
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);
  const esScrumMaster = rol === 'scrum_master';

  const params = [proyectoId];
  let filtroUsuario = '';

  if (!esScrumMaster) {
    filtroUsuario = ' AND r.usuario_id = $2';
    params.push(usuarioId);
  }

  const datos = await consultar(`
      SELECT
        COALESCE(u.nombre, 'Usuario eliminado') AS persona,  -- LEFT JOIN: no perder horas de usuarios borrados
        COALESCE(h.titulo, 'Sin historia') AS historia,
        COALESCE(e.nombre, 'Sin épica') AS epica,
        COALESCE(t.etiquetas[1], 'Sin etiqueta') AS actividad, -- tipo de actividad = primera etiqueta de la tarea
        SUM(r.horas)::numeric AS horas
      FROM registros_horas r
      JOIN tareas t ON t.id = r.tarea_id
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      LEFT JOIN historias h ON h.id = t.historia_id
      LEFT JOIN epicas e ON e.id = h.epica_id
      WHERE t.proyecto_id = $1 ${filtroUsuario}
      GROUP BY u.id, u.nombre, h.id, h.titulo, e.id, e.nombre, t.etiquetas[1]  -- por id, no solo por nombre
    `, params);

  return { esScrumMaster, datos };
}
// ===========================================================================
// HU-36: Exportación Asíncrona de Reportes (CSV / PDF)
// ===========================================================================

// Cola en memoria de trabajos: { jobId: { proyectoId, usuarioId, estado, progreso, archivo, error } }
const trabajosExportacion = new Map();

// Valores permitidos que llegan desde el cliente
const ALCANCES = ['avance', 'distribucion', 'todo'];
const FORMATOS = ['csv', 'pdf'];

/**
 * Preparar un valor para una celda CSV: lo entrecomilla y neutraliza fórmulas de Excel
 * (valores que empiezan con = + - @) para evitar inyección de fórmulas.
 *
 * @param {*} v Valor de la celda.
 * @returns {string} Celda lista para el CSV.
 */
function limpiarCelda(v) {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Reunir los mismos datos que se ven en pantalla, según el alcance elegido.
 * Reutiliza obtenerAvance, obtenerKpisDashboard y obtenerDistribucionTiempo, que ya filtran
 * por lo que el usuario puede ver; así el archivo nunca incluye datos de más.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Identificador del usuario que exporta.
 * @param {string} alcance 'avance', 'distribucion' o 'todo'.
 * @returns {Promise<Array<{titulo: string, cabecera: string[], filas: Array[]}>>}
 *          Secciones con datos; arreglo vacío si no hay nada que exportar.
 */
async function armarSecciones(proyectoId, usuarioId, alcance) {
  const secciones = [];

  if (alcance === 'avance' || alcance === 'todo') {
    const [avance, kpis] = await Promise.all([
      obtenerAvance(proyectoId, null, usuarioId),
      obtenerKpisDashboard(proyectoId, usuarioId),
    ]);
    secciones.push({
      titulo: 'Resumen',
      tipo: 'tarjetas',
      cabecera: ['Indicador', 'Valor'],
      filas: [['Avance global', `${kpis.kpis.avance.valor}%`], ['Desviación (hrs)', kpis.kpis.desviacion.valor]],
    });
    secciones.push({
      titulo: 'Avance por integrante',
      cabecera: ['Nombre', 'Rol', 'Tareas', 'Horas asignadas', 'Horas hechas', 'Avance (%)'],
      filas: avance.personas.map((p) => [p.nombre, p.rol, p.tareas, p.horasAsignadas, p.horasHechas, p.porcentaje || 0]),
    });
  }

  if (alcance === 'distribucion' || alcance === 'todo') {
    const { datos } = await obtenerDistribucionTiempo(proyectoId, usuarioId);
    secciones.push({
      titulo: 'Distribución del tiempo',
      cabecera: ['Persona', 'Historia', 'Épica', 'Actividad', 'Horas'],
      filas: datos.map((d) => [d.persona, d.historia, d.epica, d.actividad, d.horas]),
    });
  }

  // Descartar secciones vacías. "Resumen" solo no cuenta como contenido: debe haber filas reales.
  const conDatos = secciones.filter((s) => s.filas.length);
  return conDatos.some((s) => s.titulo !== 'Resumen') ? conDatos : [];
}

/**
 * Iniciar el proceso de exportación en segundo plano.
 * Solo el Scrum Master puede exportar y el proyecto debe tener datos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Identificador del usuario que solicita.
 * @param {string} [formato='csv'] 'csv' o 'pdf'.
 * @param {string} [alcance='todo'] 'avance', 'distribucion' o 'todo'.
 * @returns {Promise<{jobId: string}>} Identificador para consultar el progreso.
 */
export async function iniciarExportacion(proyectoId, usuarioId, formato = 'csv', alcance = 'todo') {
  // 1. Permisos: solo el Scrum Master puede exportar
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);
  if (rol !== 'scrum_master') {
    throw new ErrorApp('Acceso denegado: solo el Scrum Master puede exportar reportes del proyecto.', 403);
  }

  // 2. Validar lo que llega del cliente
  if (!FORMATOS.includes(formato)) throw new ErrorApp('Formato no válido (usa csv o pdf).', 400);
  if (!ALCANCES.includes(alcance)) throw new ErrorApp('Alcance no válido.', 400);

  // 3. No generar archivos vacíos
  if (await proyectoVacio(proyectoId)) {
    throw new ErrorApp('No hay datos para exportar en este proyecto.', 400);
  }

  // 4. Registrar el trabajo; expira a los 10 minutos para no llenar la memoria
  const jobId = randomUUID();
  const trabajo = { proyectoId, usuarioId, estado: 'procesando', progreso: 0, archivo: null, error: null };
  trabajosExportacion.set(jobId, trabajo);
  setTimeout(() => trabajosExportacion.delete(jobId), 10 * 60 * 1000).unref();

  // 5. Lanzar la generación sin esperar; si falla, el cliente verá el error y podrá reintentar
  procesarArchivo(trabajo, proyectoId, usuarioId, formato, alcance).catch((err) => {
    trabajo.estado = 'error';
    trabajo.error = err.message || 'No se pudo generar el reporte.';
  });

  return { jobId };
}

/**
 * Buscar un trabajo comprobando que pertenezca al usuario y al proyecto indicados.
 * Así nadie puede consultar ni descargar el reporte de otra persona.
 *
 * @param {string} jobId Identificador del trabajo.
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Identificador del usuario.
 * @returns {object} El trabajo encontrado.
 */
function obtenerTrabajo(jobId, proyectoId, usuarioId) {
  const t = trabajosExportacion.get(jobId);
  if (!t || t.proyectoId !== proyectoId || t.usuarioId !== usuarioId) {
    throw new ErrorApp('El trabajo de exportación no existe o ha expirado.', 404);
  }
  return t;
}

/**
 * Consultar el estado y el avance de un trabajo (para la barra de progreso).
 *
 * @returns {{estado: string, progreso: number, error: string|null}}
 */
export function consultarEstadoExportacion(jobId, proyectoId, usuarioId) {
  const t = obtenerTrabajo(jobId, proyectoId, usuarioId);
  return { estado: t.estado, progreso: t.progreso, error: t.error };
}

/**
 * Recuperar el archivo generado y borrar el trabajo de la memoria.
 *
 * @returns {{contenido: string|Buffer, mime: string, extension: string, nombre: string}}
 */
export function obtenerArchivoExportado(jobId, proyectoId, usuarioId) {
  const t = obtenerTrabajo(jobId, proyectoId, usuarioId);
  if (t.estado !== 'completado') throw new ErrorApp('El archivo aún no está listo.', 400);
  trabajosExportacion.delete(jobId); // Limpiar memoria tras descargar
  return t.archivo;
}

/**
 * Tarea en segundo plano: recopila los datos y genera el CSV o el PDF.
 * Actualiza trabajo.progreso para que el cliente lo muestre.
 */
async function procesarArchivo(trabajo, proyectoId, usuarioId, formato, alcance) {
  // 20%: consultando la base de datos
  trabajo.progreso = 20;
  const secciones = await armarSecciones(proyectoId, usuarioId, alcance);
  if (!secciones.length) throw new ErrorApp('No hay datos para exportar con el alcance elegido.', 400);

  // 60%: armando el archivo
  trabajo.progreso = 60;
  const fecha = new Date().toISOString().slice(0, 10);
  let contenido;
  let mime;
  let extension;

  if (formato === 'csv') {
    // BOM al inicio para que Excel lea bien los acentos (UTF-8); una sección tras otra
    contenido = '\uFEFF' + secciones.map((s) => [
      limpiarCelda(s.titulo),
      s.cabecera.map(limpiarCelda).join(','),
      ...s.filas.map((f) => f.map(limpiarCelda).join(',')),
    ].join('\n')).join('\n\n');
    mime = 'text/csv; charset=utf-8';
    extension = 'csv';
  } else {
    // PDF con diseño: el generador recibe las mismas secciones que el CSV
    const textoAlcance = { todo: 'Todo el reporte', avance: 'Avance por integrante', distribucion: 'Distribución del tiempo' }[alcance];
    contenido = generarPdf({
      titulo: 'Reporte del proyecto',
      subtitulo: `Proyecto ${proyectoId} - ${textoAlcance} - Generado el ${fecha}`,
      secciones,
    });
    mime = 'application/pdf';
    extension = 'pdf';
  }

  // 100%: listo para descargar
  trabajo.archivo = { contenido, mime, extension, nombre: `Reporte_${proyectoId}_${alcance}_${fecha}.${extension}` };
  trabajo.progreso = 100;
  trabajo.estado = 'completado';
}

// ===========================================================================
// HU-33: Configuración del umbral de desviación
// ===========================================================================

/**
 * Consultar el umbral vigente y si el usuario puede editarlo (solo Scrum Master).
 *
 * @returns {Promise<{umbral: number, puedeEditar: boolean}>}
 */
export async function obtenerUmbral(proyectoId, usuarioId) {
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);
  const [fila] = await consultar('SELECT umbral_desviacion FROM proyectos WHERE id = $1', [proyectoId]);
  return { umbral: fila.umbral_desviacion, puedeEditar: rol === 'scrum_master' };
}

/**
 * Guardar el umbral (entero entre 0 y 100) y reevaluar las tareas con la nueva regla.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} usuarioId Usuario que guarda.
 * @param {*} valor Valor recibido del cliente.
 * @returns {Promise<{umbral: number}>}
 */
export async function guardarUmbral(proyectoId, usuarioId, valor) {
  const rol = await exigirIntegranteProyecto(usuarioId, proyectoId);
  if (rol !== 'scrum_master') throw new ErrorApp('Solo el Scrum Master puede configurar el umbral.', 403);

  const n = (typeof valor === 'number' || (typeof valor === 'string' && valor.trim() !== '')) ? Number(valor) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new ErrorApp('El umbral debe ser un número entero entre 0 y 100.', 400);
  }

  await consultar('UPDATE proyectos SET umbral_desviacion = $2 WHERE id = $1', [proyectoId, n]);
  // Con la nueva regla se reevalúan las tareas; las que ya se notificaron no se repiten
  const tareas = await consultar('SELECT id FROM tareas WHERE proyecto_id = $1 AND horas_estimadas > 0', [proyectoId]);
  for (const t of tareas) await evaluarDesviacionTarea(proyectoId, t.id);
  return { umbral: n };
}