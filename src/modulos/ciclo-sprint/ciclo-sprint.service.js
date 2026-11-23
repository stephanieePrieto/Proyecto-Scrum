/**
 * @file ciclo-sprint.service.js
 * @description Iniciar y cerrar sprint.
 *
 * Tablas que usa (database/schema.sql): sprints, historias, tareas, columnas_tablero, miembros_proyecto, usuarios,
 * proyectos (DoD base) y reviews_historias (lo verificado en la Review).
 *
 * Decisiones importantes:
 *  - Iniciar y cerrar se hacen dentro de una transacción con el sprint bloqueado (SELECT ... FOR UPDATE):
 *    o se aplica todo o no cambia nada, y dos pestañas no pueden pisarse.
 *  - Solo puede haber un sprint activo por proyecto (índice único ux_un_sprint_activo_por_proyecto).
 *    Si dos Scrum Masters inician a la vez, PostgreSQL deja pasar a uno y al otro le responde
 *    409 "Ya existe un sprint activo".
 *  - Cerrar dos veces no duplica nada: si el sprint ya está cerrado, devuelve el resumen guardado.
 *  - Velocity = puntos de las historias terminadas (hecho o aceptada). si la historia tiene criterios de
 *    aceptación, solo cuenta como terminada si en la Review se aceptó con todos cumplidos; si no, se trata como
 *    no terminada (no suma y vuelve al backlog o pasa al siguiente sprint). Ver estaTerminada() en las reglas.
 *  - lo mismo con la Definition of Done: la del sprint (o la del proyecto si el sprint no tiene) más la propia de
 *    cada historia. El Scrum Master la edita desde aquí (consultarDod / guardarDod) mientras el sprint no esté cerrado.
 *  - Las historias no terminadas vuelven al backlog o pasan al siguiente sprint (con sus tareas).
 *  - Al iniciar se generan los eventos del calendario.
 *
 * @author Diego Rafael Jimenez Trujano
 * @author Citlaly Morales Viveros
 */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { sincronizarEventos } from '../calendario/calendario.service.js';
import {
  faltantesParaIniciar, calcularResumen, validarCierre, estaTerminada, faltaVerificar, ESTADOS_TERMINADA, MOTIVOS_SIN_VERIFICAR,
  validarDod,
} from './ciclo-sprint.reglas.js';
import { dodDeHistoria, separarPuntosDod } from '../reviews/reviews.reglas.js';
import { registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { avisarAlScrumMaster } from '../retros/retros.service.js';
import { relojDe } from '../daily/daily.service.js';
import { registrarCambioColumna } from '../burnup/burnup.registro.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = { iniciado: 'sprint:iniciado', cerrado: 'sprint:cerrado' };

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;
const MENSAJE_YA_ACTIVO = 'Ya existe un sprint activo en este proyecto.';

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver ciclo-sprint.controller.js).
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
 * Comprobar que la persona tiene el permiso sobre el proyecto al que pertenece el sprint.
 * Sin vínculo con el proyecto responde 404, igual que si el sprint no existiera.
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @param {string} clave - Permiso de utils/permisos.js.
 * @returns {Promise<number>} Identificador del sprint ya validado.
 */
async function exigirPermisoSobreSprint(actor, sprintId, clave) {
  const id = leerId(sprintId, 'El identificador del sprint no es válido.');
  const { rows: [fila] } = await consulta('SELECT proyecto_id FROM sprints WHERE id = $1', [id]);
  if (!fila) lanzar(404, MENSAJE_NO_ENCONTRADO);
  await exigirPermiso(actor, clave, fila.proyecto_id);
  return id;
}

/** Columnas de un sprint con sus fechas como texto. */
const COLUMNAS_SPRINT = `s.id, s.proyecto_id, s.nombre, s.objetivo, s.capacidad_horas, s.estado, s.velocity,
  to_char(s.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(s.fecha_fin, 'YYYY-MM-DD') AS fecha_fin`;

