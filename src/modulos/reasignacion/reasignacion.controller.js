/**
 * @file reasignacion.controller.js
 * @description Controlador HTTP de la reasignación por arrastre (HU-21, criterio 4). Toma el proyecto ya
 *              autorizado (`req.proyectoId`, lo deja `requierePermiso`), llama al servicio y responde
 *              `{ ok: true, datos }`. Los errores (ErrorApp) los formatea manejoErrores.
 * 
 * @author Alfonso Mendoza Vasquez
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './reasignacion.service.js';

/** POST /tarea/:tareaId — Cambia el responsable de la tarea. Cuerpo: { responsable_id, responsable_anterior_id? }. */
export const reasignar = asyncHandler(async (req, res) => {
  const cuerpo = req.body ?? {};
  const datos = await servicio.reasignarTarea({
    proyectoId: req.proyectoId,
    tareaId: req.params.tareaId,
    responsableId: cuerpo.responsable_id,
    responsableAnteriorId: Object.hasOwn(cuerpo, 'responsable_anterior_id') ? cuerpo.responsable_anterior_id : undefined,
    usuario: req.user,
    rol: req.rolProyecto,
  });
  res.json({ ok: true, datos });
});
