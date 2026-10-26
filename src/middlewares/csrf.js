/**
 * @file csrf.js
 * @description Protección CSRF con patrón "double-submit cookie".
 * El servidor entrega un token aleatorio en una cookie legible por JS; en métodos
 * que modifican datos (POST/PUT/PATCH/DELETE) el cliente debe reenviarlo en la
 * cabecera X-CSRF-Token. Un sitio atacante no puede leer esa cookie, así que no
 * puede forjar la cabecera.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const NOMBRE_COOKIE = 'csrfToken';
const NOMBRE_CABECERA = 'x-csrf-token';
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);
const FORMATO_TOKEN = /^[a-f0-9]{64}$/;

/** httpOnly=false es intencional: el JS del cliente debe poder leerla. */
const OPCIONES_COOKIE = {
  httpOnly: false,
  sameSite: 'strict',
  secure: env.ES_PRODUCCION || env.HTTPS_ACTIVO,
  path: '/',
};

/**
 * Compara dos strings en tiempo constante.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
const sonIguales = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Middleware CSRF. Requiere cookie-parser registrado antes. Debe ir antes de
 * express.static para que las páginas HTML entreguen la cookie en la primera visita.
 *
 * @type {import('express').RequestHandler}
 */
export const proteccionCsrf = (req, res, next) => {
  let token = req.cookies?.[NOMBRE_COOKIE];

  if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(NOMBRE_COOKIE, token, OPCIONES_COOKIE);
  }

  if (METODOS_SEGUROS.has(req.method)) return next();

  const enviado = req.get(NOMBRE_CABECERA);
  if (typeof enviado !== 'string' || !sonIguales(enviado, token)) {
    return res.status(403).json({ mensaje: 'Token CSRF inválido o ausente.' });
  }
  next();
};