// Responsable: Alfonso - HU-28: endpoints de desviacion de horas
/**
 * @file desviacion.routes.js
 * @description Rutas de la HU-28, montadas en /api/desviacion (app.js carga la carpeta del módulo).
 *              Todas son de lectura y pasan por:
 *   1. autenticar: sesión válida.
 *   2. requierePermiso('proyecto.ver'): 404 neutro si la persona no tiene vínculo con el proyecto (RF-43).
 *   3. exigirRol: 403 si su rol no está en ROLES_PERMITIDOS (desviacion.service.js; por defecto solo Scrum Master).
 *
 *   GET /api/desviacion/proyectos/:proyectoId/sprints                     sprints y el sugerido
 *   GET /api/desviacion/proyectos/:proyectoId/sprints/:sprintId           resumen del sprint
 *   GET /api/desviacion/proyectos/:proyectoId/sprints/:sprintId/tareas    por tarea
 *   GET /api/desviacion/proyectos/:proyectoId/sprints/:sprintId/historias por historia
 *   GET /api/desviacion/proyectos/:proyectoId/sprints/:sprintId/personas  por persona
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controlador from './desviacion.controller.js';

const router = Router();

const acceso = [autenticar, requierePermiso('proyecto.ver'), controlador.exigirRol];

router.get('/proyectos/:proyectoId/sprints', acceso, controlador.sprints);
router.get('/proyectos/:proyectoId/sprints/:sprintId', acceso, controlador.resumen);
router.get('/proyectos/:proyectoId/sprints/:sprintId/:nivel', acceso, controlador.porNivel);

export default router;
