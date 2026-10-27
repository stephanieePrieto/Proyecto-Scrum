// Responsable: Alfonso - HU-24: reglas, SQL y avisos por socket (notificaciones dentro de la aplicacion)

/**
 * @file notificaciones.service.js
 * @description Núcleo de la HU-24 (Notificaciones). Responsabilidades:
 *  1. Validar preferencias del usuario ANTES de notificar.
 *  2. Persistir la notificación (PostgreSQL) y emitirla por WebSocket (`notificacion:nueva`).
 *  3. Enviar correo de forma asíncrona sin comprometer la notificación in-app.
 *  4. Agrupar ráfagas de asignaciones (buffer) para evitar spam.
 *  5. Historial, marcado como leída (una o todas) y notificaciones de demostración.
 *
 * Tablas que usa: `notificaciones` y `usuarios.preferencias_notif` (ver database/notificaciones.sql).
 */

import { consulta } from '../../config/db.js';
import * as modCorreo from '../../utils/correo.js';
import websocket from '../../sockets/emisor.js';

/*
 * Constantes
 */

/** @constant {Readonly<{ASIGNACION:string, MENCION:string}>} Tipos de notificación válidos. */
export const TIPOS = Object.freeze({ ASIGNACION: 'asignacion', MENCION: 'mencion' });

/** @constant {string} Evento de WebSocket consumido por el frontend. */
const EVENTO_WS = 'notificacion:nueva';

/** @constant {number} Ventana (ms) de agrupamiento de ráfagas. Menor a 2 s para cumplir RF-25. */
const BUFFER_MS = 1500;

/** @constant {number} Máximo de eventos por ventana antes de vaciar de inmediato. */
const BUFFER_MAX_ITEMS = 50;

/** @constant {Set<string>} Tipos sujetos a agrupamiento. */
const TIPOS_AGRUPABLES = new Set([TIPOS.ASIGNACION]);

/** @constant {number} Límites de longitud para evitar abuso de almacenamiento. */
const MAX_TITULO = 200;
const MAX_MENSAJE = 500;
const MAX_ENLACE = 300;

/** @constant {number} Paginación del historial. */
const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 100;

/** Columnas devueltas al frontend (creado_en se entrega como creada_en). */
const COLUMNAS =
  'id, tipo, titulo, mensaje, enlace, referencia_id, metadatos, leida, creado_en AS creada_en';

/** Solo se aceptan enlaces internos ("/pages/tablero.html"); nunca "//otro-sitio" ni "javascript:". */
const PATRON_ENLACE = /^\/(?![\\/])[\w\-./?=&#%]*$/;

/** Plantillas para simular notificaciones nuevas durante una demostración. */
const PLANTILLAS_DEMO = Object.freeze([
  {
    tipo: TIPOS.MENCION,
    titulo: 'Diego te mencionó en un comentario',
    mensaje: 'Diego: ¿puedes revisar esta tarjeta antes de la Review del viernes?',
    enlace: '/pages/tablero.html',
  },
  {
    tipo: TIPOS.MENCION,
    titulo: 'Stephy te mencionó en un comentario',
    mensaje: 'Stephy: recuerda registrar tus horas antes de cerrar el día.',
    enlace: '/pages/tablero.html',
  },
  {
    tipo: TIPOS.ASIGNACION,
    titulo: 'Nueva tarea: Pruebas de permisos por rol',
    mensaje: 'Citlaly te asignó «Pruebas de permisos por rol» (4 h estimadas).',
    enlace: '/pages/tablero.html',
  },
  {
    tipo: TIPOS.ASIGNACION,
    titulo: 'Nueva tarea: Validar límite WIP',
    mensaje: 'Dana te asignó «Validar límite WIP» (3 h estimadas).',
    enlace: '/pages/tablero.html',
  },
]);

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
    titulo: fila.titulo ?? '',
    mensaje: fila.mensaje,
    enlace: fila.enlace ?? null,
    referenciaId: fila.referencia_id ?? null,
    metadatos: fila.metadatos ?? {},
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
  const { usuarioId, tipo, titulo, mensaje, referenciaId = null, enlace = null } = evento;
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
  if (enlace !== null && (typeof enlace !== 'string' || enlace.length > MAX_ENLACE || !PATRON_ENLACE.test(enlace))) {
    throw new ErrorValidacion('enlace inválido: debe ser una ruta interna.');
  }
  return {
    usuarioId,
    tipo,
    titulo: titulo.trim().slice(0, MAX_TITULO),
    mensaje: mensaje.trim().slice(0, MAX_MENSAJE),
    referenciaId,
    enlace,
  };
}

