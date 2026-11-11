// Responsable: Diego - HU-13, HU-14: reglas, SQL y avisos por socket (retrospectiva y acciones de mejora)
/**
 * HU-13 · Retrospectiva (ítems, votos y acciones) y HU-14 · Recordatorio de acciones pendientes.
 *
 * Tablas que usa (database/schema.sql): retros, retro_items, retro_votos, retro_acciones, sprints,
 * miembros_proyecto, usuarios y notificaciones.
 *
 * Decisiones importantes:
 *  - Hay UNA retro por sprint (UNIQUE en la tabla); se crea la primera vez que alguien la abre, solo para
 *    sprints activos o cerrados. Cerrada, queda en solo lectura (salvo marcar acciones como completadas).
 *  - Permisos: todos los roles del proyecto participan (retro.participar); cerrar la retro y ver las acciones
 *    pendientes de todo el equipo es solo del Scrum Master (retro.gestionar). Los demás ven las suyas.
 *  - Anonimato: de un ítem anónimo nunca sale el autor (ni su nombre ni su id) en la API; la persona solo
 *    recibe un "esMio" sobre sus propias notas. Los votos tampoco revelan quién votó.
 *  - Máximo MAX_VOTOS por integrante y retro; el conteo se hace bajo un candado por (retro, persona), así dos
 *    pestañas no pueden pasarse del límite.
 *  - "X la está editando": aviso en memoria que caduca solo (SEGUNDOS_EDICION) y se difunde por Socket.io. En una
 *    nota anónima el aviso dice "Alguien" para no revelar al autor.
 *  - HU-14: las acciones sin completar de retros de sprints cerrados se muestran como recordatorio mientras haya un
 *    sprint activo. El Scrum Master recibe una notificación diaria con el total pendiente y otra, una sola vez,
 *    por cada acción vencida.
 *  - Solo se vota en "Qué mejorar" (COLUMNA_VOTABLE); lo que salió bien no se prioriza.
 *
 * @author Diego Rafael Jimenez Trujano
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto, emitirAUsuario } from '../../sockets/emisor.js';
import { exigirPermiso, obtenerRolProyecto, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { enTransaccion } from '../../middlewares/auditar.js';
import { relojDe } from '../daily/daily.service.js';
import {
  MAX_VOTOS,
  COLUMNA_VOTABLE,
  SEGUNDOS_EDICION,
  MAX_TEXTO_ITEM,
  validarItem,
  validarTexto,
  validarAccion,
  votosRestantes,
  accionesIncompletas,
  estaVencida,
  diasDeRetraso,
  editaOtraPersona,
} from './retros.reglas.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = {
  actualizada: 'retro:actualizada',
  editando: 'retro:editando',
};

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

const ENLACE_RETRO = '/pages/retrospectiva.html';
const TIPO_ESCALACION = 'retro_accion_vencida';
const TIPO_RECORDATORIO = 'retro_recordatorio';

/** Quién está editando cada nota: itemId → { usuarioId, hasta }. Vive en memoria y caduca solo. */
const edicionesActivas = new Map();

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver retros.controller.js).
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

/**
 * Avisar por socket a todo el proyecto que la retro cambió (la pantalla se recarga sola).
 *
 * @param {number} proyectoId
 * @param {number} [retroId]
 * @returns {void}
 */
const avisarCambio = (proyectoId, retroId) => emitirAProyecto(proyectoId, EVENTOS.actualizada, { proyecto_id: proyectoId, retro_id: retroId ?? null });

/* ====================================================================
 * Búsquedas de contexto (a qué retro y proyecto pertenece lo que se toca)
 * ==================================================================== */

/**
 * Leer una retro con su proyecto.
 *
 * @param {number} retroId
 * @returns {Promise<{id: number, estado: string, sprint_id: number, proyecto_id: number}>}
 * @throws {ErrorApp} 404 si no existe.
 */
async function cargarRetro(retroId) {
  const { rows: [retro] } = await consulta(
    `SELECT r.id, r.estado, r.sprint_id, s.proyecto_id
       FROM retros r JOIN sprints s ON s.id = r.sprint_id WHERE r.id = $1`,
    [retroId],
  );
  if (!retro) lanzar(404, MENSAJE_NO_ENCONTRADO);
  return retro;
}

/**
 * Leer un ítem con su retro y su proyecto.
 *
 * @param {number} itemId
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si no existe.
 */
