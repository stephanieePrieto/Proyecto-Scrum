// Responsable: Alfonso - HU-24: reglas, SQL y avisos por socket (notificaciones dentro de la aplicacion)

/**
 * @file notificaciones.service.js
 * @description Núcleo de la HU-24 (Notificaciones). Responsabilidades:
 *  1. Validar preferencias del usuario ANTES de notificar.
 *  2. Persistir la notificación y emitirla por WebSocket (`notificacion:nueva`).
 *  3. Enviar correo de forma asíncrona sin comprometer la notificación in-app.
 *  4. Agrupar ráfagas de asignaciones (buffer) para evitar spam.
 *  5. Historial y marcado como leída.
 */

import * as db from './notificaciones.demo.js';
import { enviarCorreo } from '../../utils/correo.js';
import websocket from '../../sockets/emisor.js';

/* 
 * Constantes
 */

/** @constant {Readonly<{ASIGNACION:string, MENCION:string}>} Tipos de notificación válidos. */
export const TIPOS = Object.freeze({ ASIGNACION: 'asignacion', MENCION: 'mencion' });

/** @constant {string} Evento de WebSocket consumido por el frontend. */
const EVENTO_WS = 'notificacion:nueva';

/** @constant {number} Ventana (ms) de agrupamiento de ráfagas. */
const BUFFER_MS = 5000;

/** @constant {number} Máximo de eventos por ventana antes de vaciar de inmediato. */
const BUFFER_MAX_ITEMS = 50;

/** @constant {Set<string>} Tipos sujetos a agrupamiento. */
const TIPOS_AGRUPABLES = new Set([TIPOS.ASIGNACION]);

/** @constant {number} Límites de longitud para evitar abuso de almacenamiento. */
const MAX_TITULO = 200;
const MAX_MENSAJE = 500;

/** @constant {number} Paginación del historial. */
const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 100;

const COLUMNAS =
  'id, tipo, titulo, mensaje, referencia_id, metadatos, leida, creada_en';

/* 
 * Errores
 */

/**
 * Error de validación de entrada (mapeado a HTTP 400 por el controlador).
 * @extends Error
 */
export class ErrorValidacion extends Error {
  /**
   * @param {string} mensaje Descripción segura para el cliente.
   */
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacion';
  }
}

/* 
 * Utilidades internas
 */

/**
 * Buffer de ráfagas: clave `usuarioId:tipo` → entrada pendiente.
 * @type {Map<string, {items: Object[], prefs: Object, timer: NodeJS.Timeout}>}
 */
const buffer = new Map();

/**
 * Escapa caracteres HTML para el cuerpo del correo (previene inyección).
 * @param {string} texto Texto sin confiar.
 * @returns {string} Texto escapado.
 */
function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Elimina saltos de línea de un valor destinado a cabeceras (header injection).
 * @param {string} texto Texto sin confiar.
 * @returns {string} Texto en una sola línea.
 */
function sinSaltosDeLinea(texto) {
  return String(texto).replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Convierte una fila SQL a la forma camelCase que consume el frontend.
 * @param {Object} fila Fila de la tabla `notificaciones`.
 * @returns {Object} Notificación mapeada.
 */
function mapearFila(fila) {
  return {
    id: Number(fila.id),
    tipo: fila.tipo,
    titulo: fila.titulo,
    mensaje: fila.mensaje,
    referenciaId: fila.referencia_id,
    metadatos: fila.metadatos,
    leida: fila.leida,
    creadaEn: fila.creada_en,
  };
}

/**
 * Valida y sanea un evento de notificación entrante.
 * @param {Object} evento Evento sin confiar.
 * @returns {Object} Evento saneado.
 * @throws {ErrorValidacion} Si algún campo es inválido.
 */
function validarEvento(evento) {
  if (!evento || typeof evento !== 'object') {
    throw new ErrorValidacion('Evento de notificación inválido.');
  }
  const { usuarioId, tipo, titulo, mensaje, referenciaId = null } = evento;
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    throw new ErrorValidacion('usuarioId inválido.');
  }
  if (!Object.values(TIPOS).includes(tipo)) {
    throw new ErrorValidacion('Tipo de notificación no soportado.');
  }
  if (typeof titulo !== 'string' || !titulo.trim()) {
    throw new ErrorValidacion('El título es obligatorio.');
  }
  if (typeof mensaje !== 'string' || !mensaje.trim()) {
    throw new ErrorValidacion('El mensaje es obligatorio.');
  }
  if (referenciaId !== null && (!Number.isInteger(referenciaId) || referenciaId <= 0)) {
    throw new ErrorValidacion('referenciaId inválido.');
  }
  return {
    usuarioId,
    tipo,
    titulo: titulo.trim().slice(0, MAX_TITULO),
    mensaje: mensaje.trim().slice(0, MAX_MENSAJE),
    referenciaId,
  };
}

