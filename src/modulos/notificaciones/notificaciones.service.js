/**
 * @file notificaciones.service.js
 * @description Núcleo de la HU-24 (Notificaciones). Responsabilidades:
 *  1. Validar preferencias del usuario ANTES de notificar.
 *  2. Persistir la notificación (PostgreSQL) y emitirla por WebSocket (`notificacion:nueva`).
 *  3. Enviar correo de forma asíncrona sin comprometer la notificación in-app.
 *  4. Agrupar ráfagas de asignaciones (buffer) para evitar spam.
 *  5. Historial, marcado como leída (una o todas).
 *  6. Atajo `notificarAsignacion` para cuando se asigna una tarea (lo llama tareas.service).
 *     Las menciones las notifica comentarios.service directamente con `notificar()`.
 *
 * Tablas que usa: `notificaciones` y `usuarios.preferencias_notif` (ver database/notificaciones.sql).
 *
 * @author Alfonso Mendoza Vasquez
 * @author Citlaly Morales Viveros
 */

import { consulta } from '../../config/db.js';
import * as modCorreo from '../../utils/correo.js';
import websocket from '../../sockets/emisor.js';
import { env } from '../../config/env.js';

/*
 * Constantes
 */

/** @constant {Readonly<{ASIGNACION:string, MENCION:string}>} Tipos de notificación válidos. */
export const TIPOS = Object.freeze({ ASIGNACION: 'asignacion', MENCION: 'mencion', DESVIACION: 'desviacion', IMPEDIMENTO: 'impedimento' });
// Desde la etapa 6 TIPOS también incluye DESVIACION e IMPEDIMENTO, ambos configurables por canal.

/**
 * Valores por defecto de cada canal y tipo. Es la misma forma que guarda `usuarios.preferencias_notif`.
 * @constant {Readonly<{interna: Readonly<Object<string,boolean>>, correo: Readonly<Object<string,boolean>>}>}
 */
export const PREFERENCIAS_POR_DEFECTO = Object.freeze({
  interna: Object.freeze({ asignacion: true, mencion: true, desviacion: true, impedimento: true }),
  correo: Object.freeze({ asignacion: false, mencion: false, desviacion: false, impedimento: false }),
});

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

/** Página del tablero. Con `?tarea=ID` el detalle de tarjeta abre esa tarjeta (detalle-tarjeta.js). */
const RUTA_TABLERO = '/pages/tablero.html';

/** Página de inicio, usada si un aviso no tiene una pantalla más específica. */
const RUTA_DASHBOARD = '/pages/dashboard.html';

/** Página donde la persona cambia sus preferencias de notificación (sección Notificaciones). */
const RUTA_PERFIL = '/pages/perfil.html';

/** Solo se aceptan enlaces internos ("/pages/tablero.html"); nunca "//otro-sitio" ni "javascript:". */
const PATRON_ENLACE = /^\/(?![\\/])[\w\-./?=&#%]*$/;

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
  const { usuarioId, tipo, titulo, mensaje, referenciaId = null, enlace = null, transaccional = false } = evento;
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
    transaccional: transaccional === true,
  };
}

/*
 * Preferencias
 */

/**
 * Obtiene las preferencias de notificación de un usuario activo.
 * Lee `usuarios.preferencias_notif` ({"asignaciones": true, "menciones": true, "correo": false}).
 * Si una clave no existe se asume: asignaciones y menciones activas, correo apagado.
 * Desde la etapa 5 cada canal tiene su propio interruptor por tipo (ver PREFERENCIAS_POR_DEFECTO).
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{correo:string, asignacion:boolean, mencion:boolean, correoActivo:boolean}|null>}
 * Desde la etapa 5 devuelve {correo, nombre, interna, porCorreo} (ver PREFERENCIAS_POR_DEFECTO).
 *          Preferencias o `null` si el usuario no existe o está inactivo.
 */
async function obtenerPreferencias(usuarioId) {
  const { rows } = await consulta(
    'SELECT correo, nombre, preferencias_notif FROM usuarios WHERE id = $1 AND activo = TRUE',
    [usuarioId],
  );
  const fila = rows[0];
  if (!fila) return null;
  const matriz = leerPreferencias(fila.preferencias_notif);
  return {
    correo: fila.correo,
    nombre: fila.nombre,
    interna: matriz.interna,
    porCorreo: matriz.correo,
  };
}

/**
 * Convierte el valor guardado en usuarios.preferencias_notif en la matriz completa. Las claves que faltan
 * (por ejemplo, tipos agregados después) y los valores que no son booleanos toman su valor por defecto.
 * @param {*} guardado - Valor de la columna JSONB.
 * @returns {{interna: Object<string,boolean>, correo: Object<string,boolean>}} Matriz completa.
 */