async function cargarItem(itemId) {
  const { rows: [item] } = await consulta(
    `SELECT i.id, i.retro_id, i.columna, i.autor_id, i.anonimo, r.estado, s.proyecto_id
       FROM retro_items i JOIN retros r ON r.id = i.retro_id JOIN sprints s ON s.id = r.sprint_id
      WHERE i.id = $1`,
    [itemId],
  );
  if (!item) lanzar(404, MENSAJE_NO_ENCONTRADO);
  return item;
}

/**
 * Impedir cambios en una retro ya cerrada.
 *
 * @param {{estado: string}} retro
 * @returns {void}
 * @throws {ErrorApp} 409 si está cerrada.
 */
function exigirAbierta(retro) {
  if (retro.estado === 'cerrada') lanzar(409, 'La retrospectiva ya está cerrada.');
}

/**
 * Obtener la retro de un sprint; la crea si todavía no existe (concurrencia segura con ON CONFLICT).
 *
 * @param {number} sprintId
 * @returns {Promise<{id: number, estado: string, cerrada_en: (Date|null)}>}
 */
async function retroDeSprint(sprintId) {
  await consulta('INSERT INTO retros (sprint_id) VALUES ($1) ON CONFLICT (sprint_id) DO NOTHING', [sprintId]);
  const { rows: [retro] } = await consulta('SELECT id, estado, cerrada_en FROM retros WHERE sprint_id = $1', [sprintId]);
  return retro;
}

/* ====================================================================
 * Consulta de la pantalla
 * ==================================================================== */

/**
 * Consultar la retrospectiva de un sprint con sus notas, votos y acciones.
 * Sin sprint indicado se abre la del sprint activo o, si no hay, la del último cerrado.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {number|string} [sprintTexto] - Sprint elegido en el selector.
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si el sprint no tiene retro (no es activo ni cerrado) o no es del proyecto.
 */
export async function consultar(actor, proyectoId, sprintTexto) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  // Sin vínculo vigente con el proyecto responde 404, igual que si no existiera
  const rol = await exigirPermiso(actor, 'retro.participar', idProyecto);
  const reloj = await relojDe(actor.id);

  const { rows: sprints } = await consulta(
    `SELECT id, nombre, estado FROM sprints
      WHERE proyecto_id = $1 AND estado IN ('activo', 'cerrado')
      ORDER BY fecha_inicio DESC, id DESC`,
    [idProyecto],
  );
  const sprint = sprintTexto
    ? sprints.find((s) => s.id === leerId(sprintTexto, 'El sprint no es válido.'))
    : sprints.find((s) => s.estado === 'activo') ?? sprints[0];
  if (sprintTexto && !sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);

  const base = { hoy: reloj.hoy, sprints, yo: { id: actor.id, nombre: reloj.nombre, rol }, esScrumMaster: rol === 'scrum_master' };
  if (!sprint) return { ...base, sprint: null, retro: null, columnas: { bien: [], mejorar: [] }, acciones: [], votos: null, miembros: [] };

  const retro = await retroDeSprint(sprint.id);
  const [{ rows: items }, { rows: acciones }, { rows: [usados] }, { rows: miembros }] = await Promise.all([
    consulta(
      `SELECT i.id, i.columna, i.texto, i.anonimo, i.autor_id, u.nombre AS autor_nombre, i.creado_en,
              COUNT(v.usuario_id)::int AS votos, COALESCE(BOOL_OR(v.usuario_id = $2), FALSE) AS voto_mio
         FROM retro_items i
         LEFT JOIN usuarios u ON u.id = i.autor_id
         LEFT JOIN retro_votos v ON v.item_id = i.id
        WHERE i.retro_id = $1
        GROUP BY i.id, u.nombre
        ORDER BY votos DESC, i.creado_en, i.id`,
      [retro.id, actor.id],
    ),
    consulta(
      `SELECT a.id, a.texto, a.responsable_id, u.nombre AS responsable_nombre,
              to_char(a.fecha_limite, 'YYYY-MM-DD') AS fecha_limite, a.completada
         FROM retro_acciones a LEFT JOIN usuarios u ON u.id = a.responsable_id
        WHERE a.retro_id = $1
        ORDER BY a.completada, a.fecha_limite NULLS LAST, a.id`,
      [retro.id],
    ),
    consulta(
      `SELECT COUNT(*)::int AS n FROM retro_votos v JOIN retro_items i ON i.id = v.item_id
        WHERE i.retro_id = $1 AND v.usuario_id = $2 AND i.columna = '${COLUMNA_VOTABLE}'`,
      [retro.id, actor.id],
    ),
    // Para elegir al responsable de una acción
    consulta(
      `SELECT u.id, u.nombre
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND u.activo = TRUE ORDER BY u.nombre`,
      [idProyecto],
    ),
  ]);

  // Nunca se envía el autor de un ítem anónimo (ni su id); el resto de ítems muestra su nombre
  const columnas = { bien: [], mejorar: [] };
  for (const i of items) {
    columnas[i.columna].push({
      id: i.id,
      texto: i.texto,
      anonimo: i.anonimo,
      autor: i.anonimo ? null : i.autor_nombre,
      esMio: i.autor_id === actor.id,
      votos: i.votos,
      votoMio: i.voto_mio,
      creadoEn: i.creado_en,
    });
  }

  return {
    ...base,
    sprint,
    retro: { id: retro.id, estado: retro.estado, cerradaEn: retro.cerrada_en },
    columnas,
    acciones: acciones.map((a) => ({ ...a, vencida: estaVencida(a, reloj.hoy) })),
    votos: { usados: usados.n, maximo: MAX_VOTOS, restantes: votosRestantes(usados.n) },
    miembros,
  };
}

