import { obtenerTokenCsrf } from './seguridad.js';

/**
 * Centralizar las peticiones HTTP al backend usando fetch.
 * Reutilizar la función "api" desde todas las páginas.
 * @author Citlaly Morales Viveros
 */

// Definir el prefijo común de todas las rutas del backend (mismo origen que la página)
const BASE_API = '/api';

// Ruta del login (la misma que usa cerrarSesion en auth.js)
const RUTA_LOGIN = '/login.html';

// Ruta que confirma cada cierto tiempo que la sesión sigue vigente
const RUTA_LATIDO = '/auth/actividad';
const INTERVALO_LATIDO_MS = 60 * 1000;

// Códigos con los que el servidor avisa que la sesión ya terminó y no tiene caso renovarla
const CODIGOS_SESION_TERMINADA = ['SESION_INACTIVA', 'SESION_CERRADA', 'SESION_INVALIDA'];

// Gestos de una persona real: los movimientos del ratón y las peticiones automáticas no cuentan
const EVENTOS_INTERACCION = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

let ultimaInteraccion = Date.now();
let renovacionEnCurso = null;
let redirigiendoAlLogin = false;
let latidoIniciado = false;

// Registrar el momento de la última interacción humana en esta pestaña
EVENTOS_INTERACCION.forEach((evento) => {
  window.addEventListener(evento, () => { ultimaInteraccion = Date.now(); }, { passive: true, capture: true });
});

/**
 * Indicar si la ruta pertenece al inicio, cierre o renovación de sesión. En esas rutas un 401 no
 * debe intentar renovar ni redirigir, porque es la respuesta normal a unas credenciales incorrectas.
 *
 * @param {string} ruta - Ruta relativa a /api.
 * @returns {boolean}
 */
function esRutaDeAutenticacion(ruta) {
  return ruta.startsWith('/auth/') && ruta !== RUTA_LATIDO;
}

/**
 * Llevar al login una sola vez, aunque lleguen varios 401 a la vez, y nunca desde el propio login.
 * @returns {void}
 */
function irAlLogin() {
  if (redirigiendoAlLogin || window.location.pathname.endsWith('/login.html')) return;
  redirigiendoAlLogin = true;
  window.location.href = RUTA_LOGIN;
}

/**
 * Pedir al servidor un nuevo par de tokens. Las peticiones que fallan al mismo tiempo comparten
 * una sola renovación. Renovar no cuenta como actividad: eso lo decide el servidor.
 *
 * @returns {Promise<boolean>} true si la renovación fue aceptada.
 */
function renovarSesion() {
  if (!renovacionEnCurso) {
    renovacionEnCurso = fetch(`${BASE_API}/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': obtenerTokenCsrf() },
    })
      .then((respuesta) => respuesta.ok)
      .catch(() => false)
      .finally(() => { renovacionEnCurso = null; });
  }
  return renovacionEnCurso;
}

/**
 * Empezar a enviar un latido cada minuto. El latido informa cuánto hace que la persona interactuó:
 * si no lo hizo, no reinicia el contador, y al cumplirse el límite el servidor responde 401.
 * @returns {void}
 */
function iniciarLatido() {
  if (latidoIniciado) return;
  latidoIniciado = true;
  setInterval(() => { api(RUTA_LATIDO, { metodo: 'POST' }).catch(() => { }); }, INTERVALO_LATIDO_MS);
}

/**
 * Ejecutar una sola petición HTTP, sin reintentos ni manejo de errores.
 *
 * @param {string} ruta - Ruta relativa a /api.
 * @param {Object} opciones
 * @param {string} opciones.metodo - Método HTTP.
 * @param {Object} [opciones.cuerpo] - Datos a enviar serializados como JSON.
 * @param {AbortSignal} [opciones.signal] - Señal para cancelar la petición.
 * @returns {Promise<Response>}
 */
function enviarPeticion(ruta, { metodo, cuerpo, signal }) {
  // La sesión viaja en cookies httpOnly (no accesibles por JS); no se usa token en localStorage
  const headers = { 'Content-Type': 'application/json' };

  // Los métodos que modifican datos deben enviar el token CSRF
  if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())) {
    headers['X-CSRF-Token'] = obtenerTokenCsrf();
  }

  // Informar cuántos segundos pasaron desde la última interacción humana en esta pestaña
  headers['X-Interaccion-Segundos'] = String(Math.floor((Date.now() - ultimaInteraccion) / 1000));

  // Ejecutar la petición con las cabeceras necesarias
  return fetch(`${BASE_API}${ruta}`, {
    method: metodo,
    signal,
    credentials: 'same-origin',
    headers,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
}

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
  const opciones = { metodo, cuerpo, signal };
  let respuesta = await enviarPeticion(ruta, opciones);
  let cuerpoError = null;

  if (!respuesta.ok) {
    // Conservar el JSON de la respuesta de error (mensaje y detalles) en "cuerpo"; null si no hay JSON
    cuerpoError = await respuesta.json().catch(() => null);

    // Con un 401 que no indica sesión terminada, renovar los tokens y repetir la petición una sola vez.
    // Se repite aunque la renovación falle: otra pestaña pudo renovar al mismo tiempo y las cookies se comparten
    const sesionTerminada = CODIGOS_SESION_TERMINADA.includes(cuerpoError?.detalles?.codigo);
    if (respuesta.status === 401 && !sesionTerminada && !esRutaDeAutenticacion(ruta)) {
      await renovarSesion();
      respuesta = await enviarPeticion(ruta, opciones);
      cuerpoError = respuesta.ok ? null : await respuesta.json().catch(() => null);
    }
  }

  // Rechazar la promesa cuando el servidor responde con error
  if (!respuesta.ok) {
    const error = new Error(`HTTP ${respuesta.status}`);
    error.estado = respuesta.status;
    error.cuerpo = cuerpoError;
    // Avisar a la interfaz de un rechazo por permisos para que consulte de nuevo los del rol vigente
    if (respuesta.status === 403) window.dispatchEvent(new CustomEvent('permisos:rechazado', { detail: { ruta } }));
    // Un 401 que no se pudo resolver significa que la sesión terminó: volver al login
    if (respuesta.status === 401 && !esRutaDeAutenticacion(ruta)) irAlLogin();
    throw error;
  }

  // Empezar el latido cuando ya hay una sesión que mantener
  if (!esRutaDeAutenticacion(ruta)) iniciarLatido();

  // Devolver null cuando el servidor responde sin contenido (204)
  if (respuesta.status === 204) return null;

  // Devolver el contenido de la respuesta
  return respuesta.json();
}