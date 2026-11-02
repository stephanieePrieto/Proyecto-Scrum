// Responsable: Jetz - HU-08: endpoints de tareas de una historia

/**
 * Responsable: Jetz
 * HU-08: Rutas para gestionar tareas técnicas.
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';

import * as controlador from './tareas.controller.js';

const router = Router();

// HU-08: Crear una tarea técnica.
// Solo usuarios autenticados pueden acceder.
// El servicio verifica los permisos del Scrum Master.
router.post('/', autenticar, controlador.crear);

// HU-08: Consultar las tareas técnicas de una historia.
// El servicio comprueba que el usuario pertenezca al proyecto.
router.get(
  '/historia/:historiaId',
  autenticar,
  controlador.listarPorHistoria
);

/**
 * HU-08: Editar una tarea técnica existente.
 * El servicio verifica los permisos y valida los datos.
 */
router.put(
  '/:tareaId',
  autenticar,
  controlador.editar
);

/**
 * HU-08: Eliminar una tarea técnica existente.
 * El servicio verifica los permisos y las horas registradas.
 */
router.delete(
  '/:tareaId',
  autenticar,
  controlador.eliminar
);


export default router;

