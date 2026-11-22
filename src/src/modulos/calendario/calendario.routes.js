/**
 * @file calendario.routes.js
 * @description Rutas del calendario. app.js (BASE) monta este módulo solo, en /api/calendario.
 *
 *   GET /api/calendario/proyecto/:proyectoId   eventos del sprint activo (y conflictos por ausencias)
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './calendario.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', requierePermiso('proyecto.ver'), controller.obtener);

export default router;
