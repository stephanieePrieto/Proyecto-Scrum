/**
 * @file releases.service.js
 * @description Releases: el Product Owner agrupa sprints en releases para comunicar el plan de entregas.
 * Tablas que usa (database/schema.sql): releases, sprints (release_id), historias, reviews_historias, proyectos
 * y bitacora (vía auditar.js).
 *
 * Decisiones importantes:
 *  - Un sprint pertenece como máximo a un release (columna sprints.release_id). Asignarlo a otro release se rechaza
 *    con 409 y la explicación; primero hay que quitarlo del que tiene. Asignarlo al mismo no cambia nada.
 *  - Eliminar un release solo quita la agrupación: la llave foránea pone release_id en NULL y los sprints se conservan.
 *  - Un sprint agrupado no se puede eliminar: lo impide el trigger tg_sprint_en_release de la base de datos y, para
 *    dar un mensaje claro antes de intentarlo, cualquier módulo puede llamar a validarEliminacionSprint().
 *  - El avance de cada release se calcula al consultar: una historia cuenta como terminada con la misma regla que al
 *    cerrar el sprint (estaTerminada de ciclo-sprint: aceptada en la Review con criterios y DoD completos).
 *  - Ver los releases es de todo el proyecto (proyecto.ver); crearlos, editarlos y asignarles sprints es del
 *    Product Owner (release.gestionar). Cada petición vuelve a comprobar el permiso: la pantalla solo oculta botones.
 *  - Todo cambio se registra en la bitácora dentro de la misma transacción.
 *
 * @author Diego Rafael Jiménez Trujano
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso, tienePermiso, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { enTransaccion, registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { estaTerminada } from '../ciclo-sprint/ciclo-sprint.reglas.js';
import {
  validarRelease, leerSprints, calcularProgreso, mensajeSprintEnOtroRelease, mensajeSprintAgrupado,
} from './releases.reglas.js';

/** Nombre del evento en tiempo real (la pantalla de releases lo escucha). */
export const EVENTOS = { actualizado: 'release:actualizado' };

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
function leerId(valor, mensaje = 'El identificador no es válido.') {
  const numero = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? NaN : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > ENTERO_MAXIMO) lanzar(400, mensaje);
  return numero;
}

/** Avisar por socket a todo el proyecto que sus releases cambiaron (la pantalla se recarga sola). */
const avisarCambio = (proyectoId) => emitirAProyecto(proyectoId, EVENTOS.actualizado, { proyecto_id: proyectoId });

/**
 * Obtener el proyecto de un release; lo usa la ruta para comprobar el permiso antes de llegar al servicio.
 *
 * @param {number|string} releaseId
 * @returns {Promise<number>}
 * @throws {ErrorApp} 400 si el identificador no es válido; 404 si el release no existe.
 */
export async function proyectoDeRelease(releaseId) {
  const id = leerId(releaseId, 'El identificador del release no es válido.');
  const { rows: [fila] } = await consulta('SELECT proyecto_id FROM releases WHERE id = $1', [id]);
  if (!fila) lanzar(404, MENSAJE_NO_ENCONTRADO);
  return fila.proyecto_id;
}

/**
 * Leer un release y comprobar que la persona puede gestionarlo.
 *
 * @param {{id: number}} actor
 * @param {number|string} releaseId
 * @returns {Promise<{id: number, proyecto_id: number, nombre: string}>}
 * @throws {ErrorApp} 404 si no existe o no hay vínculo con su proyecto; 403 si el rol no alcanza.
 */
async function releaseGestionable(actor, releaseId) {
  const id = leerId(releaseId, 'El identificador del release no es válido.');
  const { rows: [release] } = await consulta(
    `SELECT id, proyecto_id, nombre, descripcion, to_char(fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo
       FROM releases WHERE id = $1`,
    [id],
  );
  if (!release) lanzar(404, MENSAJE_NO_ENCONTRADO);
  await exigirPermiso(actor, 'release.gestionar', release.proyecto_id);
  return release;
}

/**
 * Traducir el error de nombre repetido de PostgreSQL a un 409 con el campo marcado.
 *
 * @param {Error} error
 * @returns {never}
 */
function relanzarNombreRepetido(error) {
  if (error.code === '23505') lanzar(409, 'Ya existe un release con ese nombre en el proyecto.', { nombre: 'Ya existe un release con ese nombre.' });
  throw error;
}

/* ====================================================================
 * Consulta de la línea de tiempo
 * ==================================================================== */

