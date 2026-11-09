/** HU-05 · Controladores de estimación Fibonacci y sesiones de Planning Poker. */
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './poker.service.js';

export const listarHistorias = asyncHandler(async (req, res) => {
  const historias = await servicio.listarHistorias(req.user, req.params.proyectoId);
  res.json({ historias });
});

export const estimarHistoria = asyncHandler(async (req, res) => {
  const historia = await servicio.estimarHistoria(
    req.user, req.params.proyectoId, req.params.historiaId, req.body,
  );
  res.json({ historia, mensaje: 'Estimación Fibonacci guardada correctamente.' });
});

export const consultarPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.consultarPoker(req.user, req.params.proyectoId, req.params.historiaId));
});
export const iniciarPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.iniciarPoker(req.user, req.params.proyectoId, req.params.historiaId));
});
export const votarPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.votarPoker(req.user, req.params.proyectoId, req.params.historiaId, req.body));
});
export const nuevaRondaPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.nuevaRondaPoker(req.user, req.params.proyectoId, req.params.historiaId));
});
export const cerrarPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.cerrarPoker(req.user, req.params.proyectoId, req.params.historiaId, req.body));
});

export const revelarPoker = asyncHandler(async (req, res) => {
  res.json(await servicio.revelarPoker(req.user, req.params.proyectoId, req.params.historiaId));
});
