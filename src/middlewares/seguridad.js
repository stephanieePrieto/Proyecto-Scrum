/**
 * @file seguridad.js
 * @description Cabeceras de seguridad (Helmet/CSP/HSTS) y sanitización anti-XSS de la entrada.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import helmet from 'helmet';
import sanitizeHtml from 'sanitize-html';
import { env } from '../config/env.js';

const usaHttps = env.HTTPS_ACTIVO || env.FORZAR_HTTPS;

/**
 * Cabeceras de seguridad HTTP (reemplaza las cabeceras manuales de HU-53).
 * Incluye CSP restrictiva, X-Frame-Options, nosniff, Referrer-Policy y HSTS (solo producción).
 * Si la CSP bloquea un CDN o fuente que usan, agréguenlo al arreglo que corresponda.
 *
 * @type {import('express').RequestHandler}
 */
export const cabecerasSeguridad = helmet({
  contentSecurityPolicy: {
    reportOnly: env.CSP_SOLO_REPORTE,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: usaHttps ? [] : null,
    },
  },
  hsts: env.ES_PRODUCCION && usaHttps ? { maxAge: 15552000, includeSubDomains: true } : false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'same-origin' },
});

/** Campos que nunca se sanitizan, para no alterar contraseñas ni tokens. */
const CAMPOS_EXCLUIDOS = /pass|clave|contrasena|contraseña|token/i;
/** Claves usadas en ataques de prototype pollution. */
const CLAVES_PELIGROSAS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_PROFUNDIDAD = 10;

/**
 * Elimina todo HTML de un texto. sanitize-html convierte & en &amp;,
 * que se restaura para no ensuciar textos como "R&D".
 *
 * @param {string} texto - Texto de entrada.
 * @returns {string} Texto sin etiquetas ni atributos HTML.
 */
const limpiarTexto = (texto) =>
  sanitizeHtml(texto, { allowedTags: [], allowedAttributes: {} }).replace(/&amp;/g, '&');

/**
 * Sanitiza recursivamente strings dentro de objetos y arreglos.
 *
 * @param {*} valor - Valor a limpiar.
 * @param {number} [profundidad=0] - Nivel actual de anidamiento.
 * @returns {*} Copia limpia del valor.
 */
const limpiarValor = (valor, profundidad = 0) => {
  if (typeof valor === 'string') return limpiarTexto(valor);
  if (valor === null || typeof valor !== 'object') return valor;
  if (profundidad >= MAX_PROFUNDIDAD) return null;
  if (Array.isArray(valor)) return valor.map((v) => limpiarValor(v, profundidad + 1));

  const limpio = {};
  for (const [clave, v] of Object.entries(valor)) {
    if (CLAVES_PELIGROSAS.has(clave)) continue;
    limpio[clave] = CAMPOS_EXCLUIDOS.test(clave) ? v : limpiarValor(v, profundidad + 1);
  }
  return limpio;
};

/**
 * Middleware que sanitiza req.body (JSON) contra XSS almacenado.
 * Debe registrarse después de express.json().
 *
 * @type {import('express').RequestHandler}
 */
export const sanitizarEntrada = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') req.body = limpiarValor(req.body);
  next();
};