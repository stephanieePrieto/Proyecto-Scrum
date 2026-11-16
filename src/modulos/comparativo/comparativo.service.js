/**
 * @file comparativo.service.js
 * @description Consultas de la HU-2 (comparativo entre equipos). Solo ve el comparativo el Scrum Master,
 * y solo de los proyectos donde lo es. Para cada equipo reutiliza el cálculo de velocity y de KPIs que ya existe
 * en metricas.service.js, y luego normaliza los resultados con comparativo.calculo.js.
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { obtenerVelocity, obtenerKpisDashboard } from '../metricas/metricas.service.js';
import { elegirProyectoPorEquipo, normalizarComparativo } from './comparativo.calculo.js';
import { MENSAJE_SOLO_SCRUM_MASTER } from './comparativo.mensajes.js';

/**
 * Proyectos no archivados donde el usuario es Scrum Master y sigue siendo integrante del equipo dueño.
 * El rol se revisa en la base de datos en cada petición, no en el token.
 *
 * @param {number} usuarioId
 * @returns {Promise<Array<{proyectoId: number, proyecto: string, equipoId: number, equipo: string}>>}
 */
async function proyectosComoScrumMaster(usuarioId) {
  const { rows } = await consulta(
    `SELECT p.id AS "proyectoId", p.nombre AS proyecto,
            e.id AS "equipoId", e.nombre AS equipo
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id AND u.activo = TRUE
       JOIN proyectos p ON p.id = mp.proyecto_id AND p.archivado = FALSE
       JOIN equipos e ON e.id = p.equipo_id
       JOIN miembros_equipo me ON me.equipo_id = e.id AND me.usuario_id = mp.usuario_id
      WHERE mp.usuario_id = $1 AND mp.rol = 'scrum_master'`,
    [usuarioId],
  );
  return rows;
}

/**
 * Exigir que el usuario sea Scrum Master de al menos un proyecto.
 * Responde 403 a cualquier otra persona, incluida quien no tiene ningún vínculo: el comparativo no pertenece a
 * un proyecto concreto, así que no hay un proyecto contra el cual responder 404.
 *
 * @param {number} usuarioId
 * @returns {Promise<Array<Object>>} Proyectos donde el usuario es Scrum Master.
 * @throws {ErrorApp} 401 sin sesión; 403 si no es Scrum Master de ningún proyecto.
 */
export async function exigirScrumMaster(usuarioId) {
  if (!usuarioId) throw new ErrorApp('No has iniciado sesión.', 401);
  const proyectos = await proyectosComoScrumMaster(usuarioId);
  if (proyectos.length === 0) throw new ErrorApp(MENSAJE_SOLO_SCRUM_MASTER, 403);
  return proyectos;
}

/**
 * Armar el comparativo: un proyecto por equipo, con velocity, avance y desviación normalizados.
 *
 * @param {number} usuarioId
 * @returns {Promise<Object>} Resultado de normalizarComparativo, más el total de proyectos consultados.
 */
export async function obtenerComparativo(usuarioId) {
  const proyectos = await exigirScrumMaster(usuarioId);
  const elegidos = elegirProyectoPorEquipo(proyectos);

  const equipos = await Promise.all(
    elegidos.map(async (p) => {
      const [velocidad, kpis] = await Promise.all([
        obtenerVelocity(p.proyectoId),
        obtenerKpisDashboard(p.proyectoId, usuarioId),
      ]);

      // La desviación se pasa a porcentaje del estimado, para que proyectos de distinto tamaño sean comparables
      const desviacion = kpis.kpis.desviacion;
      const estimado = Number(desviacion?.estimado) || 0;
      const desviacionPct = estimado > 0 && Number.isFinite(desviacion?.valor)
        ? Math.round((desviacion.valor / estimado) * 1000) / 10
        : null;

      return {
        equipoId: p.equipoId,
        equipo: p.equipo,
        proyectoId: p.proyectoId,
        proyecto: p.proyecto,
        sprintsCerrados: velocidad.sprints.length,
        velocity: velocidad.promedioActual,
        avancePct: kpis.kpis.avance?.valor ?? null,
        desviacionPct,
      };
    }),
  );

  return { proyectosConsultados: proyectos.length, ...normalizarComparativo(equipos) };
}