/**
 * Comprobar si el proyecto tiene Scrum Master y Product Owner activos.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} proyectoId
 * @returns {Promise<{tieneScrumMaster: boolean, tieneProductOwner: boolean}>}
 */
async function rolesDelProyecto(cliente, proyectoId) {
  const { rows } = await cliente.query(
    `SELECT mp.rol, COUNT(*)::int AS n
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE AND mp.rol IN ('scrum_master', 'product_owner')
      GROUP BY mp.rol`,
    [proyectoId],
  );
  const tiene = (rol) => rows.some((r) => r.rol === rol && r.n > 0);
  return { tieneScrumMaster: tiene('scrum_master'), tieneProductOwner: tiene('product_owner') };
}

/**
 * Leer las historias de un sprint con lo que se verificó de ellas en la Review de ese sprint.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} sprintId
 * @returns {Promise<Array<{id: number, numero_hu: number, titulo: string, puntos: number|null, estado: string,
 *   criterios: (string|null), decision: (string|null), criterios_cumplidos: (number|null),
 *   dod_proyecto: (string|null), dod_sprint: (string|null), dod_historia: (string|null), dod_cumplidos: (number|null)}>>}
 */
async function historiasDelSprint(cliente, sprintId) {
  const { rows } = await cliente.query(
    `SELECT h.id, h.numero_hu, h.titulo, h.puntos, h.criterios, r.decision, r.criterios_cumplidos,
            p.definition_of_done AS dod_proyecto, s.definition_of_done AS dod_sprint,
            h.definition_of_done AS dod_historia, r.dod_cumplidos,
            CASE WHEN r.decision = 'aceptada' THEN 'aceptada' ELSE h.estado END AS estado
       FROM historias h
       JOIN sprints s ON s.id = h.sprint_id
       JOIN proyectos p ON p.id = s.proyecto_id
       LEFT JOIN reviews_historias r ON r.sprint_id = h.sprint_id AND r.historia_id = h.id
      WHERE h.sprint_id = $1 ORDER BY h.numero_hu`,
    [sprintId],
  );
  return rows;
}

/**
 * Dejar una historia lista para la pantalla de cierre: si cuenta como terminada y, si estaba en Hecho pero no
 * pasó la verificación de la Review, por qué.
 *
 * @param {Object} h - Fila de historiasDelSprint().
 * @returns {Object}
 */
function historiaParaCierre({
  criterios, decision, criterios_cumplidos: cumplidos, dod_proyecto: dodProyecto, dod_sprint: dodSprint,
  dod_historia: dodHistoria, dod_cumplidos: dodCumplidos, ...h
}) {
  const verificacion = {
    criterios, decision, criterios_cumplidos: cumplidos,
    dod_proyecto: dodProyecto, dod_sprint: dodSprint, dod_historia: dodHistoria, dod_cumplidos: dodCumplidos,
  };
  const sinVerificar = ESTADOS_TERMINADA.includes(h.estado) ? faltaVerificar(verificacion) : [];
  return {
    ...h,
    terminada: estaTerminada({ ...h, ...verificacion }),
    sinVerificar: sinVerificar.map((motivo) => MOTIVOS_SIN_VERIFICAR[motivo]),
  };
}

/**
 * Buscar las historias que tienen tarjetas en una columna "En revisión" (que no sea la final).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} sprintId
 * @returns {Promise<Array<{id: number, numero_hu: number, titulo: string, tarjetas: number}>>}
 */
async function historiasEnRevision(cliente, sprintId) {
  const { rows } = await cliente.query(
    `SELECT h.id, h.numero_hu, h.titulo, COUNT(t.id)::int AS tarjetas
       FROM tareas t
       JOIN columnas_tablero c ON c.id = t.columna_id
       JOIN historias h ON h.id = t.historia_id
      WHERE t.sprint_id = $1 AND c.es_final = FALSE AND c.nombre ~* '^en revisi'
        AND h.estado = 'en_sprint'
      GROUP BY h.id, h.numero_hu, h.titulo ORDER BY h.numero_hu`,
    [sprintId],
  );
  return rows;
}