/**
 * Consultar los releases del proyecto con sus sprints en orden cronológico y su avance, y los sprints sin release.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @returns {Promise<{releases: Array<Object>, sinRelease: Array<Object>, puedeGestionar: boolean}>}
 * @throws {ErrorApp} 404 si la persona no tiene vínculo con el proyecto.
 */
export async function listar(actor, proyectoId) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'proyecto.ver', idProyecto);

  const [{ rows: releases }, { rows: sprints }, { rows: historias }, puedeGestionar] = await Promise.all([
    consulta(
      `SELECT r.id, r.nombre, r.descripcion, to_char(r.fecha_objetivo, 'YYYY-MM-DD') AS fecha_objetivo, r.creado_en
         FROM releases r WHERE r.proyecto_id = $1`,
      [idProyecto],
    ),
    consulta(
      `SELECT s.id, s.nombre, s.estado, s.release_id, s.velocity,
              to_char(s.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(s.fecha_fin, 'YYYY-MM-DD') AS fecha_fin
         FROM sprints s WHERE s.proyecto_id = $1 ORDER BY s.fecha_inicio, s.id`,
      [idProyecto],
    ),
    // Lo mismo que lee el cierre del sprint para decidir si una historia cuenta como terminada
    consulta(
      `SELECT h.sprint_id, h.puntos, h.criterios, r.decision, r.criterios_cumplidos,
              p.definition_of_done AS dod_proyecto, s.definition_of_done AS dod_sprint,
              h.definition_of_done AS dod_historia, r.dod_cumplidos,
              CASE WHEN r.decision = 'aceptada' THEN 'aceptada' ELSE h.estado END AS estado
         FROM historias h
         JOIN sprints s ON s.id = h.sprint_id
         JOIN proyectos p ON p.id = s.proyecto_id
         LEFT JOIN reviews_historias r ON r.sprint_id = h.sprint_id AND r.historia_id = h.id
        WHERE s.proyecto_id = $1`,
      [idProyecto],
    ),
    tienePermiso(actor, 'release.gestionar', idProyecto),
  ]);

  // Puntos totales y terminados de cada sprint
  const avance = new Map();
  for (const h of historias) {
    const a = avance.get(h.sprint_id) ?? { puntos: 0, puntosTerminados: 0, historias: 0 };
    const puntos = Number(h.puntos) || 0;
    a.puntos += puntos;
    a.historias += 1;
    if (estaTerminada(h)) a.puntosTerminados += puntos;
    avance.set(h.sprint_id, a);
  }
  const conAvance = sprints.map((s) => {
    const a = avance.get(s.id) ?? { puntos: 0, puntosTerminados: 0, historias: 0 };
    const porcentaje = a.puntos ? Math.round((a.puntosTerminados / a.puntos) * 100) : (s.estado === 'cerrado' ? 100 : 0);
    return { ...s, ...a, porcentaje };
  });

  const lista = releases.map((r) => {
    const suyos = conAvance.filter((s) => s.release_id === r.id);
    return {
      ...r,
      inicio: suyos[0]?.fecha_inicio ?? null,
      fin: suyos.length ? suyos[suyos.length - 1].fecha_fin : null,
      sprints: suyos,
      progreso: calcularProgreso(suyos),
    };
  });
  // Línea de tiempo: primero los releases que ya tienen sprints, por fecha; luego los vacíos, por fecha objetivo o creación
  lista.sort((a, b) => {
    const clave = (r) => r.inicio ?? r.fecha_objetivo ?? '9999-12-31';
    return clave(a).localeCompare(clave(b)) || a.id - b.id;
  });

  return { releases: lista, sinRelease: conAvance.filter((s) => s.release_id === null), puedeGestionar };
}

/* ====================================================================
 * Crear, editar y eliminar
 * ==================================================================== */

/**
 * Asignar un sprint a un release dentro de una transacción ya abierta. Bloquea el sprint para que dos asignaciones a la
 * vez no lo dejen en dos releases.
 *
 * @param {import('pg').PoolClient} cliente
 * @param {{id: number, proyecto_id: number, nombre: string}} release
 * @param {number} sprintId
 * @returns {Promise<{id: number, nombre: string, cambio: boolean}>}
 * @throws {ErrorApp} 404 si el sprint no es del proyecto; 409 si ya pertenece a otro release.
 */
