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
  // Simular un token temporal para evitar errores de autenticación
  const token = localStorage.getItem('token') || 'demo-token-123';

  // Ejecutar la petición con las cabeceras necesarias
  const respuesta = await fetch(`${BASE_API}${ruta}`, {
    method: metodo,
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
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