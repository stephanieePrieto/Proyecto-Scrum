// Responsable: Diego - HU-11: recibe la peticion y responde (impedimentos); sin logica de negocio
import * as servicio from './impedimentos.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * Envolver un controlador asíncrono.
 * Los errores controlados (ErrorApp: 400, 404, 409...) se responden aquí como { mensaje, detalles } para que
 * la pantalla pueda marcar el campo con error o mostrar quién resolvió. Cualquier otro error pasa al manejador global.
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

/** GET /api/impedimentos/proyecto/:proyectoId?estado=&severidad= → { impedimentos, resumen, miembros, tareas, yo } */
export const listar = envolver(async (req, res) => {
  res.json(await servicio.listar(req.user, req.params.proyectoId, {
    estado: req.query.estado || 'todos',
    severidad: req.query.severidad || '',
  }));
});

/** POST /api/impedimentos/proyecto/:proyectoId → 201 { impedimento } */
export const crear = envolver(async (req, res) => {
  const impedimento = await servicio.crear(req.user, req.params.proyectoId, req.body);
  res.status(201).json({ impedimento });
});

/** POST /api/impedimentos/:id/resolver → { impedimento } */
export const resolver = envolver(async (req, res) => {
  const impedimento = await servicio.resolver(req.user, req.params.id);
  res.json({ impedimento });
});
