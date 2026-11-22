/**
 * @file burnup.controller.js
 * @description Controladores HTTP del Burnup y del CFD (HU-1). Convierten la petición, llaman al servicio
 * y devuelven JSON. Los errores controlados (ErrorApp) salen como { mensaje } con su código.
 */

import { obtenerBurnup, obtenerCfd } from './burnup.service.js';

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
 * @route GET /api/burnup/proyectos/:proyectoId/burnup
 */
export async function burnup(req, res, next) {
  try {
    res.json(await obtenerBurnup(Number(req.params.proyectoId), req.user?.id));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * @route GET /api/burnup/proyectos/:proyectoId/cfd
 */
export async function cfd(req, res, next) {
  try {
    res.json(await obtenerCfd(Number(req.params.proyectoId), req.user?.id));
  } catch (error) {
    responderError(error, res, next);
  }
}
