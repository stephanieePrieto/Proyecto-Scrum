// Responsable: Citlaly - HU-39: endpoints de invitar por correo y alta directa

import { Router } from 'express';
import * as invitacionesController from './invitaciones.controller.js';
import autenticar from '../../middlewares/autenticar.js';

/**
 * @file invitaciones.routes.js
 * @description Rutas del módulo de invitaciones.
 * @author Citlaly Morales Viveros
 */
const router = Router();

// Rutas públicas (no requieren autenticación)
router.post('/aceptar', invitacionesController.aceptarInvitacion);

// Rutas privadas (requieren autenticación)
router.use(autenticar);

// Invitaciones de un equipo
router.post('/equipos/:equipoId/invitaciones', invitacionesController.crearInvitacion);
router.get('/equipos/:equipoId/invitaciones', invitacionesController.listarInvitaciones);
router.post('/invitaciones/:id/reenviar', invitacionesController.reenviarInvitacion);
router.delete('/invitaciones/:id', invitacionesController.cancelarInvitacion);

// Agregar usuario existente al equipo (para correo ya registrado)
router.post('/equipos/:equipoId/usuarios/existente', invitacionesController.agregarUsuarioExistente);

export default router;