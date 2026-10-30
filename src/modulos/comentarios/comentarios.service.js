// Responsable: Alfonso - HU-20: reglas y SQL de comentarios y menciones (@usuario)
/**
 * @file comentarios.service.js
 * @description Persiste comentarios, valida que no esten vacios, detecta menciones `@usuario`
 *              (parte local del correo) y notifica con `notificar()` de la HU-24.
 *              Un fallo al notificar nunca invalida el comentario ya guardado.
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { notificar, TIPOS } from '../notificaciones/notificaciones.service.js';
import { enTransaccion, registrarHistorial } from '../detalle-tarjeta/detalle-tarjeta.service.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

const MAX_COMENTARIO = 2000;
const LIMITE_LISTA = 200;
const MAX_EXTRACTO = 160;

/** `@token` precedido de inicio de texto o de un caracter que no sea letra, punto o arroba (evita correos). */
const PATRON_MENCION = /(^|[^\w@.])@([\w.+-]+)/g;

/**
 * Valida y limpia el texto de un comentario.
 * @param {*} texto Texto sin confiar.
 * @returns {string} Texto sin espacios sobrantes.
 * @throws {ErrorApp} 400 si esta vacio o supera el maximo.
 */
function validarTexto(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (!limpio) throw new ErrorApp('El comentario no puede estar vacío.', 400);
  if (limpio.length > MAX_COMENTARIO) {
    throw new ErrorApp(`El comentario no puede superar ${MAX_COMENTARIO} caracteres.`, 400);
  }
  return limpio;
}

/**
 * Obtiene los nombres de usuario mencionados en un texto.
 * @param {string} texto Comentario.
 * @returns {Set<string>} Nombres de usuario en minusculas, sin punto final.
 */
export function extraerMenciones(texto) {
  const tokens = new Set();
  for (const coincidencia of texto.matchAll(PATRON_MENCION)) {
    const token = coincidencia[2].replace(/\.+$/, '').toLowerCase();
    if (token) tokens.add(token);
  }
  return tokens;
}

/** @param {Object} fila Fila de comentarios con el autor. */
function mapearComentario(fila) {
  let nombre = 'Usuario eliminado';
  if (fila.autor_id) nombre = fila.autor_activo === false ? 'Usuario inactivo' : fila.autor_nombre;
  return {
    id: fila.id,
    tareaId: fila.tarea_id,
    texto: fila.texto,
    creadoEn: fila.creado_en,
    autor: { id: fila.autor_id ?? null, nombre },
  };
}

/**
 * Lista los comentarios de una tarjeta en orden cronologico (maximo los ultimos 200).
 * @param {number} tareaId Tarjeta.
 * @returns {Promise<Object[]>}
 */
export async function listarComentarios(tareaId) {
  const { rows } = await consulta(
    `SELECT * FROM (
       SELECT c.id, c.tarea_id, c.texto, c.creado_en,
              u.id AS autor_id, u.nombre AS autor_nombre, u.activo AS autor_activo
         FROM comentarios c
         LEFT JOIN usuarios u ON u.id = c.usuario_id
        WHERE c.tarea_id = $1
        ORDER BY c.creado_en DESC, c.id DESC
        LIMIT $2
     ) ultimos
     ORDER BY creado_en ASC, id ASC`,
    [tareaId, LIMITE_LISTA],
  );
  return rows.map(mapearComentario);
}

/**
 * Lista a quien se puede mencionar: los miembros activos del proyecto.
 * @param {number} proyectoId Proyecto de la tarjeta.
 * @param {number} usuarioId Persona que consulta (se marca con `esYo`).
 * @returns {Promise<{id:number, nombre:string, usuario:string, esYo:boolean}[]>}
 */
export async function listarMencionables(proyectoId, usuarioId) {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre, LOWER(SPLIT_PART(u.correo, '@', 1)) AS usuario
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE
      ORDER BY u.nombre`,
    [proyectoId],
  );
  return rows.map((f) => ({ id: f.id, nombre: f.nombre, usuario: f.usuario, esYo: f.id === Number(usuarioId) }));
}

/**
 * Notifica a las personas mencionadas (solo miembros del proyecto, nunca al autor).
 * @param {{tareaId:number, proyectoId:number, autor:{id:number, nombre:string}, texto:string}} datos Contexto.
 * @returns {Promise<void>}
 */
async function notificarMenciones({ tareaId, proyectoId, autor, texto }) {
  const tokens = extraerMenciones(texto);
  if (tokens.size === 0) return;

  const [{ rows: destinatarios }, { rows: tareas }] = await Promise.all([
    consulta(
      `SELECT u.id
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND u.activo = TRUE AND u.id <> $2
          AND LOWER(SPLIT_PART(u.correo, '@', 1)) = ANY($3::text[])`,
      [proyectoId, autor.id, [...tokens]],
    ),
    consulta('SELECT titulo FROM tareas WHERE id = $1', [tareaId]),
  ]);

  const tituloTarea = tareas[0]?.titulo ?? 'una tarjeta';
  const extracto = texto.replace(/\s+/g, ' ').slice(0, MAX_EXTRACTO);

  const resultados = await Promise.allSettled(
    destinatarios.map((d) => notificar({
      usuarioId: d.id,
      tipo: TIPOS.MENCION,
      titulo: `${autor.nombre} te mencionó en «${tituloTarea}»`,
      mensaje: `${autor.nombre}: ${extracto}`,
      referenciaId: tareaId,
      enlace: `/pages/tablero.html?tarea=${tareaId}`,
    })),
  );
  resultados
    .filter((r) => r.status === 'rejected')
    .forEach((r) => console.error('[comentarios] Falló una notificación de mención:', r.reason?.message ?? r.reason));
}

/**
 * Publica un comentario, registra el historial y notifica las menciones.
 * @param {{tareaId:number, proyectoId:number, usuarioId:number, texto:*}} datos Datos del comentario.
 * @returns {Promise<Object>} Comentario creado.
 * @throws {ErrorApp} 400 si el comentario esta vacio o es demasiado largo.
 */
export async function crearComentario({ tareaId, proyectoId, usuarioId, texto }) {
  const limpio = validarTexto(texto);

  const fila = await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO comentarios (tarea_id, usuario_id, texto)
       VALUES ($1, $2, $3)
       RETURNING id, tarea_id, texto, creado_en, usuario_id AS autor_id`,
      [tareaId, usuarioId, limpio],
    );
    const { rows: autores } = await cliente.query(
      'SELECT nombre, activo FROM usuarios WHERE id = $1',
      [usuarioId],
    );
    await registrarHistorial(tareaId, usuarioId, 'comentario_agregado', null, cliente);
    return { ...rows[0], autor_nombre: autores[0]?.nombre, autor_activo: autores[0]?.activo };
  });

  const comentario = mapearComentario(fila);

  notificarMenciones({
    tareaId,
    proyectoId,
    autor: { id: usuarioId, nombre: comentario.autor.nombre },
    texto: limpio,
  }).catch((error) => {
    console.error('[comentarios] Falló el proceso de menciones:', error?.message ?? error);
  });

  emitirAProyecto(proyectoId, 'comentario:nuevo', { tareaId, comentario });
  return comentario;
}