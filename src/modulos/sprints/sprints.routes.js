// Responsable: Jetz - HU-06, HU-07: endpoints de crear y planificar sprints


import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';

// Importar las funciones del controlador
import {
  listarSprints,
  crearSprint
} from './sprints.controller.js';

const router = Router();

// Consultar los sprints de un proyecto

// Solo usuarios autenticados pueden acceder
router.get('/proyectos/:proyectoId', autenticar, listarSprints);

// Proteger la creación de sprints
router.post('/', autenticar, crearSprint);

export default router;