/* ====================================================================
 * Ítems, votos y avisos de edición
 * ==================================================================== */

/**
 * Publicar una nota en "Qué salió bien" o "Qué mejorar", con o sin anonimato.
 *
 * @param {{id: number}} actor
 * @param {number|string} retroId
 * @param {{columna: string, texto: string, anonimo?: boolean}} datos
 * @returns {Promise<{id: number}>}
 * @throws {ErrorApp} 400 con `detalles` si el ítem está vacío o la columna no es válida; 409 si la retro está cerrada.
 */
export async function crearItem(actor, retroId, datos) {
  const retro = await cargarRetro(leerId(retroId, 'El identificador de la retrospectiva no es válido.'));
  await exigirPermiso(actor, 'retro.participar', retro.proyecto_id);
  exigirAbierta(retro);

  const { errores, valores } = validarItem(datos);
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const { rows: [item] } = await consulta(
    'INSERT INTO retro_items (retro_id, columna, texto, autor_id, anonimo) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [retro.id, valores.columna, valores.texto, actor.id, valores.anonimo],
  );
  avisarCambio(retro.proyecto_id, retro.id);
  return item;
}

/**
 * Editar el texto de una nota. Si otra persona la tiene en edición, se avisa con "X la está editando".
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @param {{texto: string}} datos
 * @returns {Promise<{id: number}>}
 * @throws {ErrorApp} 400 texto vacío; 409 retro cerrada o nota en edición por otra persona.
 */
export async function editarItem(actor, itemId, datos) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  exigirAbierta(item);
  await exigirSinEditor(actor, item);

  const { texto, error } = validarTexto(datos?.texto, MAX_TEXTO_ITEM, 'El ítem no puede quedar vacío.');
  if (error) lanzar(400, 'Revisa los campos marcados.', { texto: error });

  await consulta('UPDATE retro_items SET texto = $2 WHERE id = $1', [item.id, texto]);
  liberarEdicion(item, actor);
  avisarCambio(item.proyecto_id, item.retro_id);
  return { id: item.id };
}

/**
 * Eliminar una nota: solo quien la escribió o el Scrum Master (para moderar).
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @returns {Promise<{id: number}>}
 * @throws {ErrorApp} 403 si no es suya ni es Scrum Master; 409 si la retro está cerrada.
 */
export async function eliminarItem(actor, itemId) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  const rol = await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  exigirAbierta(item);
  if (item.autor_id !== actor.id && rol !== 'scrum_master') lanzar(403, 'Solo puedes eliminar tus propias notas.');

  await consulta('DELETE FROM retro_items WHERE id = $1', [item.id]);
  edicionesActivas.delete(item.id);
  avisarCambio(item.proyecto_id, item.retro_id);
  return { id: item.id };
}

