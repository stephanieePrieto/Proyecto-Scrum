/**
 * @file notificaciones.routes.js
 * @description Declarar y registrar las rutas del módulo de notificaciones (HU-24).
 *              Se montan en /api/notificaciones (app.js carga la carpeta del módulo automáticamente).
 */

import { Router } from 'express';
import controlador from './notificaciones.controller.js';

const router = Router();

// Middleware temporal para pruebas de HU-24: simula al usuario autenticado.
// Usa el usuario 1 (Stephy en seed.sql). Para probar con otra persona, definir
// USUARIO_DEMO_ID en el .env (ej. USUARIO_DEMO_ID=5 para Alfonso) y reiniciar el servidor.
// Se reemplaza por el middleware `autenticar` cuando el login esté integrado.
router.use((req, res, next) => {
  req.usuario = { id: Number(process.env.USUARIO_DEMO_ID) || 1 };
  next();
});

// Obtener historial de notificaciones
router.get('/', controlador.obtenerHistorial);

// Marcar todas las notificaciones como leídas
router.patch('/leidas', controlador.marcarTodasLeidas);

// Marcar una notificación como leída
router.patch('/:id/leida', controlador.marcarLeida);

// Crear una notificación de ejemplo (solo fuera de producción)
router.post('/demo', controlador.crearDemo);

export default router;