/**
 * Buscar el siguiente sprint planificado del proyecto (el indicado o, si no, el que empieza primero).
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} proyectoId
 * @param {number|null} [elegido] - Identificador pedido por la persona.
 * @returns {Promise<{id: number, nombre: string}|null>}
 */
async function siguienteSprint(cliente, proyectoId, elegido = null) {
  const { rows } = await cliente.query(
    `SELECT id, nombre FROM sprints
      WHERE proyecto_id = $1 AND estado = 'planificado' AND ($2::int IS NULL OR id = $2::int)
      ORDER BY fecha_inicio, id LIMIT 1`,
    [proyectoId, elegido],
  );
  return rows[0] ?? null;
}

/**
 * Consultar el ciclo del proyecto: sprint activo, sprints planificados y qué le falta a cada uno para iniciarse.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @returns {Promise<Object>} Ver docs/hu-09-15-ciclo-calendario.md.
 */
export async function estado(actor, proyectoId) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  const rol = await exigirPermiso(actor, 'sprint.gestionar', idProyecto);
  const [{ rows: sprints }, roles] = await Promise.all([
    consulta(
      `SELECT ${COLUMNAS_SPRINT},
              (SELECT COUNT(*)::int FROM historias h WHERE h.sprint_id = s.id) AS historias,
              (SELECT COALESCE(SUM(h.puntos), 0)::int FROM historias h WHERE h.sprint_id = s.id) AS puntos
         FROM sprints s WHERE s.proyecto_id = $1 AND s.estado IN ('planificado', 'activo')
        ORDER BY (s.estado = 'activo') DESC, s.fecha_inicio, s.id`,
      [proyectoId],
    ),
    rolesDelProyecto(pool, idProyecto),
  ]);

  const hayActivo = sprints.some((s) => s.estado === 'activo');
  const lista = sprints.map((s) => {
    const { faltantes } = faltantesParaIniciar({
      objetivo: s.objetivo,
      capacidad: s.capacidad_horas,
      totalHistorias: s.historias,
      ...roles,
    });
    return {
      ...s,
      capacidad_horas: Number(s.capacidad_horas),
      faltantes: s.estado === 'planificado' ? faltantes : [],
      bloqueadoPorActivo: s.estado === 'planificado' && hayActivo,
    };
  });

  return {
    activo: lista.find((s) => s.estado === 'activo') ?? null,
    planificados: lista.filter((s) => s.estado === 'planificado'),
    roles,
    yo: { id: actor.id, rol },
    puedeGestionar: rol === 'scrum_master',
  };
}

/**
 * Consultar el resumen de cierre de un sprint: historias, puntos, velocity y tarjetas en revisión.
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si el sprint no existe o la persona no tiene vínculo con su proyecto.
 */
export async function resumen(actor, sprintId) {
  const id = await exigirPermisoSobreSprint(actor, sprintId, 'sprint.gestionar');
  const { rows: [sprint] } = await consulta(`SELECT ${COLUMNAS_SPRINT} FROM sprints s WHERE s.id = $1`, [id]);
  if (!sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);

  const [historias, enRevision, siguiente] = await Promise.all([
    historiasDelSprint(pool, sprint.id),
    historiasEnRevision(pool, sprint.id),
    siguienteSprint(pool, sprint.proyecto_id),
  ]);
  return {
    sprint: { id: sprint.id, nombre: sprint.nombre, estado: sprint.estado, velocity: sprint.velocity },
    ...calcularResumen(historias),
    historias: historias.map(historiaParaCierre),
    enRevision,
    siguiente,
  };
}

/**
 * Iniciar un sprint planificado: confirma objetivo y capacidad, y lo pasa a "activo" (habilita el tablero).
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @param {{objetivo?: string, capacidad_horas?: number}} datos - Objetivo y capacidad confirmados.
 * @returns {Promise<Object>} El sprint ya activo.
 * @throws {ErrorApp} 400 si falta algo (con `detalles.faltantes`), 404 si no existe, 409 si no está planificado o ya hay uno activo.
 */
