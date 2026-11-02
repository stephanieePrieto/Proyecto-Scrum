// Responsable: Diego - HU-44: recibe la peticion y responde (capacidad individual); sin logica de negocio
/**
 * @file capacidad.controller.js
 * @description Controlador HTTP para la gestión de capacidad y ausencias.
 */
import {
  ErrorCapacidad,
  verCapacidad,
  guardarCapacidad,
  verCapacidadEquipo,
  contextoActual,
} from './capacidad.service.js';

/**
 * Convertir un parámetro de la ruta en un entero positivo.
 *
 * @param {string} valor
 * @returns {number|null} El entero, o null si no es válido.
 */
function leerId(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Responder los errores de capacidad con su código y el detalle por campo; el resto (ErrorApp u
 * otros) pasa al manejador global de Express.
 *
 * @param {Error} error
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function responderError(error, res, next) {
  if (error instanceof ErrorCapacidad) {
    return res.status(error.estado).json({ mensaje: error.message, errores: error.errores });
  }
  return next(error);
}

/**
 * Responder con quién es la persona de la sesión y a qué equipos pertenece.
 *
 * @route GET /api/capacidad/yo
 */
export async function yo(req, res, next) {
  try {
    res.json(await contextoActual(req.user ?? null));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Responder con la capacidad guardada de una persona.
 *
 * @route GET /api/capacidad/usuarios/:usuarioId
 */
export async function obtener(req, res, next) {
  try {
    const usuarioId = leerId(req.params.usuarioId);
    if (!usuarioId) return res.status(400).json({ mensaje: 'El identificador del usuario no es válido' });
    res.json(await verCapacidad(req.user ?? null, usuarioId));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Guardar las horas por día, las notas y las ausencias de una persona.
 *
 * @route PUT /api/capacidad/usuarios/:usuarioId
 */
export async function guardar(req, res, next) {
  try {
    const usuarioId = leerId(req.params.usuarioId);
    if (!usuarioId) return res.status(400).json({ mensaje: 'El identificador del usuario no es válido' });
    res.json(await guardarCapacidad(req.user ?? null, usuarioId, req.body));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Responder con la capacidad total de un equipo en un rango de fechas.
 *
 * @route GET /api/capacidad/equipos/:equipoId
 */
export async function obtenerEquipo(req, res, next) {
  try {
    const equipoId = leerId(req.params.equipoId);
    if (!equipoId) return res.status(400).json({ mensaje: 'El identificador del equipo no es válido' });
    res.json(await verCapacidadEquipo(req.user ?? null, equipoId, { inicio: req.query.inicio, fin: req.query.fin }));
  } catch (error) {
    responderError(error, res, next);
  }
}
