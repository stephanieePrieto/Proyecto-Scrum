/**
 * @file invitaciones.routes.js
 * @description Rutas del módulo de invitaciones. 
 * @author Citlaly Morales Viveros
 */
import { Router } from 'express';
import * as invitacionesController from './invitaciones.controller.js';
import autenticar from '../../middlewares/autenticar.js';

const router = Router();

// Rutas públicas (no requieren autenticación HTTP estricta previa, la lógica se maneja en el servicio)
router.post('/aceptar', invitacionesController.aceptarInvitacion);
router.post('/rechazar', invitacionesController.rechazarInvitacion);

// Rutas privadas (requieren autenticación)
router.use(autenticar);

// Invitaciones y altas de un equipo
router.post('/equipos/:equipoId/invitaciones', invitacionesController.crearInvitacion);
router.post('/equipos/:equipoId/alta-directa', invitacionesController.altaDirecta);
router.get('/equipos/:equipoId/invitaciones', invitacionesController.listarInvitaciones);
router.post('/invitaciones/:id/reenviar', invitacionesController.reenviarInvitacion);
router.delete('/invitaciones/:id', invitacionesController.cancelarInvitacion);

// Agregar usuario existente al equipo (para correo ya registrado)
router.post('/equipos/:equipoId/usuarios/existente', invitacionesController.agregarUsuarioExistente);

export default router;