export async function iniciar(actor, sprintIdTexto, datos = {}) {
  const sprintId = await exigirPermisoSobreSprint(actor, sprintIdTexto, 'sprint.gestionar');
  const cliente = await pool.connect();
  let sprint;
  try {
    await cliente.query('BEGIN');
    const { rows: [fila] } = await cliente.query(`SELECT ${COLUMNAS_SPRINT} FROM sprints s WHERE s.id = $1 FOR UPDATE`, [sprintId]);
    if (!fila) lanzar(404, MENSAJE_NO_ENCONTRADO);
    if (fila.estado !== 'planificado') {
      lanzar(409, fila.estado === 'activo' ? 'Este sprint ya está activo.' : 'Un sprint cerrado no se puede volver a iniciar.');
    }

    const { rows: otros } = await cliente.query(
      "SELECT nombre FROM sprints WHERE proyecto_id = $1 AND estado = 'activo' AND id <> $2",
      [fila.proyecto_id, fila.id],
    );
    if (otros.length) lanzar(409, MENSAJE_YA_ACTIVO, { activo: otros[0].nombre });

    const objetivo = (datos.objetivo ?? fila.objetivo ?? '').toString().trim();
    const capacidad = datos.capacidad_horas ?? fila.capacidad_horas;
    const { rows: [{ total }] } = await cliente.query('SELECT COUNT(*)::int AS total FROM historias WHERE sprint_id = $1', [fila.id]);
    const roles = await rolesDelProyecto(cliente, fila.proyecto_id);
    const { campos, faltantes } = faltantesParaIniciar({ objetivo, capacidad, totalHistorias: total, ...roles });
    if (faltantes.length) lanzar(400, 'No se puede iniciar el sprint todavía.', { ...campos, faltantes });

    try {
      await cliente.query(
        "UPDATE sprints SET estado = 'activo', objetivo = $2, capacidad_horas = $3 WHERE id = $1",
        [fila.id, objetivo, Number(capacidad)],
      );
    } catch (error) {
      // Otra pestaña ganó la carrera: el índice único de sprint activo por proyecto lo impide
      if (error.code === '23505') lanzar(409, MENSAJE_YA_ACTIVO);
      throw error;
    }
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: fila.proyecto_id,
      accion: ACCIONES.SPRINT_INICIADO,
      objeto: OBJETOS.SPRINT,
      objetoId: fila.id,
      antes: { estado: 'planificado' },
      despues: { estado: 'activo', objetivo, capacidad_horas: Number(capacidad) },
    });
    await cliente.query('COMMIT');
    sprint = { ...fila, estado: 'activo', objetivo, capacidad_horas: Number(capacidad) };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  // El calendario se genera aparte: si fallara, el sprint ya está activo y se regenera en la siguiente consulta
  try {
    await sincronizarEventos(sprint.proyecto_id, { id: sprint.id, nombre: sprint.nombre, fechaInicio: sprint.fecha_inicio, fechaFin: sprint.fecha_fin });
  } catch (error) {
    console.error('[ciclo-sprint] No se pudo generar el calendario:', error.message);
  }
  try {
    await avisarAlScrumMaster(sprint.proyecto_id, (await relojDe(actor.id)).hoy);
  } catch (error) {
    console.error('[ciclo-sprint] No se pudo recordar las acciones de retro pendientes:', error.message);
  }
  emitirAProyecto(sprint.proyecto_id, EVENTOS.iniciado, { proyecto_id: sprint.proyecto_id, sprint_id: sprint.id });
  return sprint;
}

