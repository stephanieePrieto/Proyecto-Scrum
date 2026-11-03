// Responsable: Diego - HU-15: reglas, SQL y avisos por socket (eventos Scrum)
/**
 * HU-15 · Calendario de eventos Scrum.
 *
 * Tablas que usa (database/schema.sql): eventos_calendario, sprints, miembros_proyecto, usuarios,
 * ausencias y notificaciones.
 *
 * Decisiones importantes:
 *  - Hay eventos solo para el sprint ACTIVO. Sin sprint activo, el calendario muestra un mensaje.
 *  - Los eventos se derivan de las fechas del sprint (calendario.reglas.js). En lugar de depender de que
 *    otro módulo avise cuando cambian las fechas, cada consulta compara lo guardado contra lo que
 *    corresponde: si no coincide, regenera y avisa a los integrantes. Así nunca queda desfasado.
 *  - Regenerar usa un candado por sprint (pg_advisory_xact_lock): dos consultas a la vez no duplican eventos.
 *  - Las horas se guardan en UTC (TIMESTAMPTZ) definidas en ZONA_EVENTOS; la pantalla las muestra
 *    en la zona horaria del perfil de cada persona (usuarios.zona_horaria).
 *  - Los conflictos con ausencias del Scrum Master o Product Owner se calculan al consultar.
 */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso } from '../../utils/permisos.js';
import { ZONA_EVENTOS, generarEventos, coinciden, conflictosPorAusencia } from './calendario.reglas.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = { actualizado: 'calendario:actualizado' };

const MENSAJE_SIN_SPRINT = 'No hay un sprint activo, así que todavía no hay eventos Scrum que mostrar.';

/**
 * Obtener el sprint activo del proyecto con sus fechas como texto.
 *
 * @param {number|string} proyectoId
 * @returns {Promise<{id: number, nombre: string, fechaInicio: string, fechaFin: string}|null>}
 */
async function sprintActivo(proyectoId) {
  const { rows } = await consulta(
    `SELECT id, nombre, to_char(fecha_inicio, 'YYYY-MM-DD') AS "fechaInicio", to_char(fecha_fin, 'YYYY-MM-DD') AS "fechaFin"
       FROM sprints WHERE proyecto_id = $1 AND estado = 'activo'`,
    [proyectoId],
  );
  return rows[0] ?? null;
}

/**
 * Leer los eventos guardados de un sprint con su día y hora en ZONA_EVENTOS.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} sprintId
 * @returns {Promise<Array<{id: number, tipo: string, titulo: string, fecha: string, horaInicio: string, iniciaEn: Date, terminaEn: Date}>>}
 */
async function leerEventos(cliente, sprintId) {
  const { rows } = await cliente.query(
    `SELECT id, tipo, titulo, inicia_en AS "iniciaEn", termina_en AS "terminaEn",
            to_char(inicia_en AT TIME ZONE $2, 'YYYY-MM-DD') AS fecha,
            to_char(inicia_en AT TIME ZONE $2, 'HH24:MI') AS "horaInicio"
       FROM eventos_calendario WHERE sprint_id = $1 ORDER BY inicia_en, id`,
    [sprintId, ZONA_EVENTOS],
  );
  return rows;
}

/**
 * Avisar a los integrantes activos del proyecto que el calendario cambió. Un fallo no interrumpe nada.
 *
 * @param {number} proyectoId
 * @param {string} nombreSprint
 * @returns {Promise<void>}
 */
