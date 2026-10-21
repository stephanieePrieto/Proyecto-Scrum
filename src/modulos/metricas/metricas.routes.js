/**
 * @file metricas.routes.js
 * @description Declarar las rutas del módulo de métricas y encadenar sus middlewares (HU-29 a HU-33, HU-35, HU-36).
 * @author Dana
 */

import { Router } from 'express';
import { esModoDemo } from './metricas.demo.js';
import { dashboard } from './metricas.controller.js';
import { autenticar } from '../../middlewares/autenticar.js';

/**
 * Elegir el middleware de protección de la ruta.
 * Omitir la autenticación en modo demo (aún no existe login ni base de datos).
 * Cargar middlewares/autenticar.js solo fuera del modo demo.
 */
let proteger = (req, res, next) => next();

if (!esModoDemo()) {
  proteger = autenticar;
}

const router = Router();

/**
 * Registrar GET /proyectos/:proyectoId/metricas/dashboard.
 * Ejecutar en este orden:
 *   1. proteger   → verificar sesión (se omite en modo demo).
 *   2. dashboard  → validar el parámetro, calcular y responder los KPIs.
 */
router.get('/proyectos/:proyectoId/metricas/dashboard', proteger, dashboard);

export default router;