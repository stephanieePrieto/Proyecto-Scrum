// Responsable: Jetz - HU-02, HU-03, HU-05: recibe la peticion y responde (historias, orden de prioridad y puntos); sin logica de negocio
import * as servicio from './backlog.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * Envolver un controlador asíncrono.
 * Los errores controlados (ErrorApp: 400, 403, 404, 409...) se responden aquí mismo como
 * { mensaje } o { mensaje, detalles } para que la pantalla pueda marcar el campo o mostrar
 * la acción correcta (errores por campo, "sprint_activo", "version"...). Así el módulo no
 * depende del manejoErrores global (BASE), que solo devuelve { mensaje }.
 * Cualquier otro error (un fallo inesperado, 500) pasa al manejador global.
 */
const envolver = (funcion) => asyncHandler(async (req, res) => {
  try {
    await funcion(req, res);
  } catch (error) {
    if (error?.isOperational || error?.detalles) {
      return res.status(error.statusCode || 400).json({
        mensaje: error.message,
        ...(error.detalles ? { detalles: error.detalles } : {}),
      });
    }
    throw error;
  }
});

/** GET /api/backlog/proyecto/:proyectoId → { historias, epicas } */
export const listar = envolver(async (req, res) => {
  res.json(await servicio.listar(req.user, req.params.proyectoId));
});

/** POST /api/backlog/proyecto/:proyectoId/historias → 201 { historia } */
export const crear = envolver(async (req, res) => {
  const historia = await servicio.crear(req.user, req.params.proyectoId, req.body);
  res.status(201).json({ historia });
});

/** PUT /api/backlog/historias/:id → { historia }  (el cuerpo incluye `version`) */
export const actualizar = envolver(async (req, res) => {
  const historia = await servicio.actualizar(req.user, req.params.id, req.body);
  res.json({ historia });
});

/** DELETE /api/backlog/historias/:id → { id } */
export const eliminar = envolver(async (req, res) => {
  res.json(await servicio.eliminar(req.user, req.params.id));
});

/** POST /api/backlog/historias/:id/devolver → { historia } */
export const devolver = envolver(async (req, res) => {
  const historia = await servicio.devolverAlBacklog(req.user, req.params.id);
  res.json({ historia });
});

/** PUT /api/backlog/proyecto/:proyectoId/orden  { historia_id, antes_de_id } → { historias } */
export const reordenar = envolver(async (req, res) => {
  res.json(await servicio.reordenar(req.user, req.params.proyectoId, req.body));
});