async function asignarEnTransaccion(cliente, release, sprintId) {
  const { rows: [sprint] } = await cliente.query(
    `SELECT s.id, s.nombre, s.release_id, r.nombre AS release_nombre
       FROM sprints s LEFT JOIN releases r ON r.id = s.release_id
      WHERE s.id = $1 AND s.proyecto_id = $2 FOR UPDATE OF s`,
    [sprintId, release.proyecto_id],
  );
  if (!sprint) lanzar(404, 'El sprint no existe en este proyecto.');
  if (sprint.release_id === release.id) return { id: sprint.id, nombre: sprint.nombre, cambio: false };
  if (sprint.release_id !== null) {
    lanzar(409, mensajeSprintEnOtroRelease(sprint.nombre, sprint.release_nombre), {
      codigo: 'SPRINT_EN_OTRO_RELEASE', sprint: sprint.nombre, release: sprint.release_nombre,
    });
  }
  await cliente.query('UPDATE sprints SET release_id = $2 WHERE id = $1', [sprint.id, release.id]);
  return { id: sprint.id, nombre: sprint.nombre, cambio: true };
}

/**
 * Crear un release (y, si se indican, asignarle sprints de una vez).
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{nombre: string, descripcion?: string, fecha_objetivo?: string, sprints?: number[]}} datos
 * @returns {Promise<Object>} El release creado.
 * @throws {ErrorApp} 400 con `detalles` por campo; 403/404 por permisos; 409 si el nombre se repite o un sprint ya está en otro release.
 */
export async function crear(actor, proyectoId, datos = {}) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'release.gestionar', idProyecto);

  const { errores, valores } = validarRelease(datos);
  const sprints = leerSprints(datos.sprints);
  if (sprints.error) errores.sprints = sprints.error;
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const release = await enTransaccion(async (cliente) => {
    let creado;
    try {
      ({ rows: [creado] } = await cliente.query(
        `INSERT INTO releases (proyecto_id, nombre, descripcion, fecha_objetivo, creado_por)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, proyecto_id, nombre`,
        [idProyecto, valores.nombre, valores.descripcion, valores.fecha_objetivo, actor.id],
      ));
    } catch (error) {
      relanzarNombreRepetido(error);
    }
    const asignados = [];
    for (const sprintId of sprints.ids) asignados.push((await asignarEnTransaccion(cliente, creado, sprintId)).id);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: idProyecto,
      accion: ACCIONES.RELEASE_CREADO,
      objeto: OBJETOS.RELEASE,
      objetoId: creado.id,
      despues: { ...valores, sprints: asignados },
    });
    return { ...creado, ...valores, sprints: asignados };
  });

  avisarCambio(idProyecto);
  return release;
}

/**
 * Editar el nombre, la descripción o la fecha objetivo de un release.
 *
 * @param {{id: number}} actor
 * @param {number|string} releaseId
 * @param {{nombre: string, descripcion?: string, fecha_objetivo?: string}} datos
 * @returns {Promise<Object>} El release actualizado.
 * @throws {ErrorApp} 400 con `detalles` por campo; 403/404 por permisos; 409 si el nombre se repite.
 */
export async function actualizar(actor, releaseId, datos = {}) {
  const release = await releaseGestionable(actor, releaseId);
  const { errores, valores } = validarRelease(datos);
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const antes = { nombre: release.nombre, descripcion: release.descripcion, fecha_objetivo: release.fecha_objetivo };
  await enTransaccion(async (cliente) => {
    try {
      await cliente.query(
        'UPDATE releases SET nombre = $2, descripcion = $3, fecha_objetivo = $4 WHERE id = $1',
        [release.id, valores.nombre, valores.descripcion, valores.fecha_objetivo],
      );
    } catch (error) {
      relanzarNombreRepetido(error);
    }
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: release.proyecto_id,
      accion: ACCIONES.RELEASE_MODIFICADO,
      objeto: OBJETOS.RELEASE,
      objetoId: release.id,
      antes,
      despues: valores,
    });
  });

  avisarCambio(release.proyecto_id);
  return { id: release.id, proyecto_id: release.proyecto_id, ...valores };
}

/**
 * Eliminar un release. Solo se quita la agrupación: sus sprints se conservan y quedan sin release.
 *
 * @param {{id: number}} actor
 * @param {number|string} releaseId
 * @returns {Promise<{eliminado: boolean, id: number, sprintsLiberados: number[]}>}
 * @throws {ErrorApp} 403/404 por permisos.
 */
