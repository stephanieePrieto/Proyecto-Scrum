/**
 * @file errores.js
 * @description Centralizar los mensajes de error que ve la persona usuaria.
 * Todos los mensajes salen en español e indican qué hacer. Nunca se muestra el texto
 * técnico de api() ("HTTP 500") ni el de fetch ("Failed to fetch").
 *
 * @author Camila Mariné Crespo Zurita
 */

// Texto por código HTTP cuando el servidor no envía un motivo propio
const MENSAJES_POR_ESTADO = {
  400: 'Los datos enviados no son válidos. Revísalos e inténtalo de nuevo.',
  401: 'Tu sesión terminó. Inicia sesión de nuevo para continuar.',
  403: 'No tienes permiso para realizar esta acción. Consulta con tu Scrum Master.',
  404: 'No se encontró lo que buscas. Puede que ya no exista; recarga la página.',
  409: 'Alguien más modificó esto mientras tanto. Recarga la página e inténtalo de nuevo.',
  422: 'Hay datos incompletos o incorrectos. Revísalos e inténtalo de nuevo.',
  429: 'Hiciste demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.',
  500: 'Ocurrió un problema en el servidor. Inténtalo de nuevo en unos momentos.',
  503: 'El servicio está en mantenimiento. Inténtalo de nuevo en unos minutos.',
};

const MENSAJE_SIN_CONEXION = 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

/**
 * Indicar si un texto es técnico (código HTTP o mensaje en inglés del navegador) y no debe mostrarse.
 * @param {string} texto - Texto a revisar.
 * @returns {boolean}
 */
function esTextoTecnico(texto) {
  return /^HTTP \d{3}$/i.test(texto) || /failed to fetch|networkerror|load failed|aborted|unexpected token/i.test(texto);
}

/**
 * Obtener un mensaje claro en español a partir de un error lanzado por api().
 * Prioridad: motivo del servidor (4xx) > texto por código HTTP > texto alternativo > genérico.
 *
 * @param {Error & {estado?: number, cuerpo?: Object|null}} error - Error capturado.
 * @param {string} [alternativo] - Mensaje propio de la pantalla cuando no hay otro más específico.
 * @returns {string} Mensaje para mostrar en la interfaz.
 */
export function mensajeError(error, alternativo) {
  if (!error) return alternativo || MENSAJE_GENERICO;

  // Sin estado HTTP: la petición ni siquiera llegó al servidor
  if (error.estado === undefined) {
    if (error.name === 'AbortError') return alternativo || MENSAJE_GENERICO;
    // Errores propios del código con texto en español (new Error('Debes aprobar...')) se respetan;
    // los TypeError de fetch ("Failed to fetch") son fallas de red
    const propio = typeof error.message === 'string' ? error.message.trim() : '';
    if (propio && !(error instanceof TypeError) && !esTextoTecnico(propio)) return propio;
    return MENSAJE_SIN_CONEXION;
  }

  // Los 4xx traen el motivo en español desde el servidor
  const cuerpo = error.cuerpo;
  const delServidor = [cuerpo?.error, cuerpo?.mensaje, cuerpo?.message]
    .find((t) => typeof t === 'string' && t.trim() && !esTextoTecnico(t));
  if (delServidor && error.estado < 500) return delServidor;

  return alternativo || MENSAJES_POR_ESTADO[error.estado] || MENSAJE_GENERICO;
}