/**
 * @file calendario.routes.js
 * @description Rutas del calendario. app.js (BASE) monta este módulo solo, en /api/calendario.
 *
 *   GET    /api/calendario/proyecto/:proyectoId             eventos del sprint activo (y conflictos por ausencias)
 *   GET    /api/calendario/proyecto/:proyectoId/reuniones   reuniones Scrum del proyecto (todos los roles)
 *   POST   /api/calendario/proyecto/:proyectoId/reuniones   crear una reunión (solo Scrum Master)
 *   PUT    /api/calendario/reuniones/:id                    editar una reunión (solo Scrum Master)
 *   DELETE /api/calendario/reuniones/:id                    eliminar una reunión (solo Scrum Master)
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './calendario.controller.js';
import { proyectoDeReunion } from './calendario.service.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', requierePermiso('proyecto.ver'), controller.obtener);

// el proyecto de una reunión se obtiene de la propia reunión (requiereRol.js no conoce eventos_calendario)
const deReunion = { resolverProyecto: (req) => proyectoDeReunion(req.params.id) };
router.get('/proyecto/:proyectoId/reuniones', requierePermiso('proyecto.ver'), controller.listarReuniones);
router.post('/proyecto/:proyectoId/reuniones', requierePermiso('reunion.gestionar'), controller.crearReunion);
router.put('/reuniones/:id', requierePermiso('reunion.gestionar', deReunion), controller.actualizarReunion);
router.delete('/reuniones/:id', requierePermiso('reunion.gestionar', deReunion), controller.eliminarReunion);

export default router;
