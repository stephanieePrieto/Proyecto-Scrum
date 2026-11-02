// Responsable: Alfonso - HU-28: recibe la peticion y responde (desviacion de horas); sin logica de negocio
/**
 * @file desviacion.controller.js
 * @description Controladores HTTP de la HU-28. Toman el proyecto ya autorizado (`req.proyectoId`, lo deja
 *              `requierePermiso`), llaman al servicio y responden `{ ok: true, datos }`.
 *              Los errores (ErrorApp) los formatea manejoErrores.
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './desviacion.service.js';

/** Middleware: 403 si el rol vigente no está en ROLES_PERMITIDOS (va después de requierePermiso). */
export const exigirRol = (req, _res, next) => {
  try {
    servicio.exigirRolPermitido(req.rolProyecto);
    next();
  } catch (error) {
    next(error);
  }
};

/** GET /proyectos/:proyectoId/sprints — Sprints del proyecto y el sugerido por defecto. */
export const sprints = asyncHandler(async (req, res) => {
  const datos = await servicio.listarSprints(req.proyectoId);
  res.json({ ok: true, datos });
});

/** GET /proyectos/:proyectoId/sprints/:sprintId — Resumen del sprint. */
export const resumen = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerResumen(req.proyectoId, req.params.sprintId);
  res.json({ ok: true, datos });
});

/** GET /proyectos/:proyectoId/sprints/:sprintId/:nivel — Desviación por tareas, historias o personas. */
export const porNivel = asyncHandler(async (req, res) => {
  const datos = await servicio.listarPorNivel(req.proyectoId, req.params.sprintId, req.params.nivel);
  res.json({ ok: true, datos });
});
