// Responsable: Alfonso - HU-27: utilidades compartidas por la pantalla "Mis horas" y el temporizador
/**
 * @file horas-comun.js
 * @description Creación segura de elementos DOM, mensajes de error de la API y formato de horas/tiempo.
 *              Todo el texto dinámico entra con `textContent`, nunca como HTML.
 */

/**
 * Crea un elemento DOM de forma segura.
 * @param {string} etiqueta Nombre de la etiqueta.
 * @param {{clase?:string, texto?:string, atributos?:Object, eventos?:Object<string,Function>}} [opciones] Propiedades.
 * @param {(Node|string)[]} [hijos] Nodos o textos hijos.
 * @returns {HTMLElement} Elemento creado.
 */
export function crear(etiqueta, { clase, texto, atributos = {}, eventos = {} } = {}, hijos = []) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    elemento.setAttribute(nombre, valor === true ? '' : String(valor));
  }
  for (const [evento, manejador] of Object.entries(eventos)) elemento.addEventListener(evento, manejador);
  elemento.append(...hijos);
  return elemento;
}

/**
 * Obtiene un mensaje claro para mostrar a la persona a partir de un error de `api()`.
 * Los errores 4xx traen el motivo en español desde el servidor; los demás usan el texto alternativo.
 * @param {Error & {estado?:number, cuerpo?:Object}} error Error lanzado por `api()`.
 * @param {string} alternativo Texto cuando el servidor no da un motivo.
 * @returns {string} Mensaje para la interfaz.
 */
export function mensajeDeError(error, alternativo) {
  if (!error?.estado) return 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.';
  if (error.estado >= 400 && error.estado < 500) {
    const cuerpo = error.cuerpo;
    return cuerpo?.error ?? cuerpo?.mensaje ?? cuerpo?.message ?? alternativo;
  }
  return alternativo;
}

/**
 * Formatea horas para mostrar ("1,5"); devuelve "—" cuando no hay horas.
 * @param {number|null|undefined} horas Horas.
 * @returns {string} Texto legible.
 */
export function formatearHoras(horas) {
  if (!horas) return '—';
  return horas.toLocaleString('es-MX', { maximumFractionDigits: 1 });
}

/**
 * Formatea segundos como reloj "HH:MM:SS".
 * @param {number} segundos Segundos transcurridos.
 * @returns {string} Ej. "00:42:10".
 */
export function formatearReloj(segundos) {
  const total = Math.max(0, Math.floor(segundos));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * Valida los campos de un registro de horas antes de enviarlos (los mismos criterios del servidor).
 * @param {{horas:number, fecha:string, hoy:string}} datos Valores del formulario.
 * @returns {string|null} Mensaje de error, o `null` si todo es válido.
 */
export function validarRegistro({ horas, fecha, hoy }) {
  if (!Number.isFinite(horas)) return 'Escribe las horas trabajadas.';
  if (horas <= 0) return 'Las horas deben ser mayores que cero.';
  if (horas > 24) return 'No se pueden registrar más de 24 horas en un día.';
  if (Math.abs(horas * 10 - Math.round(horas * 10)) > 1e-9) return 'Usa máximo un decimal en las horas (por ejemplo 1.5).';
  if (!fecha) return 'Elige la fecha del registro.';
  if (fecha > hoy) return 'No puedes registrar horas en una fecha futura.';
  return null;
}