/**
 * Cerrar el sprint activo: calcula la velocity y decide qué pasa con las historias no terminadas.
 * Todo ocurre en una transacción; un reintento sobre un sprint ya cerrado no repite nada.
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @param {{destino?: 'backlog'|'siguiente', siguienteSprintId?: number, revision?: 'hecho'|'pendiente'}} decisiones
 * @returns {Promise<Object>} Resumen del cierre (`yaCerrado: true` si ya estaba cerrado).
 * @throws {ErrorApp} 400 con `detalles` si falta una decisión, 404 si no existe, 409 si el sprint no está activo.
 */
export async function cerrar(actor, sprintIdTexto, decisiones = {}) {
  const sprintId = await exigirPermisoSobreSprint(actor, sprintIdTexto, 'sprint.gestionar');
  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    const { rows: [sprint] } = await cliente.query(`SELECT ${COLUMNAS_SPRINT} FROM sprints s WHERE s.id = $1 FOR UPDATE`, [sprintId]);
    if (!sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);

    if (sprint.estado === 'cerrado') {
      // Reintento (por ejemplo, tras perder la conexión): devolver lo guardado sin tocar nada
      const historias = await historiasDelSprint(cliente, sprint.id);
      await cliente.query('ROLLBACK');
      return { yaCerrado: true, sprint: { id: sprint.id, nombre: sprint.nombre }, velocity: sprint.velocity, ...calcularResumen(historias) };
    }
    if (sprint.estado !== 'activo') lanzar(409, 'Solo se puede cerrar un sprint activo.');

    let historias = await historiasDelSprint(cliente, sprint.id);
    const enRevision = await historiasEnRevision(cliente, sprint.id);

    // Primero resolver la decisión sobre las tarjetas en revisión, porque cambia cuántas historias quedan sin terminar
    const errorRevision = validarCierre({ revision: decisiones.revision, noTerminadas: 0, enRevision: enRevision.length });
    if (errorRevision.revision) lanzar(400, 'Hay tarjetas en revisión.', { ...errorRevision, enRevision });
    if (decisiones.revision === 'hecho' && enRevision.length) {
      await cliente.query("UPDATE historias SET estado = 'hecho' WHERE id = ANY($1::int[]) AND estado = 'en_sprint'", [enRevision.map((h) => h.id)]);
      historias = await historiasDelSprint(cliente, sprint.id);
    }

    const calculo = calcularResumen(historias);
    const errores = validarCierre({ destino: decisiones.destino, revision: decisiones.revision, noTerminadas: calculo.noTerminadas, enRevision: 0 });
    if (Object.keys(errores).length) lanzar(400, 'Falta una decisión para cerrar el sprint.', errores);

    // las que no pasaron la verificación de la Review también son pendientes, aunque estén en Hecho
    const pendientes = historias.filter((h) => !estaTerminada(h)).map((h) => h.id);
    let destino = null;
    if (pendientes.length) {
      if (decisiones.destino === 'siguiente') {
        destino = await siguienteSprint(cliente, sprint.proyecto_id, Number(decisiones.siguienteSprintId) || null);
        if (!destino) lanzar(400, 'No existe un sprint siguiente.', { siguiente: 'No hay un sprint planificado al que pasar las historias. Créalo primero.' });
      }
      const nuevoSprint = destino?.id ?? null;
      await cliente.query(
        "UPDATE historias SET sprint_id = $2, estado = CASE WHEN $2::int IS NULL THEN 'backlog' ELSE 'en_sprint' END WHERE id = ANY($1::int[])",
        [pendientes, nuevoSprint],
      );
      // CFD: si las historias vuelven al backlog, sus tarjetas salen de su columna
      // actual (el UPDATE de abajo les pone columna_id = NULL). Se registra el cambio ANTES
      // del UPDATE, dentro de la misma transacción; si pasan al siguiente sprint la columna
      // se conserva y no hay nada que registrar.
      if (nuevoSprint === null) {
        const { rows: tarjetasDevueltas } = await cliente.query(
          'SELECT id, columna_id FROM tareas WHERE historia_id = ANY($1::int[]) AND sprint_id = $2 AND columna_id IS NOT NULL',
          [pendientes, sprint.id],
        );
        for (const tarjeta of tarjetasDevueltas) {
          await registrarCambioColumna(cliente, {
            tareaId: tarjeta.id,
            usuarioId: actor.id,
            anteriorId: tarjeta.columna_id,
            nuevaId: null,
          });
        }
      }
      await cliente.query(
        'UPDATE tareas SET sprint_id = $2, columna_id = CASE WHEN $2::int IS NULL THEN NULL ELSE columna_id END WHERE historia_id = ANY($1::int[]) AND sprint_id = $3',
        [pendientes, nuevoSprint, sprint.id],
      );
    }

    // calculo.velocity ya solo suma historias terminadas y verificadas en la Review (aceptadas con sus criterios),
    // así que no se sustituye por la suma de aceptadas de la Review (podía incluir aceptadas con criterios incompletos).
    await cliente.query("UPDATE sprints SET estado = 'cerrado', velocity = $2, cerrado_en = NOW() WHERE id = $1", [sprint.id, calculo.velocity]);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: sprint.proyecto_id,
      accion: ACCIONES.SPRINT_CERRADO,
      objeto: OBJETOS.SPRINT,
      objetoId: sprint.id,
      antes: { estado: 'activo' },
      despues: { estado: 'cerrado', velocity: calculo.velocity },
      contexto: {
        historias_pendientes: pendientes,
        destino: destino ? destino.nombre : pendientes.length ? 'backlog' : null,
        historias_marcadas_hecho: decisiones.revision === 'hecho' ? enRevision.map((h) => h.id) : [],
      },
    });
    await cliente.query('COMMIT');
    resultado = { yaCerrado: false, sprint: { id: sprint.id, nombre: sprint.nombre, proyecto_id: sprint.proyecto_id }, ...calculo, trasladadas: pendientes.length, destino: destino ? destino.nombre : pendientes.length ? 'backlog' : null };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => { });
    throw error;
  } finally {
    cliente.release();
  }

  emitirAProyecto(resultado.sprint.proyecto_id, EVENTOS.cerrado, { proyecto_id: resultado.sprint.proyecto_id, sprint_id: resultado.sprint.id });
  return resultado;
}

