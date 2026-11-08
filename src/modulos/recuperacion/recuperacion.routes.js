/**
 * @file recuperacion.routes.js
 * @description Definición de rutas para el flujo de recuperación de cuenta (2FA).
 * @author Citlaly Morales Viveros
 */

import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as recuperacionController from './recuperacion.controller.js';

const router = Router();

// Rutas utilizadas exclusivamente en el flujo de Login
router.get('/estado', asyncHandler(recuperacionController.estado));
router.post('/solicitar', asyncHandler(recuperacionController.solicitar));
router.post('/reenviar-aviso', asyncHandler(recuperacionController.reenviarAviso));
router.post('/enviar-enlace', asyncHandler(recuperacionController.enviarEnlace));
router.post('/confirmar', asyncHandler(recuperacionController.confirmar));
router.post('/cancelar', asyncHandler(recuperacionController.cancelar));

export default router;