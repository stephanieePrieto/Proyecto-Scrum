/**
 * @file registrarPeticiones.js
 * @description Middleware para el registro estructurado de peticiones HTTP con medición de tiempos de respuesta.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { registrarLog } from '../utils/logger.js';

/** Expresión regular para identificar campos sensibles que no deben imprimirse en logs */
const CAMPOS_SENSIBLES = /pass|clave|contrasena|contraseña|token/i;

/**
 * Clona el objeto body sustituyendo valores sensibles por '[REDACTADO]'
 * @param {Object} cuerpo - Objeto de petición HTTP
 * @returns {Object|null} Objeto sanitizado
 */
function sanitizarCuerpoLog(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') return cuerpo;
  if (Array.isArray(cuerpo)) return cuerpo.map(sanitizarCuerpoLog);

  const limpio = {};
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (CAMPOS_SENSIBLES.test(clave)) {
      limpio[clave] = '[REDACTADO]';
    } else if (valor && typeof valor === 'object') {
      limpio[clave] = sanitizarCuerpoLog(valor);
    } else {
      limpio[clave] = valor;
    }
  }
  return limpio;
}

/**
 * Middleware para interceptar y registrar método, ruta, IP, código HTTP y tiempo de respuesta en ms.
 */
export const registrarPeticiones = (req, res, next) => {
  const inicio = process.hrtime();

  res.on('finish', () => {
    const diferencia = process.hrtime(inicio);
    const tiempoMs = (diferencia[0] * 1000 + diferencia[1] / 1e6).toFixed(2);

    const infoPeticion = {
      metodo: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip || req.socket?.remoteAddress,
      estadoHttp: res.statusCode,
      tiempoRespuestaMs: Number(tiempoMs),
      cuerpoPeticion: sanitizarCuerpoLog(req.body),
    };

    const nivel = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    registrarLog(nivel, `Petición procesada: ${req.method} ${req.originalUrl || req.url}`, infoPeticion);
  });

  next();
};

export default registrarPeticiones;