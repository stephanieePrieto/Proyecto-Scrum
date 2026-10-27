import { Router } from 'express';
import { login, logout, renovarToken, latido } from './auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { autenticar } from '../../middlewares/autenticar.js';

/**
 * @file auth.routes.js
 * @description Definición de rutas para autenticación y gestión de sesiones.
 * @author Citlaly Morales Viveros
 */
const router = Router();

router.post('/login', asyncHandler(login));
// Cerrar sesión no exige autenticar: el token de acceso puede haber expirado y los tokens se verifican por firma
router.post('/logout', asyncHandler(logout));
router.post('/refresh', asyncHandler(renovarToken));
router.post('/actividad', autenticar, asyncHandler(latido));

export default router;