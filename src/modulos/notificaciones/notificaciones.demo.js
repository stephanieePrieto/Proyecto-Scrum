/**
 * @file notificaciones.demo.js
 * @description Simulador en memoria para notificaciones de prueba cuando no hay base de datos disponible.
 */

// Simulador en memoria para evitar errores de base de datos
const notificaciones = [];

/**
 * Listar notificaciones por ID de usuario.
 * @param {number} usuarioId 
 * @returns {Promise<Array>}
 */
export async function listarPorUsuario(usuarioId) {
  return notificaciones.filter((n) => n.usuario_id === usuarioId);
}

/**
 * Contar notificaciones no leídas de un usuario.
 * @param {number} usuarioId 
 * @returns {Promise<number>}
 */
export async function contarNoLeidas(usuarioId) {
  return notificaciones.filter((n) => n.usuario_id === usuarioId && !n.leida).length;
}

/**
 * Marcar una notificación como leída.
 * @param {number|string} id 
 * @param {number} usuarioId 
 * @returns {Promise<Object>}
 */
export async function marcarComoLeida(id, usuarioId) {
  const notif = notificaciones.find((n) => n.id === Number(id) && n.usuario_id === usuarioId);
  if (notif) notif.leida = true;
  return { notificacion: notif, noLeidas: 0 };
}

/**
 * Insertar una nueva notificación en la colección en memoria.
 * @param {Object} datos 
 * @returns {Promise<Object>}
 */
export async function insertar(datos) {
  const nueva = { id: Date.now(), ...datos, leida: false };
  notificaciones.push(nueva);
  return nueva;
}