async function notificarCambio(proyectoId, nombreSprint) {
  try {
    await consulta(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace)
       SELECT mp.usuario_id, 'calendario', 'Cambió el calendario del sprint',
              $2, '/pages/calendario.html?proyecto=' || $1::int::text
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1::int AND u.activo = TRUE`,
      [proyectoId, `Las fechas de «${nombreSprint}» cambiaron y se actualizaron sus eventos Scrum.`],
    );
  } catch (error) {
    console.error('[calendario] No se pudo guardar el aviso:', error.message);
  }
}

/**
 * Hacer que los eventos guardados coincidan con las fechas del sprint.
 * Si ya coinciden no hace nada. Si ya había eventos y cambiaron, avisa a los integrantes.
 *
 * @param {number|string} proyectoId
 * @param {{id: number, nombre: string, fechaInicio: string, fechaFin: string}} sprint
 * @returns {Promise<{regenerados: boolean, notificados: boolean}>}
 */
export async function sincronizarEventos(proyectoId, sprint) {
  const esperados = generarEventos(sprint);
  const actuales = await leerEventos(pool, sprint.id);
  if (coinciden(esperados, actuales)) return { regenerados: false, notificados: false };

  const cliente = await pool.connect();
  let habiaEventos = false;
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock($1)', [sprint.id]);

    // Con el candado puesto, otra petición pudo haber regenerado ya: volver a comprobar
    const dentro = await leerEventos(cliente, sprint.id);
    if (coinciden(esperados, dentro)) {
      await cliente.query('COMMIT');
      return { regenerados: false, notificados: false };
    }
    habiaEventos = dentro.length > 0;

    await cliente.query('DELETE FROM eventos_calendario WHERE sprint_id = $1', [sprint.id]);
    if (esperados.length) {
      await cliente.query(
        `INSERT INTO eventos_calendario (sprint_id, tipo, titulo, inicia_en, termina_en)
         SELECT $1::int, v.tipo, v.titulo, (v.fecha || ' ' || v.inicio)::timestamp AT TIME ZONE $6,
                (v.fecha || ' ' || v.fin)::timestamp AT TIME ZONE $6
           FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[], $7::text[]) AS v(tipo, titulo, fecha, inicio, fin)`,
        [
          sprint.id,
          esperados.map((e) => e.tipo),
          esperados.map((e) => e.titulo),
          esperados.map((e) => e.fecha),
          esperados.map((e) => e.horaInicio),
          ZONA_EVENTOS,
          esperados.map((e) => e.horaFin),
        ],
      );
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  if (habiaEventos) await notificarCambio(Number(proyectoId), sprint.nombre);
  emitirAProyecto(Number(proyectoId), EVENTOS.actualizado, { proyecto_id: Number(proyectoId), sprint_id: sprint.id });
  return { regenerados: true, notificados: habiaEventos };
}

/**
 * Consultar el calendario del sprint activo, con avisos de conflicto por ausencias.
 *
 * @param {{id: number}} actor - Usuario autenticado.
 * @param {number|string} proyectoId
 * @returns {Promise<Object>} Ver docs/hu-09-15-ciclo-calendario.md.
 */
export async function consultar(actor, proyectoId) {
  // Sin vínculo vigente con el proyecto responde 404, igual que si no existiera
  const idProyecto = Number(proyectoId);
  if (!Number.isInteger(idProyecto) || idProyecto <= 0 || idProyecto > 2147483647) throw new ErrorApp('El identificador del proyecto no es válido.', 400);
  await exigirPermiso(actor, 'proyecto.ver', idProyecto);
  const { rows: [usuario] } = await consulta('SELECT zona_horaria FROM usuarios WHERE id = $1', [actor.id]);
  const zona = usuario?.zona_horaria || ZONA_EVENTOS;

  const sprint = await sprintActivo(proyectoId);
  if (!sprint) return { zona, sprint: null, eventos: [], conflictos: [], mensaje: MENSAJE_SIN_SPRINT };

  await sincronizarEventos(proyectoId, sprint);
  const eventos = await leerEventos(pool, sprint.id);

  const { rows: ausencias } = await consulta(
    `SELECT u.id AS "usuarioId", u.nombre, mp.rol,
            to_char(a.fecha_inicio, 'YYYY-MM-DD') AS desde, to_char(a.fecha_fin, 'YYYY-MM-DD') AS hasta
       FROM ausencias a
       JOIN miembros_proyecto mp ON mp.usuario_id = a.usuario_id AND mp.proyecto_id = $1
       JOIN usuarios u ON u.id = a.usuario_id
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
      WHERE mp.rol IN ('scrum_master', 'product_owner') AND u.activo = TRUE
        AND a.fecha_fin >= $2::date AND a.fecha_inicio <= $3::date`,
    [proyectoId, sprint.fechaInicio, sprint.fechaFin],
  );
  const porEvento = conflictosPorAusencia(eventos, ausencias);

  const lista = eventos.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    titulo: e.titulo,
    iniciaEn: e.iniciaEn,
    terminaEn: e.terminaEn,
    conflictos: porEvento.get(e.id) ?? [],
  }));
  const conflictos = lista
    .filter((e) => e.conflictos.length)
    .map((e) => ({ eventoId: e.id, tipo: e.tipo, titulo: e.titulo, iniciaEn: e.iniciaEn, personas: e.conflictos }));

  return { zona, sprint, eventos: lista, conflictos, mensaje: null };
}

/**
 * Regenerar a mano los eventos del sprint activo de un proyecto (por ejemplo, tras cambiar sus fechas).
 * Otros módulos pueden llamarla; si no se llama, la siguiente consulta del calendario lo hace sola.
 *
 * @param {number|string} proyectoId
 * @returns {Promise<{regenerados: boolean}>}
 * @throws {ErrorApp} 409 si no hay sprint activo.
 */
export async function regenerar(proyectoId) {
  const sprint = await sprintActivo(proyectoId);
  if (!sprint) throw new ErrorApp(MENSAJE_SIN_SPRINT, 409);
  const { regenerados } = await sincronizarEventos(proyectoId, sprint);
  return { regenerados };
}
