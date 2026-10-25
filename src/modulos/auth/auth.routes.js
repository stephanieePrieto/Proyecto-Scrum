import { Router } from 'express';
import { login, logout, renovarToken } from './auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { autenticar } from '../../middlewares/autenticar.js';

/**
 * @file auth.routes.js
 * @description Definición de rutas para autenticación y gestión de sesiones.
 * @author Citlaly Morales Viveros
 */
const router = Router();

router.post('/login', asyncHandler(login));
router.post('/logout', autenticar, asyncHandler(logout));
router.post('/refresh', asyncHandler(renovarToken));

export default router;