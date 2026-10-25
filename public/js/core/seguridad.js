/**
 * @file seguridad.js
 * @description Utilidades de seguridad del cliente: token CSRF y escape de HTML.
 * @author Stephanie Elizdeth Hernández Prieto
 */

/**
 * Lee el token CSRF de la cookie 'csrfToken' emitida por el servidor.
 *
 * @returns {string} Token CSRF, o cadena vacía si aún no existe.
 */
export function obtenerTokenCsrf() {
  const fila = document.cookie.split('; ').find((c) => c.startsWith('csrfToken='));
  return fila ? decodeURIComponent(fila.split('=')[1]) : '';
}

/**
 * Escapa caracteres HTML especiales. Usar SIEMPRE antes de insertar texto de
 * usuarios con innerHTML (o preferir textContent, que no necesita escape).
 *
 * @param {*} texto - Valor a mostrar.
 * @returns {string} Texto seguro para insertar en HTML.
 */
export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}