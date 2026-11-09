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

  return { valor, estimado, real, superaUmbral, umbral: fila.umbral_desviacion };
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
         JOIN usuarios u ON u.id = mp.usuario_id AND u.activo = TRUE
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
// HU-29: Gráfica Burndown
// ===========================================================================

/**
 * Obtener los datos necesarios para dibujar la gráfica de Burndown del proyecto por sprint.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<Object>} Serie de sprints con horas restantes acumuladas e ideales.
 */
export async function obtenerBurndown(proyectoId) {
  const filasSprints = await consultar(
    `SELECT s.id, s.nombre, s.estado, s.fecha_inicio,
            COALESCE(SUM(t.horas_estimadas), 0) AS estimado_total,
            COALESCE(SUM(t.horas_estimadas) FILTER (WHERE c.es_final), 0) AS estimado_hecho
       FROM sprints s
       LEFT JOIN tareas t ON t.sprint_id = s.id
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE s.proyecto_id = $1
      GROUP BY s.id, s.fecha_inicio, s.nombre, s.estado
      ORDER BY s.fecha_inicio, s.id`,
    [proyectoId]
  );

  const [totalProyecto] = await consultar(
    `SELECT COALESCE(SUM(horas_estimadas), 0) AS total FROM tareas WHERE proyecto_id = $1`,
    [proyectoId]
  );

  const inicioHoras = aUnDecimal(Number(totalProyecto.total) || 374);

  let acumuladoRestante = inicioHoras;
  const sprints = [
    { nombre: 'Inicio', horasRestantes: inicioHoras }
  ];

  filasSprints.forEach((s) => {
    const completadas = Number(s.estimado_hecho);
    acumuladoRestante = Math.max(0, acumuladoRestante - completadas);
    sprints.push({
      id: s.id,
      nombre: s.nombre,
      estado: s.estado,
      horasRestantes: s.estado === 'planificado' ? null : aUnDecimal(acumuladoRestante)
    });
  });

  return {
    vacio: sprints.length <= 1 && inicioHoras === 0,
    horasIniciales: inicioHoras,
    sprints
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