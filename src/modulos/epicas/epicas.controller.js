// HU-04: capa HTTP para la gestión de épicas.
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './epicas.service.js';

export const listar = asyncHandler(async (req, res) => {
  res.json({ epicas: await servicio.listar(req.user, req.params.proyectoId) });
});
export const crear = asyncHandler(async (req, res) => {
  const epica = await servicio.crear(req.user, req.params.proyectoId, req.body);
  res.status(201).json({ epica });
});
export const actualizar = asyncHandler(async (req, res) => {
  const epica = await servicio.actualizar(req.user, req.params.proyectoId, req.params.epicaId, req.body);
  res.json({ epica });
});

export const eliminar = asyncHandler(async (req, res) => {
  const resultado = await servicio.eliminar(req.user, req.params.proyectoId, req.params.epicaId, req.body);
  res.json(resultado);
});
