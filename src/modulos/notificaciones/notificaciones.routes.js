/**
 * @file notificaciones.routes.js
 * @description Declarar y registrar las rutas del módulo de notificaciones.
 */

import { Router } from 'express';
import controlador from './notificaciones.controller.js';

const router = Router();

// Middleware temporal para pruebas de HU-24.
// Simula al usuario autenticado con ID 1.
router.use((req, res, next) => {
  req.usuario = { id: 1 };
  next();
});

// Obtener historial de notificaciones
router.get('/', controlador.obtenerHistorial);

// Marcar notificación como leída
router.patch('/:id/leida', controlador.marcarLeida);

export default router;