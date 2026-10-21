/**
 * @file metricas.controller.js
 * @description Recibir las peticiones HTTP del módulo de métricas y responder en JSON.
 * Delegar la lógica de cálculo en metricas.service.js (HU-29 a HU-33, HU-35, HU-36).
 * @author Dana
 */

import { obtenerKpisDashboard } from './metricas.service.js';

/**
 * Responder con los KPIs del dashboard del proyecto indicado en la URL.
 * Validar que proyectoId sea un entero positivo; responder 400 en caso contrario.
 * Aceptar ?escenario=... (solo tiene efecto en modo demo).
 * Delegar cualquier error inesperado al manejador de errores de Express.
 *
 * @route GET /api/proyectos/:proyectoId/metricas/dashboard
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function dashboard(req, res, next) {
  try {
    // Convertir y validar el parámetro de la ruta
    const proyectoId = Number(req.params.proyectoId);
    if (!Number.isInteger(proyectoId) || proyectoId <= 0) {
      return res.status(400).json({ mensaje: 'El identificador del proyecto no es válido' });
    }

    // Calcular los KPIs y responder
    const datos = await obtenerKpisDashboard(proyectoId, req.query.escenario);
    res.json(datos);
  } catch (error) {
    next(error);
  }
}