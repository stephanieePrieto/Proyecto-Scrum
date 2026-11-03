// Responsable: Diego - HU-09: recibe la peticion y responde (iniciar y cerrar sprint); sin logica de negocio
import * as servicio from './ciclo-sprint.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * Envolver un controlador asíncrono.
 * Los errores controlados (ErrorApp: 400, 404, 409...) se responden aquí como { mensaje, detalles } para que
 * la pantalla pueda marcar el campo o listar lo que falta. Cualquier otro error pasa al manejador global.
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

/** GET /api/ciclo-sprint/proyecto/:proyectoId → { activo, planificados, roles, yo, puedeGestionar } */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.estado(req.user, req.params.proyectoId));
});

/** GET /api/ciclo-sprint/sprint/:id/resumen → resumen de cierre */
export const resumen = envolver(async (req, res) => {
  res.json(await servicio.resumen(req.user, req.params.id));
});

/** POST /api/ciclo-sprint/sprint/:id/iniciar  { objetivo, capacidad_horas } → { sprint } */
export const iniciar = envolver(async (req, res) => {
  res.json({ sprint: await servicio.iniciar(req.user, req.params.id, req.body) });
});

/** POST /api/ciclo-sprint/sprint/:id/cerrar  { destino, siguienteSprintId, revision } → resumen del cierre */
export const cerrar = envolver(async (req, res) => {
  res.json(await servicio.cerrar(req.user, req.params.id, req.body));
});
