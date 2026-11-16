/**
 * @file comparativo.controller.js
 * @description Controlador HTTP del comparativo entre equipos (HU-2). Delegar la lógica en comparativo.service.js.
 */

import { obtenerComparativo } from './comparativo.service.js';

/**
 * Responder un error controlado con su código HTTP; los inesperados pasan al manejador global.
 *
 * @param {Error} error
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function responderError(error, res, next) {
  if (error?.isOperational) return res.status(error.statusCode).json({ mensaje: error.message });
  return next(error);
}

/**
 * @route GET /api/comparativo/resumen
 */
export async function resumen(req, res, next) {
  try {
    res.json(await obtenerComparativo(req.user?.id));
  } catch (error) {
    responderError(error, res, next);
  }
}
