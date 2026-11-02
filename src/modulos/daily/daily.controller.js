// Responsable: Diego - HU-10: recibe la peticion y responde (Daily Scrum); sin logica de negocio
import * as servicio from './daily.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * Envolver un controlador asíncrono.
 * Los errores controlados (ErrorApp: 400, 409...) se responden aquí como { mensaje, detalles } para que
 * la pantalla pueda marcar el campo con error. Cualquier otro error pasa al manejador global.
 */
const envolver = (funcion) => asyncHandler(async (req, res) => {
  try {
    await funcion(req, res);
  } catch (error) {
    if (error?.isOperational) {
      return res.status(error.statusCode || 400).json({
        mensaje: error.message,
        ...(error.detalles ? { detalles: error.detalles } : {}),
      });
    }
    throw error;
  }
});

/** GET /api/daily/proyecto/:proyectoId?fecha=AAAA-MM-DD → estado de la Daily del equipo ese día */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId, req.query.fecha));
});

/** PUT /api/daily/proyecto/:proyectoId  { ayer, hoy, impedimentos, tareas } → { creado, tardio, mensaje } */
export const guardar = envolver(async (req, res) => {
  res.json(await servicio.guardar(req.user, req.params.proyectoId, req.body));
});
