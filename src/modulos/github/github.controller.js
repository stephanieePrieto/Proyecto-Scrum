/**
 * @file github.controller.js
 * @description Controlador HTTP para la actividad del repositorio de GitHub.
 */
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './github.service.js';

/** Entrega la actividad del repositorio conectado al proyecto solicitado. */
export const obtenerActividad = asyncHandler(async (req, res) => {
  const actividad = await servicio.obtenerActividad(req.params.proyectoId, req.user);
  res.json(actividad);
});
