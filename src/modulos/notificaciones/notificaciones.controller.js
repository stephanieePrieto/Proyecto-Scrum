// Responsable: Alfonso - HU-24: recibe la peticion y responde (notificaciones dentro de la aplicacion); sin logica de negocio
/**
 * @file notificaciones.controller.js
 * @description Controladores HTTP de la HU-24. Traducen peticiones a llamadas del servicio, extraen el ID del usuario desde el middleware de
 *              autenticación (`req.usuario.id`) y devuelven respuestas uniformes sin filtrar detalles internos.
 *
 * Forma de respuesta: `{ ok: boolean, datos?: Object, error?: string }`.
 */

import * as servicio from './notificaciones.service.js';

/**
 * Obtiene el ID del usuario autenticado.
 * @param {import('express').Request} req Petición (con `req.usuario`).
 * @returns {number|null} ID válido o `null` si no hay sesión.
 */
function obtenerUsuarioId(req) {
  const id = Number(req.usuario?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Traduce un error a una respuesta HTTP segura.
 * Los errores de validación se informan; el resto devuelve un 500 genérico.
 * @param {import('express').Response} res Respuesta.
 * @param {Error} error Error capturado.
 * @returns {import('express').Response} Respuesta enviada.
 */
function responderError(res, error) {
  if (error instanceof servicio.ErrorValidacion) {
    return res.status(400).json({ ok: false, error: error.message });
  }
  console.error('[notificaciones] Error no controlado:', error);
  return res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
}

/**
 * GET / — Historial de notificaciones del usuario autenticado.
 * Query opcional: `limite` y `offset`.
 * @param {import('express').Request} req Petición.
 * @param {import('express').Response} res Respuesta.
 * @returns {Promise<void>}
 */
export async function obtenerHistorial(req, res) {
  try {
    const usuarioId = obtenerUsuarioId(req);
    if (!usuarioId) {
      res.status(401).json({ ok: false, error: 'No autenticado.' });
      return;
    }
    const { limite, offset } = req.query;
    const datos = await servicio.listarPorUsuario(usuarioId, { limite, offset });
    res.status(200).json({ ok: true, datos });
  } catch (error) {
    responderError(res, error);
  }
}

/**
 * PATCH /:id/leida — Marca una notificación del usuario como leída.
 * Devuelve 404 neutro si no existe o es de otro usuario (evita IDOR).
 * @param {import('express').Request} req Petición con `params.id`.
 * @param {import('express').Response} res Respuesta.
 * @returns {Promise<void>}
 */
export async function marcarLeida(req, res) {
  try {
    const usuarioId = obtenerUsuarioId(req);
    if (!usuarioId) {
      res.status(401).json({ ok: false, error: 'No autenticado.' });
      return;
    }

    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: 'Identificador de notificación inválido.' });
      return;
    }

    const resultado = await servicio.marcarComoLeida(id, usuarioId);
    if (!resultado) {
      res.status(404).json({ ok: false, error: 'Notificación no encontrada.' });
      return;
    }
    res.status(200).json({ ok: true, datos: resultado });
  } catch (error) {
    responderError(res, error);
  }
}

export default {
  obtenerHistorial,
  marcarLeida,
};