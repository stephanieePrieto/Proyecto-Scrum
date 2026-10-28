import { Router } from 'express';
import { solicitarRecuperacion, restablecerPassword, definirPasswordController } from './usuarios.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * @file usuarios.routes.js
 * @description Definición de rutas públicas y protegidas para la gestión de usuarios.
 * @author Citlaly Morales Viveros
 */
const router = Router();

router.post('/recuperar-password', asyncHandler(solicitarRecuperacion));
router.post('/restablecer-password', asyncHandler(restablecerPassword));
router.post('/definir-password', asyncHandler(definirPasswordController));

export default router;