export function leerPreferencias(guardado) {
  const bloques = guardado !== null && typeof guardado === 'object' && !Array.isArray(guardado) ? guardado : {};
  const salida = {};
  for (const canal of Object.keys(PREFERENCIAS_POR_DEFECTO)) {
    const valores = bloques[canal] !== null && typeof bloques[canal] === 'object' ? bloques[canal] : {};
    salida[canal] = {};
    for (const tipo of Object.values(TIPOS)) {
      salida[canal][tipo] = typeof valores[tipo] === 'boolean' ? valores[tipo] : PREFERENCIAS_POR_DEFECTO[canal][tipo];
    }
  }
  return salida;
}

/**
 * Valida la matriz de preferencias de notificación: un booleano por canal (interna y correo) y por tipo.
 * Rechaza cualquier clave que no sea un canal o un tipo de TIPOS.
 * @param {*} entrada - Valor sin confiar (por ejemplo, el cuerpo de la petición).
 * @returns {{interna: Object<string,boolean>, correo: Object<string,boolean>}|null} Matriz limpia, o `null` si no es válida.
 */
export function normalizarPreferencias(entrada) {
  const esObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
  if (!esObjeto(entrada)) return null;

  const canales = Object.keys(PREFERENCIAS_POR_DEFECTO);
  const tipos = Object.values(TIPOS);
  if (Object.keys(entrada).length !== canales.length) return null;

  const salida = {};
  for (const canal of canales) {
    const bloque = entrada[canal];
    if (!esObjeto(bloque) || Object.keys(bloque).length !== tipos.length) return null;
    salida[canal] = {};
    for (const tipo of tipos) {
      if (typeof bloque[tipo] !== 'boolean') return null;
      salida[canal][tipo] = bloque[tipo];
    }
  }
  return salida;
}

/*
 * Persistencia, WebSocket y correo
 */

/**
 * Elige a qué pantalla lleva un aviso. Usa el enlace del emisor; si no lo trae, la pantalla que corresponde al tipo.
 * @param {Object} datos Aviso con tipo, enlace y referenciaId.
 * @returns {string} Ruta interna (empieza con "/").
 */
function rutaDelAviso(datos) {
  if (datos.enlace) return datos.enlace;
  if (datos.tipo === TIPOS.ASIGNACION && datos.referenciaId) return `${RUTA_TABLERO}?tarea=${datos.referenciaId}`;
  if (datos.tipo === TIPOS.ASIGNACION || datos.tipo === TIPOS.MENCION) return RUTA_TABLERO;
  return RUTA_DASHBOARD;
}

/**
 * Dirección base de la aplicación para los enlaces del correo, sin barra final.
 * @returns {string} Por ejemplo "https://localhost:3000"; vacía si no está configurada.
 */
function baseDeLaApp() {
  return String(env.APP_URL ?? '').replace(/\/+$/, '');
}

/**
 * Envía el correo de forma asíncrona; un fallo nunca afecta a la notificación in-app.
 * Incluye saludo, el aviso, un botón a la pantalla correspondiente y un enlace para cambiar las preferencias.
 * @param {{correo: string, nombre?: string}} prefs Destinatario y su nombre.
 * @param {Object} notificacion Contenido (titulo, mensaje, tipo, enlace o referenciaId).
 */
