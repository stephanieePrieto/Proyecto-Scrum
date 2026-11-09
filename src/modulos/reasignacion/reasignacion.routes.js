// Responsable: Alfonso - HU-21: endpoint para reasignar una tarea al arrastrarla al carril de otra persona
/**
 * @file reasignacion.routes.js
 * @description Ruta de la HU-21, montada en /api/reasignacion (app.js carga la carpeta del módulo).
 *              Pasa por:
 *   1. autenticar: sesión válida.
 *   2. requierePermiso('tarea.gestionar'): el proyecto se obtiene de la tarea; cualquier integrante con rol
 *      en el proyecto (Scrum Master, Product Owner o Developer) puede reasignar. 404 neutro sin vínculo.
 *   La protección CSRF ya se aplica a toda la API en app.js.
 *
 *   POST /api/reasignacion/tarea/:tareaId   { responsable_id, responsable_anterior_id? }
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controlador from './reasignacion.controller.js';

const router = Router();

router.post(
  '/tarea/:tareaId',
  autenticar,
  requierePermiso('tarea.gestionar', { recurso: 'tareas', parametroRecurso: 'tareaId' }),
  controlador.reasignar,
);

export default router;
