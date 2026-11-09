// Responsable: Jetz - HU-06, HU-07: endpoints de crear y planificar sprints


import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { comprometerHistoria, devolverHistoriaPlanificada } from './planificacion.service.js';

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

// HU-07: operación atómica y validada en el contexto del proyecto, no del usuario global.
router.post('/proyectos/:proyectoId/:sprintId/historias/:historiaId', autenticar, async (req, res, next) => {
  try {
    const resultado = await comprometerHistoria(
      req.user, req.params.proyectoId, req.params.sprintId, req.params.historiaId, req.body);
    res.status(200).json(resultado);
  } catch (error) {
    if (error.isOperational) return res.status(error.statusCode).json({ mensaje: error.message });
    next(error);
  }
});

// HU-07: devolver al Product Backlog con confirmación, sin eliminar tareas.
router.post('/proyectos/:proyectoId/:sprintId/historias/:historiaId/devolver', autenticar, async (req, res, next) => {
  try {
    const resultado = await devolverHistoriaPlanificada(
      req.user, req.params.proyectoId, req.params.sprintId, req.params.historiaId, req.body);
    res.status(200).json(resultado);
  } catch (error) {
    if (error.isOperational) return res.status(error.statusCode).json({ mensaje: error.message });
    next(error);
  }
});

export default router;