/*
 * Preferencias
 */

/**
 * Obtiene las preferencias de notificación de un usuario activo.
 * Lee `usuarios.preferencias_notif` ({"asignaciones": true, "menciones": true, "correo": false}).
 * Si una clave no existe se asume: asignaciones y menciones activas, correo apagado.
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{correo:string, asignacion:boolean, mencion:boolean, correoActivo:boolean}|null>}
 *          Preferencias o `null` si el usuario no existe o está inactivo.
 */
async function obtenerPreferencias(usuarioId) {
  const { rows } = await consulta(
    `SELECT correo,
            COALESCE((preferencias_notif->>'asignaciones')::boolean, TRUE) AS asignacion,
            COALESCE((preferencias_notif->>'menciones')::boolean, TRUE)    AS mencion,
            COALESCE((preferencias_notif->>'correo')::boolean, FALSE)      AS "correoActivo"
       FROM usuarios
      WHERE id = $1 AND activo = TRUE`,
    [usuarioId],
  );
  return rows[0] ?? null;
}

/*
 * Persistencia, WebSocket y correo
 */

/**
 * Envía el correo de forma asíncrona; un fallo nunca afecta a la notificación in-app.
 * @param {string} destinatario Correo del usuario.
 * @param {Object} notificacion Contenido.
 */
function despacharCorreo(destinatario, notificacion) {
  Promise.resolve()
    .then(() => typeof modCorreo.enviarCorreo === 'function' && modCorreo.enviarCorreo({
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
  const { rows } = await consulta(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, referencia_id, metadatos)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNAS}`,
    [
      datos.usuarioId,
      datos.tipo,
      datos.titulo,
      datos.mensaje,
      datos.enlace ?? null,
      datos.referenciaId ?? null,
      JSON.stringify(datos.metadatos ?? {}),
    ],
  );
  const notificacion = mapearFila(rows[0]);

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

/**
 * Convierte varios eventos del mismo usuario y tipo en un único resumen.
 * @param {Object[]} items Eventos validados (al menos uno).
 * @returns {Object} Evento listo para persistir.
 */
function consolidar(items) {
  if (items.length === 1) return items[0];

  const { usuarioId, tipo } = items[0];
  const nombres = items.slice(0, 3).map((i) => i.titulo).join('; ');
  const restantes = items.length - 3;
  const sufijo = restantes > 0 ? ` y ${restantes} más` : '';
  const mismoEnlace = items.every((i) => i.enlace === items[0].enlace);
  return {
    usuarioId,
    tipo,
    titulo: `Tienes ${items.length} nuevas asignaciones`,
    mensaje: `${nombres}${sufijo}`.slice(0, MAX_MENSAJE),
    referenciaId: null,
    enlace: mismoEnlace ? items[0].enlace : null,
    metadatos: {
      agrupada: true,
      total: items.length,
      referencias: items.map((i) => i.referenciaId).filter((r) => r !== null),
    },
  };
}

/**
 * Vacía una entrada del buffer: la consolida, la persiste y la emite.
 * @param {string} clave Clave `usuarioId:tipo`.
 * @returns {Promise<Object|null>} Notificación creada o `null`.
 */
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

/**
 * Agrega un evento al buffer; programa su vaciado automático.
 * @param {Object} evento Evento validado.
 * @param {Object} prefs Preferencias del usuario.
 */
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

/**
 * Vacía todos los buffers pendientes (útil al apagar el servidor y en pruebas).
 * @returns {Promise<void>}
 */
export async function vaciarBuffers() {
  await Promise.all([...buffer.keys()].map(vaciarEntrada));
}

/*
 * API pública
 */

/**
 * Notifica a un usuario. Es la función que deben llamar los demás módulos
 * (por ejemplo tareas.service al asignar una tarea, comentarios.service al mencionar).
 * @param {{usuarioId:number, tipo:string, titulo:string, mensaje:string, referenciaId?:number|null, enlace?:string|null}} evento
 * @returns {Promise<{estado:'omitida'|'agrupada'|'creada', notificacion?:Object}>}
 * @throws {ErrorValidacion} Si el evento es inválido.
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

/**
 * Cuenta las notificaciones sin leer de un usuario.
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<number>} Total sin leer.
 */
export async function contarNoLeidas(usuarioId) {
  const { rows } = await consulta(
    'SELECT COUNT(*)::int AS total FROM notificaciones WHERE usuario_id = $1 AND leida = FALSE',
    [usuarioId],
  );
  return rows[0].total;
}

/**
 * Lista el historial de un usuario (más recientes primero) junto con su contador de no leídas.
 * @param {number} usuarioId ID del usuario.
 * @param {{limite?:number|string, offset?:number|string}} [opciones] Paginación.
 * @returns {Promise<{notificaciones: Object[], noLeidas: number}>}
 */
export async function listarPorUsuario(usuarioId, { limite = LIMITE_POR_DEFECTO, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number.parseInt(limite, 10) || LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);

  const [{ rows }, noLeidas] = await Promise.all([
    consulta(
      `SELECT ${COLUMNAS}
         FROM notificaciones
        WHERE usuario_id = $1
        ORDER BY creado_en DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [usuarioId, lim, off],
    ),
    contarNoLeidas(usuarioId),
  ]);
  return { notificaciones: rows.map(mapearFila), noLeidas };
}

