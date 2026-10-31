/**
 * @file notificaciones.routes.js
 * @description Declarar y registrar las rutas del módulo de notificaciones (HU-24).
 *              Se montan en /api/notificaciones (app.js carga la carpeta del módulo automáticamente).
 *              Todas exigen sesión iniciada: cada persona solo ve y marca sus propias notificaciones.
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import controlador from './notificaciones.controller.js';

const router = Router();

// Exigir sesión válida; deja el usuario en req.user
router.use(autenticar);

// Obtener historial de notificaciones
router.get('/', controlador.obtenerHistorial);

// Marcar todas las notificaciones como leídas
router.patch('/leidas', controlador.marcarTodasLeidas);

// Marcar una notificación como leída
router.patch('/:id/leida', controlador.marcarLeida);

export default router;