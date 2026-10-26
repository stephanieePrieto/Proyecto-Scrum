/**
 * @file forzarHttps.js
 * @description Redirección forzada de HTTP a HTTPS.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { env } from '../config/env.js';

const origenHttps = new URL(env.APP_URL);

if ((env.FORZAR_HTTPS || env.HTTPS_ACTIVO) && origenHttps.protocol !== 'https:') {
  throw new Error('[Seguridad] APP_URL debe comenzar con https:// cuando FORZAR_HTTPS o HTTPS_ACTIVO están activos.');
}

/**
 * Responde con una redirección permanente hacia la versión HTTPS de la URL.
 * Funciona con un servidor http nativo de Node y con Express.
 * Usa APP_URL como destino (no la cabecera Host) para evitar open redirect.
 * 301 para GET/HEAD; 308 para el resto, que conserva método y cuerpo.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {void}
 */
export const redirigirAHttps = (req, res) => {
  const ruta = req.url?.startsWith('/') ? req.url : '/';
  const estado = ['GET', 'HEAD'].includes(req.method) ? 301 : 308;
  res.writeHead(estado, { Location: `${origenHttps.origin}${ruta}` });
  res.end();
};

/**
 * Middleware Express: si FORZAR_HTTPS está activo y la petición llegó por HTTP
 * (req.secure respeta X-Forwarded-Proto cuando CONFIAR_PROXY=true), redirige.
 *
 * @type {import('express').RequestHandler}
 */
export const forzarHttps = (req, res, next) => {
  if (!env.FORZAR_HTTPS || req.secure) return next();
  return redirigirAHttps(req, res);
};