/**
 * Votar por una nota. Cada integrante tiene MAX_VOTOS por retro y un voto por nota; repetirlo no hace nada.
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @returns {Promise<{votos: number, restantes: number}>} Votos de la nota y votos que le quedan a la persona.
 * @throws {ErrorApp} 400 si la nota no es de "Qué mejorar" o ya usó todos sus votos; 409 si la retro está cerrada.
 */
export async function votar(actor, itemId) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  exigirAbierta(item);
  if (item.columna !== COLUMNA_VOTABLE) lanzar(400, 'Solo se vota en las notas de «Qué mejorar».');

  const resultado = await enTransaccion(async (cliente) => {
    // Candado por (retro, persona): dos pestañas votando a la vez no pueden pasarse del límite
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [item.retro_id, actor.id]);
    const { rows: [yaVoto] } = await cliente.query('SELECT 1 FROM retro_votos WHERE item_id = $1 AND usuario_id = $2', [item.id, actor.id]);
    if (!yaVoto) {
      const { rows: [usados] } = await cliente.query(
        `SELECT COUNT(*)::int AS n FROM retro_votos v JOIN retro_items i ON i.id = v.item_id
          WHERE i.retro_id = $1 AND v.usuario_id = $2 AND i.columna = '${COLUMNA_VOTABLE}'`,
        [item.retro_id, actor.id],
      );
      if (usados.n >= MAX_VOTOS) {
        lanzar(400, `Ya usaste tus ${MAX_VOTOS} votos. Quita uno para votar por otra nota.`, { restantes: 0 });
      }
      await cliente.query('INSERT INTO retro_votos (item_id, usuario_id) VALUES ($1, $2)', [item.id, actor.id]);
    }
    return contarVotos(cliente, item, actor.id);
  });
  avisarCambio(item.proyecto_id, item.retro_id);
  return resultado;
}

/**
 * Quitar el voto propio de una nota (devuelve el voto al integrante).
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @returns {Promise<{votos: number, restantes: number}>}
 */
export async function quitarVoto(actor, itemId) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  exigirAbierta(item);

  await consulta('DELETE FROM retro_votos WHERE item_id = $1 AND usuario_id = $2', [item.id, actor.id]);
  avisarCambio(item.proyecto_id, item.retro_id);
  return contarVotos({ query: consulta }, item, actor.id);
}

/**
 * Contar los votos de una nota y los que le quedan a la persona.
 *
 * @param {{query: Function}} cliente - Pool o cliente de una transacción.
 * @param {{id: number, retro_id: number}} item
 * @param {number} usuarioId
 * @returns {Promise<{votos: number, restantes: number}>}
 */
async function contarVotos(cliente, item, usuarioId) {
  const { rows: [r] } = await cliente.query(
    `SELECT (SELECT COUNT(*)::int FROM retro_votos WHERE item_id = $1) AS votos,
            (SELECT COUNT(*)::int FROM retro_votos v JOIN retro_items i ON i.id = v.item_id
              WHERE i.retro_id = $2 AND v.usuario_id = $3 AND i.columna = '${COLUMNA_VOTABLE}') AS usados`,
    [item.id, item.retro_id, usuarioId],
  );
  return { votos: r.votos, restantes: votosRestantes(r.usados) };
}

/**
 * Nombre con el que se anuncia a quien edita: en una nota anónima nunca se revela quién es.
 *
 * @param {{anonimo: boolean}} item
 * @param {string} nombre
 * @returns {string}
 */
const nombreVisible = (item, nombre) => (item.anonimo ? 'Alguien' : nombre);

/**
 * Responder 409 "X la está editando" si otra persona tiene la nota en edición.
 *
 * @param {{id: number}} actor
 * @param {{id: number, anonimo: boolean}} item
 * @returns {Promise<void>}
 * @throws {ErrorApp} 409 si otra persona la está editando.
 */
async function exigirSinEditor(actor, item) {
  const bloqueo = edicionesActivas.get(item.id);
  if (!editaOtraPersona(bloqueo, actor.id)) return;
  const { rows: [u] } = await consulta('SELECT nombre FROM usuarios WHERE id = $1', [bloqueo.usuarioId]);
  lanzar(409, `${nombreVisible(item, u?.nombre ?? 'Alguien')} la está editando.`, { editando: nombreVisible(item, u?.nombre ?? 'Alguien') });
}

