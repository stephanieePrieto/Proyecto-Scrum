/**
 * @file calendario.service.js
 * @description Calendario de eventos Scrum.
 *
 * Tablas que usa (database/schema.sql): eventos_calendario, eventos_participantes, sprints, miembros_proyecto, usuarios,
 * ausencias, notificaciones y bitacora (vía auditar.js).
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
 *  - las reuniones que crea el Scrum Master viven en la misma tabla con origen = 'reunion'. Pertenecen al
 *    proyecto (sprint_id NULL), así que regenerar los eventos del sprint no las toca y la Daily sigue tomando
 *    su hora de corte solo de los eventos generados. El calendario muestra las reuniones que caen dentro del sprint.
 *  - solo el Scrum Master (reunion.gestionar) crea, edita y elimina reuniones; el resto las consulta
 *    (proyecto.ver). Cada petición vuelve a comprobar el permiso y cada cambio queda en la bitácora.
 *  - la fecha y las horas que escribe el Scrum Master se interpretan en la zona horaria de su perfil.
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso, tienePermiso, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { enTransaccion, registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { ZONA_EVENTOS, generarEventos, coinciden, conflictosPorAusencia, validarReunion } from './calendario.reglas.js';

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
 * Leer los eventos generados de un sprint con su día y hora en ZONA_EVENTOS (las reuniones no cuentan aquí).
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
       FROM eventos_calendario WHERE sprint_id = $1 AND origen = 'generado' ORDER BY inicia_en, id`,
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

    await cliente.query("DELETE FROM eventos_calendario WHERE sprint_id = $1 AND origen = 'generado'", [sprint.id]);
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
  // además de los eventos generados, las reuniones del proyecto que caen dentro del sprint
  const [generados, { rows: reuniones }] = await Promise.all([
    leerEventos(pool, sprint.id),
    consulta(
      `SELECT id, tipo, titulo, inicia_en AS "iniciaEn", termina_en AS "terminaEn",
              to_char(inicia_en AT TIME ZONE $4, 'YYYY-MM-DD') AS fecha,
              to_char(inicia_en AT TIME ZONE $4, 'HH24:MI') AS "horaInicio"
         FROM eventos_calendario
        WHERE proyecto_id = $1 AND origen = 'reunion'
          AND (inicia_en AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
      [idProyecto, sprint.fechaInicio, sprint.fechaFin, ZONA_EVENTOS],
    ),
  ]);
  const eventos = [
    ...generados.map((e) => ({ ...e, origen: 'generado' })),
    ...reuniones.map((e) => ({ ...e, origen: 'reunion' })),
  ].sort((a, b) => new Date(a.iniciaEn) - new Date(b.iniciaEn) || a.id - b.id);

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
    origen: e.origen,
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

/* ====================================================================
 * Reuniones Scrum
 * ==================================================================== */

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver utils/envolverControlador.js).
 */
function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

/**
 * Convertir un identificador recibido en la petición a un entero positivo.
 *
 * @param {*} valor - Valor sin confiar.
 * @param {string} mensaje - Mensaje del error 400 cuando no es válido.
 * @returns {number}
 * @throws {ErrorApp} 400 si no es un entero positivo válido.
 */
function leerId(valor, mensaje) {
  const numero = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? NaN : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > ENTERO_MAXIMO) lanzar(400, mensaje);
  return numero;
}

/**
 * Zona horaria del perfil de la persona (o la de los eventos si no tiene una guardada).
 *
 * @param {number} usuarioId
 * @returns {Promise<string>}
 */
async function zonaDe(usuarioId) {
  const { rows: [usuario] } = await consulta('SELECT zona_horaria FROM usuarios WHERE id = $1', [usuarioId]);
  return usuario?.zona_horaria || ZONA_EVENTOS;
}

/**
 * Integrantes activos del proyecto (los que pueden ser participantes de una reunión).
 *
 * @param {number} proyectoId
 * @returns {Promise<Array<{id: number, nombre: string, rol: string}>>}
 */
