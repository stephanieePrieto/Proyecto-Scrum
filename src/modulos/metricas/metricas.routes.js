/**
 * @file metricas.routes.js
 * @description Declarar las rutas del módulo de métricas y encadenar sus middlewares
 * app.js monta este router automáticamente en /api/metricas (el prefijo es el nombre de la carpeta),
 * por eso las rutas de aquí no repiten "metricas".
 * @author Dana
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { misProyectos, dashboard, velocity, avance } from './metricas.controller.js';

const router = Router();

/**
 * Registrar las rutas.
 *   1. autenticar: verificar la sesión y llenar req.user.
 *   2. controlador: validar el proyecto, comprobar que el usuario pertenezca a él y responder.
 */
// Proyectos del usuario: GET /api/metricas/mis-proyectos
router.get('/mis-proyectos', autenticar, misProyectos);

// HU-35: GET /api/metricas/proyectos/:proyectoId/dashboard
router.get('/proyectos/:proyectoId/dashboard', autenticar, dashboard);

// HU-30: GET /api/metricas/proyectos/:proyectoId/velocity
router.get('/proyectos/:proyectoId/velocity', autenticar, velocity);

// HU-31: GET /api/metricas/proyectos/:proyectoId/avance?sprintId=N
router.get('/proyectos/:proyectoId/avance', autenticar, avance);

export default router;