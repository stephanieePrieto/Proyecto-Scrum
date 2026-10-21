// Responsable: Dana - HU-29 a HU-33, HU-35, HU-36: reglas, SQL y avisos por socket (burndown, velocity, avance, distribucion, KPIs y exportar)
/**
 * HU-35: Dashboard de KPIs.
 * Calcular los 4 indicadores del proyecto consultando PostgreSQL con SQL.
 *
 * SUPUESTOS (ajustar nombres de tablas y columnas a database/schema.sql):
 *   tareas       (id, proyecto_id, estado TEXT, horas_estimadas NUMERIC)   estado 'hecho' = completada
 *   sprints      (id, proyecto_id, estado TEXT, fecha_fin DATE)            estado 'activo' = en curso
 *   impedimentos (id, proyecto_id, estado TEXT, critico BOOLEAN)           estado 'abierto'
 *   horas        (id, tarea_id, horas NUMERIC)                             registro de horas reales
 *
 * MODO DEMO: si no hay DATABASE_URL (o MODO_DEMO=true) devolver datos de ejemplo
 * desde metricas.demo.js, sin consultar la base de datos.
 */

import { esModoDemo, datosDemo } from './metricas.demo.js';

// Guardar el pool de conexiones una vez cargado (carga diferida)
let db;

/**
 * Obtener el pool de conexiones a PostgreSQL cargando config/db.js solo cuando se necesita.
 * Evitar así que el modo demo dependa de ese archivo.
 *
 * @returns {import('pg').Pool} Pool de conexiones.
 */
async function obtenerDb() {
  if (!db) {
    const modulo = await import('../../config/db.js');
    db = modulo.default || modulo.pool || modulo;
  }
  return db;
}

// Definir los milisegundos de un día para convertir diferencias de fechas
const MS_DIA = 24 * 60 * 60 * 1000;

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
  const pool = await obtenerDb();
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Calcular el avance global: porcentaje de tareas completadas sobre el total.
 * Devolver 0 % cuando el proyecto no tiene tareas.
 * Convertir con Number() porque pg devuelve COUNT (bigint) como texto.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, hechas: number, total: number}>}
 */
async function avanceGlobal(proyectoId) {
  const [fila] = await consultar(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE estado = 'hecho') AS hechas
       FROM tareas
      WHERE proyecto_id = $1`,
    [proyectoId],
  );
  const total = Number(fila.total);
  const hechas = Number(fila.hechas);
  return { valor: total ? Math.round((hechas / total) * 100) : 0, hechas, total };
}

/**
 * Calcular los días restantes del sprint activo.
 * Devolver valor null cuando no hay sprint activo (el cliente muestra "—").
 * Limitar el resultado a 0 cuando la fecha de fin ya pasó.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number|null}>}
 */
async function diasRestantes(proyectoId) {
  const [sprint] = await consultar(
    `SELECT fecha_fin FROM sprints
      WHERE proyecto_id = $1 AND estado = 'activo'
      ORDER BY fecha_fin ASC
      LIMIT 1`,
    [proyectoId],
  );
  if (!sprint) return { valor: null };

  const dias = Math.ceil((new Date(sprint.fecha_fin) - new Date()) / MS_DIA);
  return { valor: Math.max(0, dias) };
}

/**
 * Contar los impedimentos abiertos y cuántos de ellos son críticos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, criticos: number}>}
 */
async function impedimentosAbiertos(proyectoId) {
  const [fila] = await consultar(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE critico) AS criticos
       FROM impedimentos
      WHERE proyecto_id = $1 AND estado = 'abierto'`,
    [proyectoId],
  );
  return { valor: Number(fila.total), criticos: Number(fila.criticos) };
}

/**
 * Calcular la desviación acumulada: horas reales menos horas estimadas.
 * Interpretar un valor negativo como "bajo presupuesto" y uno positivo como "sobre presupuesto".
 * Convertir con Number() porque pg devuelve NUMERIC como texto.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<{valor: number, estimado: number, real: number}>}
 */
async function desviacionAcumulada(proyectoId) {
  const [[est], [rea]] = await Promise.all([
    consultar(
      `SELECT COALESCE(SUM(horas_estimadas), 0) AS estimado
         FROM tareas
        WHERE proyecto_id = $1`,
      [proyectoId],
    ),
    consultar(
      `SELECT COALESCE(SUM(h.horas), 0) AS horas_reales
         FROM horas h
         JOIN tareas t ON t.id = h.tarea_id
        WHERE t.proyecto_id = $1`,
      [proyectoId],
    ),
  ]);
  const estimado = Number(est.estimado);
  const real = Number(rea.horas_reales);
  return { valor: Math.round((real - estimado) * 10) / 10, estimado, real };
}

/**
 * Determinar si el proyecto es nuevo y no tiene tareas, sprints ni impedimentos.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @returns {Promise<boolean>} true si no existe ningún dato.
 */
async function proyectoVacio(proyectoId) {
  const [fila] = await consultar(
    `SELECT (SELECT COUNT(*) FROM tareas       WHERE proyecto_id = $1) +
            (SELECT COUNT(*) FROM sprints      WHERE proyecto_id = $1) +
            (SELECT COUNT(*) FROM impedimentos WHERE proyecto_id = $1) AS total`,
    [proyectoId],
  );
  return Number(fila.total) === 0;
}

/**
 * Calcular todos los KPIs del dashboard en paralelo.
 * Usar Promise.allSettled para aislar fallos: si un cálculo falla,
 * devolver { error: true } solo en ese KPI y entregar los demás normalmente.
 *
 * Devolver datos de ejemplo cuando el modo demo está activo.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {string} [escenario] Escenario de ejemplo (solo se usa en modo demo).
 * @returns {Promise<{vacio: boolean, kpis: Object}>}
 */
export async function obtenerKpisDashboard(proyectoId, escenario) {
  if (esModoDemo()) return datosDemo(escenario);

  const [vacio, ...resultados] = await Promise.allSettled([
    proyectoVacio(proyectoId),
    avanceGlobal(proyectoId),
    diasRestantes(proyectoId),
    impedimentosAbiertos(proyectoId),
    desviacionAcumulada(proyectoId),
  ]);

  const elegir = (r) => (r.status === 'fulfilled' ? r.value : { error: true });
  const [avance, dias, impedimentos, desviacion] = resultados.map(elegir);

  return {
    vacio: vacio.status === 'fulfilled' ? vacio.value : false,
    kpis: { avance, diasRestantes: dias, impedimentos, desviacion },
  };
}