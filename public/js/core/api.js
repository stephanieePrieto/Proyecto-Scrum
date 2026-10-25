import { obtenerTokenCsrf } from './seguridad.js';
/**
 * Centralizar las peticiones HTTP al backend usando fetch.
 * Reutilizar la función "api" desde todas las páginas.
 */

// Definir el prefijo común de todas las rutas del backend (mismo origen que la página)
const BASE_API = '/api';

/**
 * Enviar una petición al backend y devolver la respuesta como JSON.
 * Adjuntar el token guardado en localStorage, si existe.
 * Lanzar un Error con la propiedad "estado" cuando la respuesta no es 2xx.
 *
 * @param {string} ruta - Ruta relativa a /api, por ejemplo "/proyectos/1/metricas/dashboard".
 * @param {Object} [opciones]
 * @param {string} [opciones.metodo='GET'] - Método HTTP.
 * @param {Object} [opciones.cuerpo] - Datos a enviar serializados como JSON.
 * @param {AbortSignal} [opciones.signal] - Señal para cancelar la petición.
 * @returns {Promise<any>} Cuerpo de la respuesta ya convertido a objeto.
 */
export async function api(ruta, { metodo = 'GET', cuerpo, signal } = {}) {
  // La sesión viaja en cookies httpOnly (no accesibles por JS); ya no se usa token en localStorage
  const headers = { 'Content-Type': 'application/json' };

  // Los métodos que modifican datos deben enviar el token CSRF
  if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())) {
    headers['X-CSRF-Token'] = obtenerTokenCsrf();
  }

  // Ejecutar la petición con las cabeceras necesarias
  const respuesta = await fetch(`${BASE_API}${ruta}`, {
    method: metodo,
    signal,
    credentials: 'same-origin',
    headers,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });

  // Rechazar la promesa cuando el servidor responde con error
  if (!respuesta.ok) {
    const error = new Error(`HTTP ${respuesta.status}`);
    error.estado = respuesta.status;
    throw error;
  }

  // Devolver el contenido de la respuesta
  return respuesta.json();
}