/**
 * Quitar el aviso de edición de quien termina y avisar al proyecto.
 *
 * @param {{id: number, proyecto_id: number}} item
 * @param {{id: number}} actor
 * @returns {void}
 */
function liberarEdicion(item, actor) {
  if (edicionesActivas.get(item.id)?.usuarioId === actor.id) edicionesActivas.delete(item.id);
  emitirAProyecto(item.proyecto_id, EVENTOS.editando, { proyecto_id: item.proyecto_id, item_id: item.id, nombre: null });
}

/**
 * Avisar al resto del equipo que la persona está editando una nota (se renueva mientras siga editando).
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @returns {Promise<{ok: true}>}
 * @throws {ErrorApp} 409 si otra persona ya la está editando.
 */
export async function iniciarEdicion(actor, itemId) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  exigirAbierta(item);
  await exigirSinEditor(actor, item);

  edicionesActivas.set(item.id, { usuarioId: actor.id, hasta: Date.now() + SEGUNDOS_EDICION * 1000 });
  const { rows: [u] } = await consulta('SELECT nombre FROM usuarios WHERE id = $1', [actor.id]);
  emitirAProyecto(item.proyecto_id, EVENTOS.editando, {
    proyecto_id: item.proyecto_id,
    item_id: item.id,
    nombre: nombreVisible(item, u?.nombre ?? ''),
    segundos: SEGUNDOS_EDICION,
  });
  return { ok: true };
}

/**
 * Avisar que la persona dejó de editar la nota (canceló o cerró el editor).
 *
 * @param {{id: number}} actor
 * @param {number|string} itemId
 * @returns {Promise<{ok: true}>}
 */
export async function terminarEdicion(actor, itemId) {
  const item = await cargarItem(leerId(itemId, 'El identificador del ítem no es válido.'));
  await exigirPermiso(actor, 'retro.participar', item.proyecto_id);
  liberarEdicion(item, actor);
  return { ok: true };
}

/* ====================================================================
 * Acciones de mejora
 * ==================================================================== */

/**
 * Crear una acción de mejora con responsable y fecha límite obligatorios (la fecha no puede estar en el pasado).
 *
 * @param {{id: number}} actor
 * @param {number|string} retroId
 * @param {{texto: string, responsable_id: number, fecha_limite: string}} datos
 * @returns {Promise<{id: number}>}
 * @throws {ErrorApp} 400 con `detalles` por campo; 409 si la retro está cerrada.
 */
export async function crearAccion(actor, retroId, datos) {
  const retro = await cargarRetro(leerId(retroId, 'El identificador de la retrospectiva no es válido.'));
  await exigirPermiso(actor, 'retro.participar', retro.proyecto_id);
  exigirAbierta(retro);

  const { hoy } = await relojDe(actor.id);
  const { errores, valores } = validarAccion(datos, hoy);
  // El responsable debe ser alguien con rol vigente en el proyecto
  if (!errores.responsable_id && !(await obtenerRolProyecto({ id: valores.responsable_id }, retro.proyecto_id))) {
    errores.responsable_id = 'El responsable debe ser un integrante activo del proyecto.';
  }
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const { rows: [accion] } = await consulta(
    'INSERT INTO retro_acciones (retro_id, texto, responsable_id, fecha_limite) VALUES ($1, $2, $3, $4::date) RETURNING id',
    [retro.id, valores.texto, valores.responsable_id, valores.fecha_limite],
  );
  avisarCambio(retro.proyecto_id, retro.id);
  return accion;
}

/**
 * Marcar una acción como completada: la deja el responsable (o el Scrum Master si el responsable ya no está).
 * Sale de los pendientes. Funciona aunque la retro ya esté cerrada.
 *
 * @param {{id: number}} actor
 * @param {number|string} accionId
 * @returns {Promise<{id: number, completada: true}>}
 * @throws {ErrorApp} 403 si no es el responsable; 404 si no existe.
 */
export async function completarAccion(actor, accionId) {
  const id = leerId(accionId, 'El identificador de la acción no es válido.');
  const { rows: [accion] } = await consulta(
    `SELECT a.id, a.responsable_id, a.retro_id, s.proyecto_id
       FROM retro_acciones a JOIN retros r ON r.id = a.retro_id JOIN sprints s ON s.id = r.sprint_id
      WHERE a.id = $1`,
    [id],
  );
  if (!accion) lanzar(404, MENSAJE_NO_ENCONTRADO);
  const rol = await exigirPermiso(actor, 'retro.participar', accion.proyecto_id);
  if (accion.responsable_id !== actor.id && rol !== 'scrum_master') {
    lanzar(403, 'Solo la persona responsable puede marcar la acción como completada.');
  }

  await consulta('UPDATE retro_acciones SET completada = TRUE WHERE id = $1', [id]);
  avisarCambio(accion.proyecto_id, accion.retro_id);
  return { id, completada: true };
}

