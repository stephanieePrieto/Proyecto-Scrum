// Responsable: Alfonso - HU-20: recibe la peticion y responde (detalle de tarjeta); sin logica de negocio
/**
 * @file detalle-tarjeta.controller.js
 * @description Controladores HTTP del detalle de tarjeta. Respuesta: `{ ok: true, datos }`.
 *              Los errores (ErrorApp) los resuelve el middleware global `manejoErrores`.
 */
import * as servicio from './detalle-tarjeta.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * Lee el id de la subtarea desde la ruta.
 * @param {import('express').Request} req Peticion.
 * @returns {number} Identificador valido.
 * @throws {ErrorApp} 400 si no es valido.
 */
function leerItemId(req) {
  const itemId = servicio.leerId(req.params.itemId);
  if (itemId === null) throw new ErrorApp('El identificador de la subtarea no es válido.', 400);
  return itemId;
}

/** GET /:tareaId — Datos, checklist e historial de la tarjeta. */
export const obtener = asyncHandler(async (req, res) => {
  const datos = await servicio.obtenerDetalle(Number(req.params.tareaId));
  res.status(200).json({ ok: true, datos });
});

/** GET /:tareaId/historial — Historial de cambios de la tarjeta. */
export const historial = asyncHandler(async (req, res) => {
  const lista = await servicio.listarHistorial(Number(req.params.tareaId));
  res.status(200).json({ ok: true, datos: { historial: lista } });
});

/** POST /:tareaId/checklist — Agrega una subtarea. */
export const agregarItem = asyncHandler(async (req, res) => {
  const item = await servicio.agregarItem({
    tareaId: Number(req.params.tareaId),
    usuarioId: req.user.id,
    texto: req.body?.texto,
  });
  res.status(201).json({ ok: true, datos: { item } });
});

/** PATCH /:tareaId/checklist/:itemId — Marca o desmarca una subtarea. */
export const actualizarItem = asyncHandler(async (req, res) => {
  const item = await servicio.actualizarItem({
    tareaId: Number(req.params.tareaId),
    itemId: leerItemId(req),
    usuarioId: req.user.id,
    hecho: req.body?.hecho,
  });
  res.status(200).json({ ok: true, datos: { item } });
});

/** DELETE /:tareaId/checklist/:itemId — Elimina una subtarea. */
export const eliminarItem = asyncHandler(async (req, res) => {
  await servicio.eliminarItem({
    tareaId: Number(req.params.tareaId),
    itemId: leerItemId(req),
    usuarioId: req.user.id,
  });
  res.status(200).json({ ok: true });
});