/**
 * Marca una notificación como leída (solo si pertenece al usuario).
 * @param {number} id ID de la notificación.
 * @param {number} usuarioId Dueño de la notificación.
 * @returns {Promise<{notificacion: Object, noLeidas: number}|null>} `null` si no existe o es ajena.
 */
export async function marcarComoLeida(id, usuarioId) {
  const { rows } = await consulta(
    `UPDATE notificaciones
        SET leida = TRUE, leida_en = COALESCE(leida_en, NOW())
      WHERE id = $1 AND usuario_id = $2
      RETURNING ${COLUMNAS}`,
    [id, usuarioId],
  );
  if (rows.length === 0) return null;
  return { notificacion: mapearFila(rows[0]), noLeidas: await contarNoLeidas(usuarioId) };
}

/**
 * Marca como leídas todas las notificaciones pendientes del usuario.
 * @param {number} usuarioId Dueño de las notificaciones.
 * @returns {Promise<{actualizadas: number, noLeidas: number}>}
 */
export async function marcarTodasComoLeidas(usuarioId) {
  const resultado = await consulta(
    `UPDATE notificaciones
        SET leida = TRUE, leida_en = COALESCE(leida_en, NOW())
      WHERE usuario_id = $1 AND leida = FALSE`,
    [usuarioId],
  );
  return { actualizadas: resultado.rowCount ?? 0, noLeidas: await contarNoLeidas(usuarioId) };
}

/**
 * Crea una notificación de ejemplo para el usuario (solo para demostraciones).
 * Pasa por `notificar`, así que respeta preferencias, WebSocket y buffer.
 * @param {number} usuarioId Usuario que recibe la notificación.
 * @returns {Promise<{estado:string, notificacion?:Object}>}
 */
export async function crearNotificacionDemo(usuarioId) {
  const plantilla = PLANTILLAS_DEMO[Math.floor(Math.random() * PLANTILLAS_DEMO.length)];
  return notificar({ usuarioId, ...plantilla });
}