/**
 * Cerrar la retro (solo Scrum Master). No se puede cerrar con acciones sin responsable o sin fecha.
 * Cerrarla dos veces no cambia nada.
 *
 * @param {{id: number}} actor
 * @param {number|string} retroId
 * @returns {Promise<{cerrada: true, yaCerrada: boolean}>}
 * @throws {ErrorApp} 400 con las acciones incompletas en `detalles`.
 */
export async function cerrarRetro(actor, retroId) {
  const retro = await cargarRetro(leerId(retroId, 'El identificador de la retrospectiva no es válido.'));
  await exigirPermiso(actor, 'retro.gestionar', retro.proyecto_id);

  const resultado = await enTransaccion(async (cliente) => {
    const { rows: [fila] } = await cliente.query('SELECT estado FROM retros WHERE id = $1 FOR UPDATE', [retro.id]);
    if (fila.estado === 'cerrada') return { cerrada: true, yaCerrada: true };

    const { rows: acciones } = await cliente.query('SELECT id, responsable_id, fecha_limite FROM retro_acciones WHERE retro_id = $1', [retro.id]);
    const incompletas = accionesIncompletas(acciones);
    if (incompletas.length) {
      lanzar(400, 'No se puede cerrar la retro: hay acciones sin responsable o sin fecha límite.', { acciones: incompletas.map((a) => a.id) });
    }
    await cliente.query("UPDATE retros SET estado = 'cerrada', cerrada_en = NOW() WHERE id = $1", [retro.id]);
    return { cerrada: true, yaCerrada: false };
  });
  if (!resultado.yaCerrada) avisarCambio(retro.proyecto_id, retro.id);
  return resultado;
}

/* ====================================================================
 * HU-14 · Recordatorio de acciones pendientes
 * ==================================================================== */

/**
 * Avisar al Scrum Master en el centro de notificaciones, con dos tipos de aviso:
 *  - Escalación: una vez por cada acción pendiente que ya venció.
 *  - Recordatorio: uno al día con cuántas acciones de retros anteriores siguen sin completar.
 * Corre en una transacción con un candado por proyecto para no duplicar avisos si dos personas consultan
 * a la vez. Un fallo aquí nunca debe romper a quien llama, por eso se captura fuera.
 *
 * @param {number} proyectoId
 * @param {string} hoy - "AAAA-MM-DD" de quien consulta.
 * @returns {Promise<number>} Cuántos avisos nuevos se crearon.
 */
