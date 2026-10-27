import { env } from '../config/env.js';
// BASE (no modificar sin avisar al equipo) - HU-47: convierte cualquier error en una respuesta JSON uniforme
/**
 * @file manejoErrores.js
 * @description Middlewares globales para la captura y respuesta de errores HTTP.
 */

/**
 * Middleware para capturar rutas /api no encontradas (404).
 */
export const noEncontrado = (req, res, next) => {
  res.status(404).json({ mensaje: `Ruta no encontrada: ${req.originalUrl}` });
};

/**
 * Middleware global para el manejo de errores no controlados (500).
 */
export const manejoErrores = (err, req, res, next) => {
  console.error('Error no controlado:', err);
  // ErrorApp guarda en "status" un texto ('fail' o 'error'), por eso el código HTTP solo se toma si es un entero
  const estado = [err.statusCode, err.status].find(Number.isInteger) ?? 500;
  const cuerpo = {
    // En producción no se filtran detalles internos de errores 5xx
    mensaje: estado >= 500 && env.ES_PRODUCCION ? 'Error interno del servidor' : err.message || 'Error interno del servidor',
  };
  // Los detalles estructurados (campos con error, motivo, pendientes) solo viajan en errores operacionales de ErrorApp
  if (err.isOperational && err.detalles) cuerpo.detalles = err.detalles;
  res.status(estado).json(cuerpo);
};