/* ====================================================================
 * Definition of Done del sprint y de sus historias
 * ==================================================================== */

/**
 * Leer la Definition of Done de un sprint y la de cada una de sus historias, con la DoD que resulta para cada una.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} cliente
 * @param {number} sprintId
 * @returns {Promise<Object|null>} null si el sprint no existe.
 */
async function leerDod(cliente, sprintId) {
  const { rows: [sprint] } = await cliente.query(
    `SELECT s.id, s.proyecto_id, s.nombre, s.estado, s.definition_of_done, p.definition_of_done AS dod_proyecto
       FROM sprints s JOIN proyectos p ON p.id = s.proyecto_id WHERE s.id = $1`,
    [sprintId],
  );
  if (!sprint) return null;
  const { rows: historias } = await cliente.query(
    'SELECT id, numero_hu, titulo, definition_of_done FROM historias WHERE sprint_id = $1 ORDER BY numero_hu',
    [sprintId],
  );
  const base = { dodProyecto: sprint.dod_proyecto, dodSprint: sprint.definition_of_done };
  return {
    sprint: { id: sprint.id, nombre: sprint.nombre, estado: sprint.estado, definition_of_done: sprint.definition_of_done },
    proyecto: { definition_of_done: sprint.dod_proyecto },
    // Lo que aplica a todas las historias: la del sprint o, si no tiene, la del proyecto
    base: dodDeHistoria(base),
    heredaDelProyecto: separarPuntosDod(sprint.definition_of_done).length === 0,
    historias: historias.map((h) => ({
      id: h.id,
      numero_hu: h.numero_hu,
      titulo: h.titulo,
      definition_of_done: h.definition_of_done,
      dod: dodDeHistoria({ ...base, dodHistoria: h.definition_of_done }),
    })),
    editable: sprint.estado !== 'cerrado',
    proyectoId: sprint.proyecto_id,
  };
}

