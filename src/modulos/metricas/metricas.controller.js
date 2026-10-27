/**
 * @file metricas.controller.js
 * @description Recibir las peticiones HTTP del módulo de métricas y responder en JSON.
 * Delegar la lógica de cálculo en metricas.service.js (HU-29 a HU-33, HU-35, HU-36).
 * @author Dana
 */

import {
  exigirIntegranteProyecto,
  listarMisProyectos,
  obtenerKpisDashboard,
  obtenerVelocity,
  obtenerAvance,
} from './metricas.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * Convertir un valor en entero positivo.
 *
 * @param {string|undefined} valor Texto recibido en la URL o en la query.
 * @returns {number|null} El entero, o null si no es un entero positivo.
 */
function aEnteroPositivo(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Responder un error controlado (ErrorApp: 400, 401, 403, 404...) directamente como { mensaje }.
 * Se hace aquí y no en manejoErrores (BASE) porque ese manejador usa err.status, que en ErrorApp
 * es el texto 'fail'/'error', y Express rechaza un estado que no sea numérico (la respuesta sale
 * como HTML). Mismo enfoque que backlog.controller.js. Los fallos inesperados (500) sí pasan a next().
 *
 * @param {Error} error Error capturado.
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function responderError(error, res, next) {
  if (error?.isOperational) return res.status(error.statusCode).json({ mensaje: error.message });
  return next(error);
}

/**
 * Leer y validar :proyectoId de la ruta y comprobar que el usuario pertenezca al proyecto.
 * Lanzar 400 si el identificador no es válido; 401/403 según la sesión y la pertenencia.
 *
 * @param {import('express').Request} req
 * @returns {Promise<number>} Identificador del proyecto ya validado.
 */
async function validarAcceso(req) {
  const proyectoId = aEnteroPositivo(req.params.proyectoId);
  if (!proyectoId) throw new ErrorApp('El identificador del proyecto no es válido.', 400);

  await exigirIntegranteProyecto(req.user?.id, proyectoId);
  return proyectoId;
}

/**
 * Responder con los KPIs del dashboard del proyecto indicado en la URL (HU-35).
 * Un KPI que falle viaja como { error: true }; los demás se entregan normalmente.
 *
 * @route GET /api/metricas/proyectos/:proyectoId/dashboard
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function dashboard(req, res, next) {
  try {
    const proyectoId = await validarAcceso(req);
    res.json(await obtenerKpisDashboard(proyectoId));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Responder con la velocity de cada sprint cerrado y su promedio móvil (HU-30).
 *
 * @route GET /api/metricas/proyectos/:proyectoId/velocity
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function velocity(req, res, next) {
  try {
    const proyectoId = await validarAcceso(req);
    res.json(await obtenerVelocity(proyectoId));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Responder con el avance por persona y por equipo (HU-31).
 * Aceptar ?sprintId=N para limitar el cálculo a un sprint; sin él se usa todo el proyecto.
 *
 * @route GET /api/metricas/proyectos/:proyectoId/avance
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function avance(req, res, next) {
  try {
    const proyectoId = await validarAcceso(req);

    // sprintId es opcional, pero si viene debe ser un entero positivo
    let sprintId = null;
    if (req.query.sprintId !== undefined && req.query.sprintId !== '') {
      sprintId = aEnteroPositivo(req.query.sprintId);
      if (!sprintId) throw new ErrorApp('El identificador del sprint no es válido.', 400);
    }

    res.json(await obtenerAvance(proyectoId, sprintId));
  } catch (error) {
    responderError(error, res, next);
  }
}

/**
 * Responder con los proyectos del usuario autenticado (para elegir el proyecto en la página de métricas).
 *
 * @route GET /api/metricas/mis-proyectos
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function misProyectos(req, res, next) {
  try {
    res.json(await listarMisProyectos(req.user?.id));
  } catch (error) {
    responderError(error, res, next);
  }
}