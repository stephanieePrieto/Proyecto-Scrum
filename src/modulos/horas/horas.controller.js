// Responsable: Alfonso - HU-27: recibe la peticion y responde (registro de horas reales); sin logica de negocio
/**
 * @file horas.controller.js
 * @description Controladores HTTP de la HU-27. Toman el usuario autenticado (`req.user.id`), llaman al
 *              servicio y responden `{ ok: true, datos }`. Los errores (ErrorApp) los formatea manejoErrores.
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './horas.service.js';

/**
 * Obtiene el ID numérico de la persona autenticada.
 * @param {import('express').Request} req Petición con `req.user`.
 * @returns {number} ID del usuario.
 */
const usuarioDe = (req) => Number(req.user.id);

/** GET /semana?inicio=AAAA-MM-DD — Hoja semanal de la persona. */
export const obtenerSemana = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerSemana(usuarioDe(req), req.query.inicio);
  res.json({ ok: true, datos });
});

/** POST / — Registra horas manualmente. */
export const registrar = asyncHandler(async (req, res) => {
  const datos = await servicio.registrarHoras(usuarioDe(req), req.body);
  res.status(201).json({ ok: true, datos });
});

/** PATCH /:id — Edita un registro propio. */
export const actualizar = asyncHandler(async (req, res) => {
  const datos = await servicio.actualizarRegistro(usuarioDe(req), req.params.id, req.body);
  res.json({ ok: true, datos });
});

/** DELETE /:id — Elimina un registro propio. */
export const eliminar = asyncHandler(async (req, res) => {
  const datos = await servicio.eliminarRegistro(usuarioDe(req), req.params.id);
  res.json({ ok: true, datos });
});

/** GET /temporizador — Temporizador actual (`null` si no hay). */
export const obtenerTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerTemporizador(usuarioDe(req));
  res.json({ ok: true, datos });
});

/** POST /temporizador/iniciar — Inicia el temporizador en una tarea. */
export const iniciarTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.iniciarTemporizador(usuarioDe(req), req.body?.tareaId);
  res.status(201).json({ ok: true, datos });
});

/** POST /temporizador/pausar — Pausa el temporizador. */
export const pausarTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.pausarTemporizador(usuarioDe(req));
  res.json({ ok: true, datos });
});

/** POST /temporizador/reanudar — Reanuda el temporizador. */
export const reanudarTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.reanudarTemporizador(usuarioDe(req));
  res.json({ ok: true, datos });
});

/** POST /temporizador/detener — Detiene el temporizador y crea el registro. */
export const detenerTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.detenerTemporizador(usuarioDe(req), req.body);
  res.status(201).json({ ok: true, datos });
});

/** DELETE /temporizador — Descarta el temporizador sin registrar. */
export const descartarTemporizador = asyncHandler(async (req, res) => {
  const datos = await servicio.descartarTemporizador(usuarioDe(req));
  res.json({ ok: true, datos });
});