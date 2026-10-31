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

export default router;