async function miembrosDelProyecto(proyectoId) {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre, mp.rol
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE ORDER BY u.nombre`,
    [proyectoId],
  );
  return rows;
}

/**
 * Leer las reuniones del proyecto (o una sola) con sus participantes, con fecha y horas en la zona de quien consulta.
 *
 * @param {number} proyectoId
 * @param {string} zona
 * @param {number|null} [reunionId=null] - Para leer solo una.
 * @returns {Promise<Array<Object>>}
 */
async function leerReuniones(proyectoId, zona, reunionId = null) {
  const { rows } = await consulta(
    `SELECT e.id, e.tipo, e.titulo, e.notas, e.inicia_en AS "iniciaEn", e.termina_en AS "terminaEn",
            to_char(e.inicia_en AT TIME ZONE $2::text, 'YYYY-MM-DD') AS fecha,
            to_char(e.inicia_en AT TIME ZONE $2::text, 'HH24:MI') AS "horaInicio",
            to_char(e.termina_en AT TIME ZONE $2::text, 'HH24:MI') AS "horaFin",
            e.creado_por AS "creadoPor", c.nombre AS "creadoPorNombre", e.actualizado_en AS "actualizadoEn",
            COALESCE(json_agg(json_build_object('id', u.id, 'nombre', u.nombre) ORDER BY u.nombre)
                     FILTER (WHERE u.id IS NOT NULL), '[]') AS participantes
       FROM eventos_calendario e
       LEFT JOIN usuarios c ON c.id = e.creado_por
       LEFT JOIN eventos_participantes ep ON ep.evento_id = e.id
       LEFT JOIN usuarios u ON u.id = ep.usuario_id
      WHERE e.proyecto_id = $1 AND e.origen = 'reunion' AND ($3::int IS NULL OR e.id = $3::int)
      GROUP BY e.id, c.nombre
      ORDER BY e.inicia_en, e.id`,
    [proyectoId, zona, reunionId],
  );
  return rows;
}

/**
 * Obtener el proyecto de una reunión; lo usa la ruta para comprobar el permiso antes de llegar al servicio.
 *
 * @param {number|string} reunionId
 * @returns {Promise<number>}
 * @throws {ErrorApp} 400 si el identificador no es válido; 404 si la reunión no existe.
 */
export async function proyectoDeReunion(reunionId) {
  const id = leerId(reunionId, 'El identificador de la reunión no es válido.');
  const { rows: [fila] } = await consulta("SELECT proyecto_id FROM eventos_calendario WHERE id = $1 AND origen = 'reunion'", [id]);
  if (!fila) lanzar(404, MENSAJE_NO_ENCONTRADO);
  return fila.proyecto_id;
}

/**
 * Validar los datos de una reunión, incluido que los participantes sigan en el proyecto.
 *
 * @param {Object} datos
 * @param {number} proyectoId
 * @returns {Promise<Object>} Valores limpios (ver validarReunion).
 * @throws {ErrorApp} 400 con `detalles` por campo.
 */
async function validarParaGuardar(datos, proyectoId) {
  const { errores, valores } = validarReunion(datos);
  if (!errores.participantes && valores.participantes.length) {
    const miembros = new Set((await miembrosDelProyecto(proyectoId)).map((m) => m.id));
    if (valores.participantes.some((id) => !miembros.has(id))) {
      errores.participantes = 'Alguno de los participantes ya no es integrante activo del proyecto.';
    }
  }
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);
  return valores;
}

/**
 * Guardar los participantes de una reunión (reemplaza los anteriores).
 *
 * @param {import('pg').PoolClient} cliente
 * @param {number} reunionId
 * @param {number[]} participantes
 * @returns {Promise<void>}
 */
async function guardarParticipantes(cliente, reunionId, participantes) {
  await cliente.query('DELETE FROM eventos_participantes WHERE evento_id = $1', [reunionId]);
  if (participantes.length) {
    await cliente.query(
      'INSERT INTO eventos_participantes (evento_id, usuario_id) SELECT $1::int, UNNEST($2::int[])',
      [reunionId, participantes],
    );
  }
}

/** Lo que se guarda en la bitácora de una reunión. */
const paraBitacora = (v) => ({
  titulo: v.titulo, tipo: v.tipo, fecha: v.fecha, hora_inicio: v.horaInicio, hora_fin: v.horaFin,
  participantes: v.participantes, notas: v.notas,
});

/**
 * Listar las reuniones del proyecto con lo que necesita la pantalla (integrantes para elegir participantes).
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @returns {Promise<{zona: string, reuniones: Array<Object>, miembros: Array<Object>, puedeGestionar: boolean}>}
 * @throws {ErrorApp} 404 si la persona no tiene vínculo con el proyecto.
 */
export async function listarReuniones(actor, proyectoId) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'proyecto.ver', idProyecto);
  const zona = await zonaDe(actor.id);
  const [reuniones, miembros, puedeGestionar] = await Promise.all([
    leerReuniones(idProyecto, zona),
    miembrosDelProyecto(idProyecto),
    tienePermiso(actor, 'reunion.gestionar', idProyecto),
  ]);
  return { zona, reuniones, miembros, puedeGestionar };
}

/**
 * Crear una reunión Scrum (solo Scrum Master).
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{titulo: string, tipo: string, fecha: string, hora_inicio?: string, hora_fin?: string,
 *   participantes?: number[], notas?: string}} datos
 * @returns {Promise<Object>} La reunión creada.
 * @throws {ErrorApp} 400 con `detalles` por campo (por ejemplo, sin título o sin fecha); 403/404 por permisos.
 */
export async function crearReunion(actor, proyectoId, datos = {}) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'reunion.gestionar', idProyecto);
  const valores = await validarParaGuardar(datos, idProyecto);
  const zona = await zonaDe(actor.id);

  const id = await enTransaccion(async (cliente) => {
    const { rows: [creada] } = await cliente.query(
      `INSERT INTO eventos_calendario (origen, proyecto_id, sprint_id, tipo, titulo, notas, creado_por, inicia_en, termina_en)
       VALUES ('reunion', $1, NULL, $2, $3, $4, $5,
               ($6::text || ' ' || $7::text)::timestamp AT TIME ZONE $9::text,
               ($6::text || ' ' || $8::text)::timestamp AT TIME ZONE $9::text)
       RETURNING id`,
      [idProyecto, valores.tipo, valores.titulo, valores.notas, actor.id, valores.fecha, valores.horaInicio, valores.horaFin, zona],
    );
    await guardarParticipantes(cliente, creada.id, valores.participantes);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: idProyecto,
      accion: ACCIONES.REUNION_CREADA,
      objeto: OBJETOS.REUNION,
      objetoId: creada.id,
      despues: paraBitacora(valores),
      contexto: { zona },
    });
    return creada.id;
  });

  emitirAProyecto(idProyecto, EVENTOS.actualizado, { proyecto_id: idProyecto, reunion_id: id });
  return (await leerReuniones(idProyecto, zona, id))[0];
}

/**
 * Editar una reunión Scrum (solo Scrum Master). Se reemplazan todos sus datos, participantes incluidos.
 *
 * @param {{id: number}} actor
 * @param {number|string} reunionId
 * @param {Object} datos - Igual que en crearReunion.
 * @returns {Promise<Object>} La reunión actualizada.
 * @throws {ErrorApp} 400 con `detalles` por campo; 403/404 por permisos o si la reunión ya no existe.
 */
export async function actualizarReunion(actor, reunionId, datos = {}) {
  const id = leerId(reunionId, 'El identificador de la reunión no es válido.');
  const proyectoId = await proyectoDeReunion(id);
  await exigirPermiso(actor, 'reunion.gestionar', proyectoId);
  const valores = await validarParaGuardar(datos, proyectoId);
  const zona = await zonaDe(actor.id);
  const [antes] = await leerReuniones(proyectoId, zona, id);

  await enTransaccion(async (cliente) => {
    const { rows: [actualizada] } = await cliente.query(
      `UPDATE eventos_calendario
          SET tipo = $2, titulo = $3, notas = $4, actualizado_en = NOW(),
              inicia_en = ($5::text || ' ' || $6::text)::timestamp AT TIME ZONE $8::text,
              termina_en = ($5::text || ' ' || $7::text)::timestamp AT TIME ZONE $8::text
        WHERE id = $1 AND origen = 'reunion' RETURNING id`,
      [id, valores.tipo, valores.titulo, valores.notas, valores.fecha, valores.horaInicio, valores.horaFin, zona],
    );
    // Otra persona pudo eliminarla mientras se editaba
    if (!actualizada) lanzar(404, 'La reunión ya no existe: otra persona la eliminó.');
    await guardarParticipantes(cliente, id, valores.participantes);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId,
      accion: ACCIONES.REUNION_MODIFICADA,
      objeto: OBJETOS.REUNION,
      objetoId: id,
      antes: antes ? paraBitacora({ ...antes, participantes: antes.participantes.map((p) => p.id) }) : null,
      despues: paraBitacora(valores),
      contexto: { zona },
    });
  });

  emitirAProyecto(proyectoId, EVENTOS.actualizado, { proyecto_id: proyectoId, reunion_id: id });
  return (await leerReuniones(proyectoId, zona, id))[0];
}

/**
 * Eliminar una reunión Scrum (solo Scrum Master). Sus participantes se borran con ella.
 *
 * @param {{id: number}} actor
 * @param {number|string} reunionId
 * @returns {Promise<{eliminada: boolean, id: number}>}
 * @throws {ErrorApp} 403/404 por permisos o si la reunión ya no existe.
 */
export async function eliminarReunion(actor, reunionId) {
  const id = leerId(reunionId, 'El identificador de la reunión no es válido.');
  const proyectoId = await proyectoDeReunion(id);
  await exigirPermiso(actor, 'reunion.gestionar', proyectoId);

  await enTransaccion(async (cliente) => {
    const { rows: [borrada] } = await cliente.query(
      "DELETE FROM eventos_calendario WHERE id = $1 AND origen = 'reunion' RETURNING id, tipo, titulo, inicia_en",
      [id],
    );
    if (!borrada) lanzar(404, 'La reunión ya no existe: otra persona la eliminó.');
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId,
      accion: ACCIONES.REUNION_ELIMINADA,
      objeto: OBJETOS.REUNION,
      objetoId: id,
      antes: { titulo: borrada.titulo, tipo: borrada.tipo, inicia_en: borrada.inicia_en },
    });
  });

  emitirAProyecto(proyectoId, EVENTOS.actualizado, { proyecto_id: proyectoId, reunion_id: id });
  return { eliminada: true, id };
}
