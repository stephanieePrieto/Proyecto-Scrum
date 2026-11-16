/**
 * @file burnup.service.js
 * @description Consultas de la HU-1 para el Burnup y el Flujo Acumulado (CFD). Lee PostgreSQL y delega el cálculo
 * en burnup.calculo.js. El acceso se valida con exigirIntegranteProyecto, igual que el resto de las métricas.
 */

import { consulta } from '../../config/db.js';
import { exigirIntegranteProyecto } from '../metricas/metricas.service.js';
import { calcularBurnup, calcularCfd } from './burnup.calculo.js';
import { ACCION_CAMBIO_COLUMNA } from './burnup.registro.js';

/** Ejecutar una consulta parametrizada y devolver sus filas. */
async function consultar(sql, params = []) {
  const { rows } = await consulta(sql, params);
  return rows;
}

/**
 * Datos del Burnup del proyecto. Se omiten los sprints planificados porque todavía no tienen trabajo completado.
 *
 * @param {number} proyectoId
 * @param {number} usuarioId
 * @returns {Promise<{vacio: boolean, unidad: string, alcanceTotal: number, puntos: Array<Object>}>}
 */
export async function obtenerBurnup(proyectoId, usuarioId) {
  await exigirIntegranteProyecto(usuarioId, proyectoId);

  const [totales] = await consultar(
    `SELECT COALESCE(SUM(horas_estimadas), 0)::float AS total,
            COALESCE(SUM(horas_estimadas) FILTER (WHERE c.es_final), 0)::float AS hechas
       FROM tareas t
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE t.proyecto_id = $1`,
    [proyectoId],
  );

  const sprints = await consultar(
    `SELECT s.id, s.nombre,
            COALESCE(SUM(t.horas_estimadas) FILTER (WHERE c.es_final), 0)::float AS completado_horas
       FROM sprints s
       LEFT JOIN tareas t ON t.sprint_id = s.id
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE s.proyecto_id = $1 AND s.estado <> 'planificado'
      GROUP BY s.id, s.nombre, s.fecha_inicio
      ORDER BY s.fecha_inicio, s.id`,
    [proyectoId],
  );

  // Lo hecho que no cae en ningún sprint = total hecho del proyecto menos lo que ya suman los sprints
  const sumaSprints = sprints.reduce((acum, s) => acum + s.completado_horas, 0);
  const completadoSinSprint = Math.max(0, totales.hechas - sumaSprints);

  const serie = calcularBurnup(
    totales.total,
    sprints.map((s) => ({ nombre: s.nombre, completadoHoras: s.completado_horas })),
    completadoSinSprint,
  );

  return { vacio: serie.alcanceTotal === 0, unidad: 'horas', ...serie };
}

/**
 * Datos del Flujo Acumulado del proyecto.
 * Si todavía no hay cambios de columna registrados, `historialSuficiente` es false: el CFD se dibuja, pero solo
 * refleja la columna actual de cada tarjeta, así que la interfaz debe avisarlo.
 *
 * @param {number} proyectoId
 * @param {number} usuarioId
 * @returns {Promise<Object>}
 */
export async function obtenerCfd(proyectoId, usuarioId) {
  await exigirIntegranteProyecto(usuarioId, proyectoId);

  const columnas = await consultar(
    `SELECT id, nombre, orden, es_final AS "esFinal"
       FROM columnas_tablero
      WHERE proyecto_id = $1
      ORDER BY orden`,
    [proyectoId],
  );

  const tareas = await consultar(
    `SELECT id, to_char(creado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS creado,
            columna_id AS "columnaActualId"
       FROM tareas
      WHERE proyecto_id = $1`,
    [proyectoId],
  );

  const filasHistorial = await consultar(
    `SELECT h.tarea_id AS "tareaId",
            to_char(h.creado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS fecha,
            h.detalle
       FROM historial_tareas h
       JOIN tareas t ON t.id = h.tarea_id
      WHERE t.proyecto_id = $1 AND h.accion = $2
      ORDER BY h.creado_en, h.id`,
    [proyectoId, ACCION_CAMBIO_COLUMNA],
  );

  const eventos = filasHistorial.map((f) => ({
    tareaId: f.tareaId,
    fecha: f.fecha,
    anteriorId: f.detalle?.anterior ?? null,
    nuevaId: f.detalle?.nueva ?? null,
  }));

  const hoy = new Date().toISOString().slice(0, 10);
  const cfd = calcularCfd({ tareas, eventos, columnas, hoy });

  return { ...cfd, historialSuficiente: eventos.length > 0 };
}
