// HU-01: recibe la peticion y responde (proyectos y Definition of Done); sin logica de negocio

/**
 * @file proyectos.controller.js
 * @description Recibe la petición y responde (proyectos y Definition of Done); sin lógica de negocio.
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */

import * as servicio from './proyectos.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const listar = asyncHandler(async (req, res) => {
  const proyectos = await servicio.listar(req.user, { archivados: req.query.archivados === 'true' });
  res.json({ proyectos });
});

export const equipos = asyncHandler(async (req, res) => {
  const lista = await servicio.equiposDisponibles(req.user);
  res.json({ equipos: lista, dod_base: servicio.DOD_BASE });
});

export const crear = asyncHandler(async (req, res) => {
  const proyecto = await servicio.crear(req.body, req.user);
  res.status(201).json({ proyecto });
});

export const obtener = asyncHandler(async (req, res) => {
  const proyecto = await servicio.obtener(req.params.id, req.user);
  // Un proyecto inexistente y uno ajeno responden igual para no revelar que existe
  if (!proyecto) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  res.json({
    proyecto,
    puede_gestionar: await servicio.puedeGestionar(req.params.id, req.user)
  });
});

export const actualizar = asyncHandler(async (req, res) => {
  const proyecto = await servicio.actualizar(req.params.id, req.body, req.user);
  res.json({ proyecto });
});

export const archivar = asyncHandler(async (req, res) => {
  const proyecto = await servicio.archivar(req.params.id, req.user);
  res.json({ proyecto });
});