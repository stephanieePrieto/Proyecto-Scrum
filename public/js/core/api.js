import { obtenerTokenCsrf } from './seguridad.js';

/**
 * Centralizar las peticiones HTTP al backend usando fetch.
 * Reutilizar la función "api" desde todas las páginas.
 * @author Citlaly Morales Viveros
 */

// Definir el prefijo común de todas las rutas del backend (mismo origen que la página)
const BASE_API = '/api';

/**
 * Enviar una petición al backend y devolver la respuesta como JSON.
 * La sesión viaja en cookies httpOnly; los métodos que modifican datos envían token CSRF.
 * Lanzar un Error con las propiedades "estado" y "cuerpo" cuando la respuesta no es 2xx.
 *
 * @param {string} ruta - Ruta relativa a /api, por ejemplo "/proyectos/1/metricas/dashboard".
 * @param {Object} [opciones]
 * @param {string} [opciones.metodo='GET'] - Método HTTP.
 * @param {Object} [opciones.cuerpo] - Datos a enviar serializados como JSON.
 * @param {AbortSignal} [opciones.signal] - Señal para cancelar la petición.
 * @returns {Promise<any>} Cuerpo de la respuesta ya convertido a objeto (null si es 204).
 */
export async function api(ruta, { metodo = 'GET', cuerpo, signal } = {}) {
  // La sesión viaja en cookies httpOnly (no accesibles por JS); no se usa token en localStorage
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
    // Conservar el JSON de la respuesta de error (mensaje y detalles) en "cuerpo"; null si no hay JSON
    error.cuerpo = await respuesta.json().catch(() => null);
    throw error;
  }

  // Devolver null cuando el servidor responde sin contenido (204)
  if (respuesta.status === 204) return null;

  // Devolver el contenido de la respuesta
  return respuesta.json();
}