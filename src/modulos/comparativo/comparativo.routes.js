/**
 * @file comparativo.routes.js
 * @description Ruta del comparativo entre equipos (HU-2). app.js la monta en /api/comparativo.
 * El control de acceso (solo Scrum Master) está en el servicio, no en la ruta.
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { resumen } from './comparativo.controller.js';

const router = Router();

// GET /api/comparativo/resumen
router.get('/resumen', autenticar, resumen);

export default router;