function despacharCorreo(prefs, notificacion) {
  Promise.resolve()
    .then(() => {
      if (typeof modCorreo.enviarCorreo !== 'function') return;
      const base = baseDeLaApp();
      const primerNombre = String(prefs.nombre ?? '').trim().split(/\s+/)[0];
      const saludo = primerNombre ? `Hola, ${primerNombre}:` : 'Hola:';
      const ruta = rutaDelAviso(notificacion);
      const url = base ? `${base}${ruta}` : null;
      const perfil = base ? `${base}${RUTA_PERFIL}` : null;
      const pie = 'Recibiste este aviso porque activaste el correo para este tipo de notificación.';

      const lineasTexto = [saludo, '', notificacion.titulo, notificacion.mensaje];
      if (url) lineasTexto.push('', `Abrir en ScrumFlow: ${url}`);
      if (perfil) lineasTexto.push('', `${pie} Puedes cambiarlo en tu perfil: ${perfil}`);
      else lineasTexto.push('', pie);

      const bloqueBoton = url
        ? `<p><a href="${escaparHtml(url)}" style="display:inline-block;padding:10px 16px;background:#1f6feb;color:#fff;text-decoration:none;border-radius:6px">Abrir en ScrumFlow</a></p>`
        : '';
      const bloquePie = perfil
        ? `<p style="color:#666;font-size:12px">${pie} Puedes cambiarlo en tu <a href="${escaparHtml(perfil)}">perfil</a>.</p>`
        : `<p style="color:#666;font-size:12px">${pie}</p>`;

      return modCorreo.enviarCorreo({
        para: prefs.correo,
        asunto: `[ScrumFlow] ${sinSaltosDeLinea(notificacion.titulo)}`,
        texto: lineasTexto.join('\n'),
        html: `<p>${escaparHtml(saludo)}</p><h3>${escaparHtml(notificacion.titulo)}</h3><p>${escaparHtml(notificacion.mensaje)}</p>${bloqueBoton}${bloquePie}`,
      });
    })
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
      rutaDelAviso(datos),
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

  if (prefs?.correo && prefs?.porCorreo?.[datos.tipo] === true) {
    despacharCorreo(prefs, notificacion);
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
    enlace: mismoEnlace ? items[0].enlace : RUTA_TABLERO,
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
 * Notifica a un usuario. Es la función base que usan comentarios.service y notificarAsignacion.
 * @param {{usuarioId:number, tipo:string, titulo:string, mensaje:string, referenciaId?:number|null, enlace?:string|null}} evento
 * @returns {Promise<{estado:'omitida'|'agrupada'|'creada', notificacion?:Object}>}
 * @throws {ErrorValidacion} Si el evento es inválido.
 */
export async function notificar(evento) {
  const datos = validarEvento(evento);

  const prefs = await obtenerPreferencias(datos.usuarioId);
  if (!prefs) {
    return { estado: 'omitida' };
  }

  // Avisos transaccionales (invitaciones): siempre se guardan y se emiten; el correo lo envía quien los crea.
  if (datos.transaccional) {
    const notificacion = await persistirYEmitir(datos, { correo: null, interna: {}, porCorreo: {} });
    return { estado: 'creada', notificacion };
  }

  const porInterna = prefs.interna[datos.tipo] === true;
  const porCorreo = prefs.porCorreo[datos.tipo] === true && Boolean(prefs.correo);
  if (!porInterna && !porCorreo) {
    return { estado: 'omitida' };
  }

  // Solo correo: se envía en el momento, sin pasar por la campana ni por el buffer
  if (!porInterna) {
    despacharCorreo(prefs, datos);
    return { estado: 'correo' };
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

/*
 * Asignación de tareas (la llama tareas.service)
 */

/**
 * Carga lo necesario para armar la notificación de una tarea: la tarea, el nombre de quien asigna
 * y si el destinatario es integrante activo del proyecto de esa tarea.
 * @param {number} tareaId Tarjeta involucrada.
 * @param {number|null} actorId Persona que comenta o asigna (puede ser `null`).
 * @param {number[]} destinatarios Posibles destinatarios.
 * @returns {Promise<{tarea: Object, actor: string, destinatarios: number[]}|null>} `null` si la tarea no existe.
 */
async function cargarContextoTarjeta(tareaId, actorId, destinatarios) {
  const [tareas, actores, miembros] = await Promise.all([
    consulta('SELECT id, titulo, proyecto_id, horas_estimadas FROM tareas WHERE id = $1', [tareaId]),
    actorId
      ? consulta('SELECT nombre FROM usuarios WHERE id = $1', [actorId])
      : Promise.resolve({ rows: [] }),
    consulta(
      `SELECT m.usuario_id
         FROM miembros_proyecto m
         JOIN tareas t ON t.proyecto_id = m.proyecto_id
         JOIN proyectos p ON p.id = m.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = m.usuario_id
         JOIN usuarios u ON u.id = m.usuario_id
        WHERE t.id = $1 AND m.usuario_id = ANY($2::int[]) AND u.activo = TRUE`,
      [tareaId, destinatarios],
    ),
  ]);
  if (tareas.rows.length === 0) return null;
  return {
    tarea: tareas.rows[0],
    actor: actores.rows[0]?.nombre ?? 'Alguien',
    destinatarios: miembros.rows.map((fila) => Number(fila.usuario_id)),
  };
}

/**
 * Notifica a una persona que le asignaron una tarea. No avisa si se la asigna a sí misma
 * ni si no es integrante del proyecto. Nunca lanza errores.
 * @param {{tareaId:number, responsableId:number, asignadorId?:number|null}} datos
 * @returns {Promise<{estado:string, notificacion?:Object}|null>} Resultado de `notificar` o `null` si no se avisó.
 */
export async function notificarAsignacion({ tareaId, responsableId, asignadorId = null }) {
  try {
    const responsable = Number(responsableId);
    if (!Number.isInteger(responsable) || responsable <= 0) return null;
    if (asignadorId !== null && Number(asignadorId) === responsable) return null;

    const contexto = await cargarContextoTarjeta(Number(tareaId), Number(asignadorId) || null, [responsable]);
    if (!contexto || !contexto.destinatarios.includes(responsable)) return null;

    const { tarea, actor } = contexto;
    const horas = Number(tarea.horas_estimadas);
    const detalle = Number.isFinite(horas) && horas > 0 ? ` (${horas} h estimadas)` : '';
    const quien = asignadorId ? `${actor} te asignó` : 'Te asignaron';

    return await notificar({
      usuarioId: responsable,
      tipo: TIPOS.ASIGNACION,
      titulo: `Nueva tarea: ${tarea.titulo}`,
      mensaje: `${quien} «${tarea.titulo}»${detalle}.`,
      referenciaId: Number(tarea.id),
      enlace: `${RUTA_TABLERO}?tarea=${Number(tarea.id)}`,
    });
  } catch (error) {
    console.error('[notificaciones] Falló notificarAsignacion:', error?.message ?? error);
    return null;
  }
}