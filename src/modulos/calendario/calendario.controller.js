/**
 * @file calendario.controller.js
 * @description Recibe la peticion y responde (eventos Scrum); sin logica de negocio
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import * as servicio from './calendario.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/calendario/proyecto/:proyectoId → { zona, sprint, eventos, conflictos, mensaje } */
export const obtener = asyncHandler(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId));
});

/** GET /api/calendario/proyecto/:proyectoId/reuniones → { zona, reuniones, miembros, puedeGestionar } */
export const listarReuniones = envolver(async (req, res) => {
  res.json(await servicio.listarReuniones(req.user, req.params.proyectoId));
});

/** POST /api/calendario/proyecto/:proyectoId/reuniones  { titulo, tipo, fecha, hora_inicio, hora_fin, participantes, notas } → 201 { reunion } */
export const crearReunion = envolver(async (req, res) => {
  res.status(201).json({ reunion: await servicio.crearReunion(req.user, req.params.proyectoId, req.body) });
});

/** PUT /api/calendario/reuniones/:id  (mismos campos) → { reunion } */
export const actualizarReunion = envolver(async (req, res) => {
  res.json({ reunion: await servicio.actualizarReunion(req.user, req.params.id, req.body) });
});

/** DELETE /api/calendario/reuniones/:id → { eliminada, id } */
export const eliminarReunion = envolver(async (req, res) => {
  res.json(await servicio.eliminarReunion(req.user, req.params.id));
});
