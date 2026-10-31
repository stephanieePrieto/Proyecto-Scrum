// Responsable: Jetz - HU-08: recibe la peticion y responde (tareas de una historia); sin logica de negocio

/**
 * HU-08: Controlador de tareas técnicas.
 * Recibe las peticiones y llama al servicio.
 */

import * as servicio from './tareas.service.js';

// Manejar errores de funciones asíncronas
const manejar = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Crear una tarea técnica
export const crear = manejar(async (req, res) => {
  const tarea = await servicio.crear(req.body, req.user);

  res.status(201).json({
    tarea
  });
});


/**
 * HU-08: Consultar las tareas técnicas de una historia.
 */
export const listarPorHistoria = manejar(async (req, res) => {
  const tareas = await servicio.listarPorHistoria(
    req.params.historiaId,
    req.user
  );

  res.status(200).json({ tareas });
});
