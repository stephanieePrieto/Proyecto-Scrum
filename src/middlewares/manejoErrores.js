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
  const estado = err.status || err.statusCode || 500;
  res.status(estado).json({
    // En producción no se filtran detalles internos de errores 5xx
    mensaje: estado >= 500 && env.ES_PRODUCCION ? 'Error interno del servidor' : err.message || 'Error interno del servidor',
  });
};