/**
 * Reunir funciones auxiliares pequeñas y reutilizables.
 */

/**
 * Escapar los caracteres especiales de HTML para evitar inyección de código (XSS).
 * Aplicar siempre a textos que provengan del usuario antes de insertarlos con innerHTML.
 *
 * @param {string} texto - Texto sin procesar.
 * @returns {string} Texto seguro para insertar en HTML.
 */
export function escaparHtml(texto = '') {
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Elegir la forma singular o plural de una palabra según la cantidad.
 *
 * @param {number} n - Cantidad.
 * @param {string} singular - Forma para n = 1 (ej. "día").
 * @param {string} plural - Forma para el resto (ej. "días").
 * @returns {string}
 */
export function pluralizar(n, singular, plural) {
  return n === 1 ? singular : plural;
}

/**
 * Obtener las iniciales (máximo 2) de un nombre completo.
 *
 * @param {string} nombre - Nombre completo, por ejemplo "Elena Rostova".
 * @returns {string} Iniciales en mayúscula, por ejemplo "ER".
 */
export function iniciales(nombre = '') {
  return nombre.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();
}

