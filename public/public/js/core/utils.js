/**
 * @file utils.js
 * @description Reunir funciones auxiliares pequeñas y reutilizables.
 * 
 * @author Stephanie Elizdeth Hernández Prieto
 * @author Citlaly Morales Viveros
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

/** Formato de un identificador de zona horaria IANA, por ejemplo "America/Mexico_City" o "UTC". */
const PATRON_ZONA_HORARIA = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/**
 * Comprobar que un texto sea una zona horaria IANA que el navegador reconoce.
 *
 * @param {*} zona - Valor a revisar.
 * @returns {boolean}
 */
export function esZonaHorariaValida(zona) {
  if (typeof zona !== 'string' || zona.length > 64 || !PATRON_ZONA_HORARIA.test(zona)) return false;
  try {
    new Intl.DateTimeFormat('es', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/**
 * Obtener la zona horaria del navegador con el mecanismo estándar de JavaScript.
 *
 * @returns {string} La zona IANA del navegador, o UTC si no se puede determinar.
 */
export function detectarZonaNavegador() {
  try {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return esZonaHorariaValida(zona) ? zona : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Obtener la zona horaria con la que se muestran las fechas con hora: la que la persona guardó en su
 * perfil (copiada en localStorage.usuario por la barra superior) o, si no hay una válida, la del navegador.
 *
 * @returns {string} Zona IANA.
 */
export function zonaHorariaUsuario() {
  try {
    const zona = JSON.parse(localStorage.getItem('usuario'))?.zonaHoraria;
    if (esZonaHorariaValida(zona)) return zona;
  } catch { /* Sin almacenamiento o JSON inválido: se usa la del navegador */ }
  return detectarZonaNavegador();
}

/**
 * Agregar la zona horaria de la persona a las opciones de toLocaleString o toLocaleDateString.
 * Solo debe usarse con instantes (fecha y hora del servidor), no con fechas de solo día.
 *
 * @param {Intl.DateTimeFormatOptions} [opciones] - Opciones de formato.
 * @returns {Intl.DateTimeFormatOptions} Las mismas opciones con timeZone.
 */
export function conZonaHoraria(opciones = {}) {
  return { ...opciones, timeZone: zonaHorariaUsuario() };
}