/**
 * Consultar la Definition of Done de un sprint y de sus historias (solo Scrum Master).
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si el sprint no existe o la persona no tiene vínculo con su proyecto.
 */
export async function consultarDod(actor, sprintId) {
  const id = await exigirPermisoSobreSprint(actor, sprintId, 'sprint.gestionar');
  const datos = await leerDod(pool, id);
  if (!datos) lanzar(404, MENSAJE_NO_ENCONTRADO);
  const { proyectoId, ...respuesta } = datos;
  return respuesta;
}

/**
 * Guardar la Definition of Done del sprint y la propia de las historias indicadas, en una sola transacción.
 * La del sprint vacía vuelve a usar la del proyecto. No se puede cambiar en un sprint cerrado: su Review ya se verificó
 * con la DoD que tenía. El cambio del sprint queda en la bitácora (sprint_modificado) y el de cada historia también
 * (historia_modificada).
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintIdTexto
 * @param {{definition_of_done?: (string|null), historias?: Array<{id: number, definition_of_done?: (string|null)}>}} datos
 * @returns {Promise<Object>} La DoD ya guardada (misma forma que consultarDod).
 * @throws {ErrorApp} 400 con `detalles` por campo; 404 si no existe o una historia no es del sprint; 409 si el sprint está cerrado.
 */
export async function guardarDod(actor, sprintIdTexto, datos = {}) {
  const sprintId = await exigirPermisoSobreSprint(actor, sprintIdTexto, 'sprint.gestionar');
  const { errores, valores } = validarDod(datos);
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: [sprint] } = await cliente.query('SELECT id, proyecto_id, estado, definition_of_done FROM sprints WHERE id = $1 FOR UPDATE', [sprintId]);
    if (!sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);
    if (sprint.estado === 'cerrado') lanzar(409, 'El sprint ya está cerrado: su Definition of Done ya no se puede cambiar.');

    if ((sprint.definition_of_done ?? null) !== valores.sprint) {
      await cliente.query('UPDATE sprints SET definition_of_done = $2 WHERE id = $1', [sprint.id, valores.sprint]);
      await registrarAuditoria(cliente, {
        usuarioId: actor.id,
        proyectoId: sprint.proyecto_id,
        accion: ACCIONES.SPRINT_MODIFICADO,
        objeto: OBJETOS.SPRINT,
        objetoId: sprint.id,
        antes: { definition_of_done: sprint.definition_of_done ?? null },
        despues: { definition_of_done: valores.sprint },
      });
    }

    if (valores.historias.length) {
      const { rows: actuales } = await cliente.query(
        'SELECT id, numero_hu, definition_of_done FROM historias WHERE id = ANY($1::int[]) AND sprint_id = $2 FOR UPDATE',
        [valores.historias.map((h) => h.id), sprint.id],
      );
      if (actuales.length !== valores.historias.length) lanzar(404, 'Alguna de las historias ya no pertenece a este sprint. Recarga la pantalla.');
      const porId = new Map(actuales.map((h) => [h.id, h]));
      for (const { id, texto } of valores.historias) {
        const antes = porId.get(id);
        if ((antes.definition_of_done ?? null) === texto) continue;
        await cliente.query('UPDATE historias SET definition_of_done = $2, version = version + 1 WHERE id = $1', [id, texto]);
        await registrarAuditoria(cliente, {
          usuarioId: actor.id,
          proyectoId: sprint.proyecto_id,
          accion: ACCIONES.HISTORIA_MODIFICADA,
          objeto: OBJETOS.HISTORIA,
          objetoId: id,
          antes: { definition_of_done: antes.definition_of_done ?? null },
          despues: { definition_of_done: texto },
          contexto: { sprint_id: sprint.id, numero_hu: antes.numero_hu, origen: 'dod_sprint' },
        });
      }
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => { });
    throw error;
  } finally {
    cliente.release();
  }
  return consultarDod(actor, sprintId);
}