export async function eliminar(actor, releaseId) {
  const release = await releaseGestionable(actor, releaseId);
  const liberados = await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query('SELECT id FROM sprints WHERE release_id = $1 FOR UPDATE', [release.id]);
    // ON DELETE SET NULL deja los sprints sin release; no se borra ningún sprint
    await cliente.query('DELETE FROM releases WHERE id = $1', [release.id]);
    const ids = rows.map((s) => s.id);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: release.proyecto_id,
      accion: ACCIONES.RELEASE_ELIMINADO,
      objeto: OBJETOS.RELEASE,
      objetoId: release.id,
      antes: { nombre: release.nombre, descripcion: release.descripcion, fecha_objetivo: release.fecha_objetivo, sprints: ids },
      contexto: { sprints_conservados: ids },
    });
    return ids;
  });

  avisarCambio(release.proyecto_id);
  return { eliminado: true, id: release.id, sprintsLiberados: liberados };
}

/* ====================================================================
 * Sprints del release
 * ==================================================================== */

/**
 * Asignar un sprint del proyecto a un release.
 *
 * @param {{id: number}} actor
 * @param {number|string} releaseId
 * @param {{sprint_id: number}} datos
 * @returns {Promise<{release_id: number, sprint_id: number, cambio: boolean}>}
 * @throws {ErrorApp} 400 si el sprint no es válido; 403/404 por permisos; 409 si ya pertenece a otro release.
 */
export async function asignarSprint(actor, releaseId, datos = {}) {
  const release = await releaseGestionable(actor, releaseId);
  const sprintId = leerId(datos.sprint_id, 'Elige el sprint que quieres agregar al release.');
  const resultado = await enTransaccion(async (cliente) => {
    const sprint = await asignarEnTransaccion(cliente, release, sprintId);
    if (sprint.cambio) {
      await registrarAuditoria(cliente, {
        usuarioId: actor.id,
        proyectoId: release.proyecto_id,
        accion: ACCIONES.RELEASE_MODIFICADO,
        objeto: OBJETOS.RELEASE,
        objetoId: release.id,
        antes: { sprint_id: null },
        despues: { sprint_id: sprint.id },
        contexto: { operacion: 'sprint_asignado', sprint: sprint.nombre },
      });
    }
    return sprint;
  });

  if (resultado.cambio) avisarCambio(release.proyecto_id);
  return { release_id: release.id, sprint_id: resultado.id, cambio: resultado.cambio };
}

/**
 * Quitar un sprint de un release (el sprint se conserva, solo deja de estar agrupado).
 *
 * @param {{id: number}} actor
 * @param {number|string} releaseId
 * @param {number|string} sprintIdTexto
 * @returns {Promise<{release_id: number, sprint_id: number}>}
 * @throws {ErrorApp} 403/404 por permisos; 404 si el sprint no está en ese release.
 */
export async function quitarSprint(actor, releaseId, sprintIdTexto) {
  const release = await releaseGestionable(actor, releaseId);
  const sprintId = leerId(sprintIdTexto, 'El identificador del sprint no es válido.');
  await enTransaccion(async (cliente) => {
    const { rows: [sprint] } = await cliente.query(
      'UPDATE sprints SET release_id = NULL WHERE id = $1 AND release_id = $2 RETURNING id, nombre',
      [sprintId, release.id],
    );
    if (!sprint) lanzar(404, 'Ese sprint no pertenece a este release.');
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: release.proyecto_id,
      accion: ACCIONES.RELEASE_MODIFICADO,
      objeto: OBJETOS.RELEASE,
      objetoId: release.id,
      antes: { sprint_id: sprint.id },
      despues: { sprint_id: null },
      contexto: { operacion: 'sprint_quitado', sprint: sprint.nombre },
    });
  });

  avisarCambio(release.proyecto_id);
  return { release_id: release.id, sprint_id: sprintId };
}

/**
 * Comprobar, antes de eliminar un sprint, que no pertenezca a un release. Pensada para que la llame el módulo que
 * elimine sprints y así dar la explicación al usuario; la base de datos lo impide de todas formas (tg_sprint_en_release).
 *
 * @param {number|string} sprintId
 * @param {import('pg').Pool|import('pg').PoolClient|{query: Function}} [cliente] - Cliente de la transacción en curso.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 409 con `detalles.codigo = 'SPRINT_EN_RELEASE'` si el sprint está agrupado.
 */
export async function validarEliminacionSprint(sprintId, cliente = { query: consulta }) {
  const id = leerId(sprintId, 'El identificador del sprint no es válido.');
  const { rows: [fila] } = await cliente.query(
    `SELECT s.nombre, r.nombre AS release_nombre
       FROM sprints s JOIN releases r ON r.id = s.release_id WHERE s.id = $1`,
    [id],
  );
  if (fila) {
    lanzar(409, mensajeSprintAgrupado(fila.nombre, fila.release_nombre), {
      codigo: 'SPRINT_EN_RELEASE', sprint: fila.nombre, release: fila.release_nombre,
    });
  }
}