/* 
 * Preferencias
 */

/**
 * Obtiene las preferencias de notificación de un usuario activo.
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<Object|null>} Preferencias o `null` si no existe.
 */
async function obtenerPreferencias(usuarioId) {
  if (typeof db.query === 'function') {
    const { rows } = await db.query(
      `SELECT correo,
              pref_notif_asignacion AS asignacion,
              pref_notif_mencion    AS mencion,
              pref_notif_correo     AS "correoActivo"
         FROM usuarios
        WHERE id = $1`,
      [usuarioId],
    );
    return rows[0] ?? null;
  }
  // En modo demo, habilitar notificaciones por defecto para pruebas
  return { correo: 'demo@scrumflow.com', asignacion: true, mencion: true, correoActivo: false };
}

/* 
 * Persistencia, WebSocket y correo
 */

/**
 * Envía el correo de forma asíncrona.
 * @param {string} destinatario Correo del usuario.
 * @param {Object} notificacion Contenido.
 */
function despacharCorreo(destinatario, notificacion) {
  Promise.resolve()
    .then(() => typeof enviarCorreo === 'function' && enviarCorreo({
      para: destinatario,
      asunto: `[ScrumFlow] ${sinSaltosDeLinea(notificacion.titulo)}`,
      texto: `${notificacion.titulo}\n\n${notificacion.mensaje}`,
      html: `<h3>${escaparHtml(notificacion.titulo)}</h3><p>${escaparHtml(notificacion.mensaje)}</p>`,
    }))
    .catch((error) => {
      console.error('[notificaciones] Falló el envío de correo:', error?.message ?? error);
    });
}

/**
 * Persiste la notificación, la emite por WebSocket y dispara el correo.
 * @param {Object} datos Datos validados.
 * @param {Object} prefs Preferencias del usuario.
 * @returns {Promise<Object>} Notificación persistida.
 */
