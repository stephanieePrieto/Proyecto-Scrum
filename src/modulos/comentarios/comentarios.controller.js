// Responsable: Alfonso - HU-20: recibe la peticion y responde (comentarios); sin logica de negocio
/**
 * @file comentarios.controller.js
 * @description Controladores HTTP de comentarios. Respuesta: `{ ok: true, datos }`.
 */
import * as servicio from './comentarios.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** GET /tarea/:tareaId — Comentarios de la tarjeta. */
export const listar = asyncHandler(async (req, res) => {
  const comentarios = await servicio.listarComentarios(Number(req.params.tareaId));
  res.status(200).json({ ok: true, datos: { comentarios } });
});

/** GET /tarea/:tareaId/mencionables — Miembros del proyecto a quienes se puede mencionar. */
export const mencionables = asyncHandler(async (req, res) => {
  const usuarios = await servicio.listarMencionables(req.proyectoId, req.user.id);
  res.status(200).json({ ok: true, datos: { usuarios } });
});

/** POST /tarea/:tareaId — Publica un comentario (body: { texto }). */
export const crear = asyncHandler(async (req, res) => {
  const comentario = await servicio.crearComentario({
    tareaId: Number(req.params.tareaId),
    proyectoId: req.proyectoId,
    usuarioId: req.user.id,
    texto: req.body?.texto,
  });
  res.status(201).json({ ok: true, datos: { comentario } });
});