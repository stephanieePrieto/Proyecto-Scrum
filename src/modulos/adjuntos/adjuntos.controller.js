// Responsable: Alfonso - HU-20: recibe la peticion y responde (adjuntos); sin logica de negocio
/**
 * @file adjuntos.controller.js
 * @description Controladores HTTP de adjuntos. Respuesta: `{ ok: true, datos }`.
 */
import * as servicio from './adjuntos.service.js';
import { leerId } from '../detalle-tarjeta/detalle-tarjeta.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * Lee el id del adjunto desde la ruta.
 * @param {import('express').Request} req Peticion.
 * @returns {number} Identificador valido.
 * @throws {ErrorApp} 400 si no es valido.
 */
function leerAdjuntoId(req) {
  const id = leerId(req.params.id);
  if (id === null) throw new ErrorApp('El identificador del adjunto no es válido.', 400);
  return id;
}

/** GET /tarea/:tareaId — Adjuntos de la tarjeta. */
export const listar = asyncHandler(async (req, res) => {
  const adjuntos = await servicio.listarAdjuntos({
    tareaId: Number(req.params.tareaId),
    usuarioId: req.user.id,
    rol: req.rolProyecto,
  });
  res.status(200).json({ ok: true, datos: { adjuntos } });
});

/** POST /tarea/:tareaId — Sube un archivo (campo multipart "archivo"). */
export const subir = asyncHandler(async (req, res) => {
  const adjunto = await servicio.guardarAdjunto({
    tareaId: Number(req.params.tareaId),
    proyectoId: req.proyectoId,
    usuarioId: req.user.id,
    rol: req.rolProyecto,
    archivo: req.file,
  });
  res.status(201).json({ ok: true, datos: { adjunto } });
});

/** GET /:id/descargar — Descarga el archivo con su nombre original. */
export const descargar = asyncHandler(async (req, res) => {
  const { ruta, nombre } = await servicio.obtenerParaDescarga(leerAdjuntoId(req));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(ruta, nombre, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ ok: false, error: 'El archivo ya no está disponible.' });
    }
  });
});

/** DELETE /:id — Elimina el adjunto (autor o Scrum Master). */
export const eliminar = asyncHandler(async (req, res) => {
  await servicio.eliminarAdjunto({
    id: leerAdjuntoId(req),
    usuarioId: req.user.id,
    rol: req.rolProyecto,
  });
  res.status(200).json({ ok: true });
});