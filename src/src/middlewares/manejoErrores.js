/**
 * @file manejoErrores.js
 * @description Middlewares globales para la captura y respuesta de errores HTTP y conmutación a mantenimiento ante caída de BD.
 * 
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { esErrorCaidaBD } from '../config/db.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const paginaMantenimiento = path.join(aqui, '..', '..', 'public', 'pages', 'mantenimiento.html');

/**
 * Middleware para capturar rutas /api no encontradas (404).
 */
export const noEncontrado = (req, res, next) => {
  res.status(404).json({ mensaje: `Ruta no encontrada: ${req.originalUrl}` });
};

/**
 * Middleware global para el manejo de errores no controlados (500 / 503).
 */
export const manejoErrores = (err, req, res, next) => {
  console.error('Error no controlado:', err);

  // Detección de caída de base de datos primaria
  if (err.esCaidaBD || esErrorCaidaBD(err)) {
    const aceptaHtml = req.headers.accept && req.headers.accept.includes('text/html') && !req.originalUrl.startsWith('/api');
    if (aceptaHtml) {
      return res.status(503).sendFile(paginaMantenimiento);
    }
    return res.status(503).json({
      mensaje: 'Servicio en mantenimiento temporal: base de datos no disponible. Reintenta en unos momentos.',
      mantenimiento: true,
      urlMantenimiento: '/pages/mantenimiento.html',
    });
  }

  const estado = [err.statusCode, err.status].find(Number.isInteger) ?? 500;
  const cuerpo = {
    mensaje: estado >= 500 && env.ES_PRODUCCION ? 'Error interno del servidor' : err.message || 'Error interno del servidor',
  };
  if (err.isOperational && err.detalles) cuerpo.detalles = err.detalles;
  res.status(estado).json(cuerpo);
};