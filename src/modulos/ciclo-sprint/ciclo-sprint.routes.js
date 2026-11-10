// Responsable: Diego - HU-09: endpoints de iniciar y cerrar sprint
/**
 * Rutas del ciclo del sprint. app.js (BASE) monta este módulo solo, en /api/ciclo-sprint.
 *
 * Toda la pantalla del ciclo es solo del Scrum Master (permiso sprint.gestionar).
 *
 *   GET  /api/ciclo-sprint/proyecto/:proyectoId   sprint activo y planificados, con lo que falta para iniciar
 *   GET  /api/ciclo-sprint/sprint/:id/resumen     resumen de cierre (historias, velocity, tarjetas en revisión)
 *   POST /api/ciclo-sprint/sprint/:id/iniciar     iniciar (solo Scrum Master)
 *   POST /api/ciclo-sprint/sprint/:id/cerrar      cerrar (solo Scrum Master)
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './ciclo-sprint.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', requierePermiso('sprint.gestionar'), controller.obtener);
router.get('/sprint/:id/resumen', requierePermiso('sprint.gestionar', { recurso: 'sprints' }), controller.resumen);
router.post('/sprint/:id/iniciar', requierePermiso('sprint.gestionar', { recurso: 'sprints' }), controller.iniciar);
router.post('/sprint/:id/cerrar', requierePermiso('sprint.gestionar', { recurso: 'sprints' }), controller.cerrar);

export default router;