export async function avisarAlScrumMaster(proyectoId, hoy) {
  const columnas = 'id, usuario_id, tipo, titulo, mensaje, enlace, referencia_id, metadatos, leida, creado_en';
  const scrumMasters = `(SELECT mp.usuario_id FROM miembros_proyecto mp JOIN usuarios us ON us.id = mp.usuario_id
                          WHERE mp.proyecto_id = $1 AND mp.rol = 'scrum_master' AND us.activo = TRUE) sm`;
  const desde = `FROM retro_acciones a
         JOIN retros r ON r.id = a.retro_id
         JOIN sprints s ON s.id = r.sprint_id`;

  const nuevos = await enTransaccion(async (cliente) => {
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [proyectoId, 14]);
    const { rows: vencidas } = await cliente.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, referencia_id)
       SELECT sm.usuario_id, $3, 'Acción de retro vencida',
              'La acción «' || a.texto || '» (responsable: ' || COALESCE(u.nombre, 'sin responsable') || ') venció el '
                || to_char(a.fecha_limite, 'DD/MM/YYYY') || ' y sigue pendiente.',
              $4, a.id
         ${desde}
         CROSS JOIN ${scrumMasters}
         LEFT JOIN usuarios u ON u.id = a.responsable_id
        WHERE s.proyecto_id = $1 AND a.completada = FALSE AND a.fecha_limite < $2::date
          AND NOT EXISTS (SELECT 1 FROM notificaciones n
                           WHERE n.tipo = $3 AND n.referencia_id = a.id AND n.usuario_id = sm.usuario_id)
       RETURNING ${columnas}`,
      [proyectoId, hoy, TIPO_ESCALACION, ENLACE_RETRO],
    );
    const { rows: recordatorios } = await cliente.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, referencia_id, metadatos)
       SELECT sm.usuario_id, $3, 'Acciones de retro pendientes',
              'Hay ' || p.total || CASE WHEN p.total = 1 THEN ' acción' ELSE ' acciones' END
                || ' de retros anteriores sin completar' || CASE WHEN p.vencidas = 0 THEN '.' WHEN p.vencidas = 1 THEN ' (1 vencida).' ELSE ' (' || p.vencidas || ' vencidas).' END,
              $4, $1, jsonb_build_object('dia', $2::text)
         FROM (SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE a.fecha_limite < $2::date)::int AS vencidas
                 ${desde}
                WHERE s.proyecto_id = $1 AND s.estado = 'cerrado' AND a.completada = FALSE) p
         CROSS JOIN ${scrumMasters}
        WHERE p.total > 0
          AND NOT EXISTS (SELECT 1 FROM notificaciones n
                           WHERE n.tipo = $3 AND n.referencia_id = $1 AND n.usuario_id = sm.usuario_id AND n.metadatos->>'dia' = $2::text)
       RETURNING ${columnas}`,
      [proyectoId, hoy, TIPO_RECORDATORIO, ENLACE_RETRO],
    );
    return [...vencidas, ...recordatorios];
  });
  // Misma forma que usa la campana de notificaciones (ver notificaciones.service.js)
  for (const n of nuevos) {
    emitirAUsuario(n.usuario_id, 'notificacion:nueva', {
      id: n.id, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje, enlace: n.enlace,
      referenciaId: n.referencia_id, metadatos: n.metadatos ?? {}, leida: n.leida, creadaEn: n.creado_en,
    });
  }
  return nuevos.length;
}

/**
 * Acciones de retros anteriores que siguen sin completar, para mostrarlas como recordatorio mientras haya
 * un sprint activo. El Scrum Master ve las de todo el equipo; cada integrante solo las suyas.
 * Sin sprint activo o sin pendientes devuelve una lista vacía (la pantalla no muestra el recordatorio).
 * Al consultar, el Scrum Master recibe su recordatorio del día y la escalación de las vencidas (ver avisarAlScrumMaster).
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @returns {Promise<{sprint: (Object|null), verTodas: boolean, hoy: string, acciones: Array}>}
 */
export async function pendientes(actor, proyectoId) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  const rol = await exigirPermiso(actor, 'retro.participar', idProyecto);
  const verTodas = rol === 'scrum_master';
  const { hoy } = await relojDe(actor.id);

  const { rows: [activo] } = await consulta(
    "SELECT id, nombre FROM sprints WHERE proyecto_id = $1 AND estado = 'activo'",
    [idProyecto],
  );
  if (!activo) return { sprint: null, verTodas, hoy, acciones: [] };

  try {
    await avisarAlScrumMaster(idProyecto, hoy);
  } catch (error) {
    console.error('[retros] No se pudo avisar al Scrum Master:', error.message);
  }

  const { rows } = await consulta(
    `SELECT a.id, a.texto, a.responsable_id, u.nombre AS responsable_nombre,
            to_char(a.fecha_limite, 'YYYY-MM-DD') AS fecha_limite, s.nombre AS sprint_origen
       FROM retro_acciones a
       JOIN retros r ON r.id = a.retro_id
       JOIN sprints s ON s.id = r.sprint_id
       LEFT JOIN usuarios u ON u.id = a.responsable_id
      WHERE s.proyecto_id = $1 AND s.estado = 'cerrado' AND a.completada = FALSE
        AND ($2::boolean OR a.responsable_id = $3)
      ORDER BY a.fecha_limite NULLS LAST, a.id`,
    [idProyecto, verTodas, actor.id],
  );

  return {
    sprint: activo,
    verTodas,
    hoy,
    acciones: rows.map((a) => ({
      ...a,
      vencida: estaVencida({ fecha_limite: a.fecha_limite, completada: false }, hoy),
      diasRetraso: diasDeRetraso(a.fecha_limite, hoy),
    })),
  };
}
