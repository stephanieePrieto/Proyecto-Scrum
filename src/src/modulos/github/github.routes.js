/**
 * @file github.routes.js
 * @description Rutas autenticadas de integración de repositorios públicos de GitHub.
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './github.controller.js';

const router = Router();
router.use(autenticar);
router.get('/proyectos/:proyectoId', controller.obtenerActividad);

export default router;