async function persistirYEmitir(datos, prefs) {
  let notificacion;

  if (typeof db.query === 'function') {
    const { rows } = await db.query(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, referencia_id, metadatos)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS}`,
      [
        datos.usuarioId,
        datos.tipo,
        datos.titulo,
        datos.mensaje,
        datos.referenciaId,
        JSON.stringify(datos.metadatos ?? {}),
      ],
    );
    notificacion = mapearFila(rows[0]);
  } else {
    // Si se está usando el simulador en memoria (demo)
    notificacion = await db.insertar({
      usuario_id: datos.usuarioId,
      tipo: datos.tipo,
      titulo: datos.titulo,
      mensaje: datos.mensaje,
      referencia_id: datos.referenciaId,
      metadatos: datos.metadatos ?? {},
    });
  }

  try {
    if (websocket && typeof websocket.emitirAUsuario === 'function') {
      websocket.emitirAUsuario(datos.usuarioId, EVENTO_WS, notificacion);
    }
  } catch (error) {
    console.error('[notificaciones] Falló la emisión WebSocket:', error?.message ?? error);
  }

  if (prefs?.correoActivo && prefs?.correo) {
    despacharCorreo(prefs.correo, notificacion);
  }
  return notificacion;
}

/* 
 * Buffer de ráfagas
 */

function consolidar(items) {
  if (items.length === 1) return items[0];

  const { usuarioId, tipo } = items[0];
  const nombres = items.slice(0, 3).map((i) => i.titulo).join('; ');
  const restantes = items.length - 3;
  const sufijo = restantes > 0 ? ` y ${restantes} más` : '';
  return {
    usuarioId,
    tipo,
    titulo: `Tienes ${items.length} nuevas asignaciones`,
    mensaje: `${nombres}${sufijo}`.slice(0, MAX_MENSAJE),
    referenciaId: null,
    metadatos: {
      agrupada: true,
      total: items.length,
      referencias: items.map((i) => i.referenciaId).filter((r) => r !== null),
    },
  };
}

async function vaciarEntrada(clave) {
  const entrada = buffer.get(clave);
  if (!entrada) return null;
  buffer.delete(clave);
  clearTimeout(entrada.timer);

  try {
    return await persistirYEmitir(consolidar(entrada.items), entrada.prefs);
  } catch (error) {
    console.error('[notificaciones] Falló al vaciar el buffer:', error?.message ?? error);
    return null;
  }
}

function encolar(evento, prefs) {
  const clave = `${evento.usuarioId}:${evento.tipo}`;
  let entrada = buffer.get(clave);

  if (!entrada) {
    const timer = setTimeout(() => { vaciarEntrada(clave); }, BUFFER_MS);
    timer.unref?.();
    entrada = { items: [], prefs, timer };
    buffer.set(clave, entrada);
  }

  entrada.items.push(evento);
  entrada.prefs = prefs;

  if (entrada.items.length >= BUFFER_MAX_ITEMS) vaciarEntrada(clave);
}

export async function vaciarBuffers() {
  await Promise.all([...buffer.keys()].map(vaciarEntrada));
}

/* 
 * API pública
 */

export async function notificar(evento) {
  const datos = validarEvento(evento);

  const prefs = await obtenerPreferencias(datos.usuarioId);
  if (!prefs || prefs[datos.tipo] !== true) {
    return { estado: 'omitida' };
  }

  if (TIPOS_AGRUPABLES.has(datos.tipo)) {
    encolar(datos, prefs);
    return { estado: 'agrupada' };
  }

  const notificacion = await persistirYEmitir(datos, prefs);
  return { estado: 'creada', notificacion };
}

export async function contarNoLeidas(usuarioId) {
  if (typeof db.query === 'function') {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_id = $1 AND leida = FALSE',
      [usuarioId],
    );
    return rows[0].total;
  }
  return db.contarNoLeidas ? await db.contarNoLeidas(usuarioId) : 0;
}

export async function listarPorUsuario(usuarioId, { limite = LIMITE_POR_DEFECTO, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number.parseInt(limite, 10) || LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);

  if (typeof db.query === 'function') {
    const [{ rows }, noLeidas] = await Promise.all([
      db.query(
        `SELECT ${COLUMNAS}
           FROM notificaciones
          WHERE usuario_id = $1
          ORDER BY creada_en DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [usuarioId, lim, off],
      ),
      contarNoLeidas(usuarioId),
    ]);
    return { notificaciones: rows.map(mapearFila), noLeidas };
  }

  // Soporte para datos demo en memoria
  const notificacionesDemo = db.listarPorUsuario ? await db.listarPorUsuario(usuarioId) : [];
  const noLeidas = db.contarNoLeidas ? await db.contarNoLeidas(usuarioId) : 0;
  return { notificaciones: notificacionesDemo, noLeidas };
}

export async function marcarComoLeida(id, usuarioId) {
  if (typeof db.query === 'function') {
    const { rows } = await db.query(
      `UPDATE notificaciones
          SET leida = TRUE, leida_en = COALESCE(leida_en, NOW())
        WHERE id = $1 AND usuario_id = $2
        RETURNING ${COLUMNAS}`,
      [id, usuarioId],
    );
    if (rows.length === 0) return null;
    return { notificacion: mapearFila(rows[0]), noLeidas: await contarNoLeidas(usuarioId) };
  }

  // Soporte para datos demo en memoria
  if (typeof db.marcarComoLeida === 'function') {
    return db.marcarComoLeida(id, usuarioId);
  }
  return null;
}