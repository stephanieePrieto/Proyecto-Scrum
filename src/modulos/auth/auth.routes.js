import { Router } from 'express';
import { login, logout, renovarToken, latido, register, verificar2FA, solicitarCodigoOtp, verificarCodigoOtp } from './auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { autenticar } from '../../middlewares/autenticar.js';

/**
 * @file auth.routes.js
 * @description Definición de rutas para autenticación y gestión de sesiones.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */
const router = Router();

router.post('/login', asyncHandler(login));
router.post('/register', asyncHandler(register));
// Cerrar sesión no exige autenticar: el token de acceso puede haber expirado y los tokens se verifican por firma
router.post('/logout', asyncHandler(logout));
router.post('/refresh', asyncHandler(renovarToken));
router.post('/actividad', autenticar, asyncHandler(latido));

router.get('/latido', autenticar, latido);

// Verificar código de 2FA (TOTP, correo o respaldo) - requiere token temporal
router.post('/2fa/verificar', asyncHandler(verificar2FA));

// Solicitar código OTP por correo - requiere token temporal
router.post('/2fa/solicitar-correo', asyncHandler(solicitarCodigoOtp));

// Verificar código OTP por correo - requiere token temporal
router.post('/2fa/verificar-correo', asyncHandler(verificarCodigoOtp));

// Rutas protegidas para configuración de 2FA (requieren autenticación)
// estas rutas estarán en un archivo separado o en usuarios.routes.js
// para mantener el principio de responsabilidad única

export default router;