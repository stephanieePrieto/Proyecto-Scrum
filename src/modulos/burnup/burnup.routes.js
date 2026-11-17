/**
 * @file burnup.routes.js
 * @description Rutas de la HU-1 (Burnup y CFD). app.js monta este router automáticamente en /api/burnup,
 * porque el prefijo es el nombre de la carpeta. Por eso aquí no se repite "burnup".
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { burnup, cfd } from './burnup.controller.js';

const router = Router();

// GET /api/burnup/proyectos/:proyectoId/burnup
router.get('/proyectos/:proyectoId/burnup', autenticar, burnup);

// GET /api/burnup/proyectos/:proyectoId/cfd
router.get('/proyectos/:proyectoId/cfd', autenticar, cfd);

export default router;
