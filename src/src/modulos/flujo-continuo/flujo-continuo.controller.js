// Responsable: Alfonso - HU-26: controladores HTTP del flujo continuo.
/**
 * @file flujo-continuo.controller.js
 * @description Controladores HTTP de la HU-26. Toman el proyecto ya autorizado (`req.proyectoId` y `req.rolProyecto`,
 *              que deja `requierePermiso`), llaman al servicio y responden `{ ok: true, datos }`.
 *              Los errores (ErrorApp) los formatea manejoErrores.
 *
 * @author Alfonso Mendoza Vasquez
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './flujo-continuo.service.js';

/** GET /proyectos/:proyectoId/resumen-migracion?destino=continuo|scrum — Resumen previo al cambio de modo. */
export const resumenMigracion = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerResumenMigracion(req.proyectoId, req.query.destino);
  res.json({ ok: true, datos });
});

/** POST /proyectos/:proyectoId/modo — Cambia el modo de trabajo (cuerpo: modo, version, confirmar). */
export const cambiarModo = asyncHandler(async (req, res) => {
  const datos = await servicio.cambiarModo(req.proyectoId, req.body ?? {}, req.user);
  res.json({ ok: true, datos });
});

/** GET /proyectos/:proyectoId/tiempos?dias=30 — Lead Time y Cycle Time de las tarjetas terminadas. */
export const tiempos = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerTiempos(req.proyectoId, req.query.dias);
  res.json({ ok: true, datos });
});

/** GET /proyectos/:proyectoId/opciones-tarea — Historias e integrantes para el formulario "+ Tarea" en continuo. */
export const opcionesTarea = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerOpcionesTarea(req.proyectoId, req.rolProyecto);
  res.json({ ok: true, datos });
});
