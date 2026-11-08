import { Router } from 'express';
import { solicitarRecuperacion, restablecerPassword, definirPasswordController } from './usuarios.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { autenticar } from '../../middlewares/autenticar.js';
import * as authService from '../auth/auth.service.js';
import { verificarPassword } from '../../utils/hash.js';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * @file usuarios.routes.js
 * @description Definición de rutas públicas y protegidas para la gestión de usuarios.
 * 
 * @author Citlaly Morales Viveros
 */
const router = Router();

router.post('/recuperar-password', asyncHandler(solicitarRecuperacion));
router.post('/restablecer-password', asyncHandler(restablecerPassword));
router.post('/definir-password', asyncHandler(definirPasswordController));

/**
 * Obtiene el estado de 2FA del usuario.
 */
router.get('/2fa/estado', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const config = await authService.obtenerConfiguracion2FA(usuarioId);
    const infoRespaldo = await authService.obtenerInfoCodigosRespaldo(usuarioId);
    const dispositivos = await authService.listarDispositivosConfianza(usuarioId);

    res.json({
        habilitado: config.habilitado,
        metodos: {
            totp: {
                activado: config.totpActivado,
                activadoEn: config.totpActivadoEn
            },
            correo: {
                activado: config.correoActivado,
                activadoEn: config.correoActivadoEn
            }
        },
        codigosRespaldo: infoRespaldo,
        dispositivosConfianza: dispositivos.length
    });
}));

/**
 * Inicia la configuración de TOTP.
 */
router.post('/2fa/totp/iniciar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { secreto, uri, qrDataUrl } = await authService.iniciarConfiguracionTotp(usuarioId);


    // Generar URI para código QR
    res.json({ secreto, uri, qrDataUrl });
}));

/**
 * Confirma la configuración de TOTP.
 */
router.post('/2fa/totp/confirmar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { codigo } = req.body;

    if (typeof codigo !== 'string') {
        throw new ErrorApp('Código es obligatorio.', 400);
    }

    const resultado = await authService.confirmarConfiguracionTotp(usuarioId, codigo);
    res.json(resultado);
}));

/**
 * Desactiva TOTP.
 */
router.post('/2fa/totp/desactivar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { password } = req.body;

    if (typeof password !== 'string') {
        throw new ErrorApp('Contraseña es obligatoria.', 400);
    }

    const resultado = await authService.desactivarTotp(usuarioId, password);
    res.json(resultado);
}));

/**
 * Activa 2FA por correo.
 */
router.post('/2fa/correo/activar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const resultado = await authService.configurar2FAPorCorreo(usuarioId, true, null, ip, userAgent);
    res.json(resultado);
}));

/**
 * Confirma la activación del correo con el código recibido.
 */
router.post('/2fa/correo/confirmar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const ip = req.ip || req.connection.remoteAddress;
    const { codigo } = req.body;

    if (typeof codigo !== 'string' || !codigo.trim()) {
        throw new ErrorApp('Código es obligatorio.', 400);
    }

    const resultado = await authService.confirmarActivacionCorreo(usuarioId, codigo, ip);
    res.json(resultado);
}));

/**
 * Desactiva 2FA por correo.
 */
router.post('/2fa/correo/desactivar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { password } = req.body;

    if (typeof password !== 'string') {
        throw new ErrorApp('Contraseña es obligatoria.', 400);
    }

    const resultado = await authService.configurar2FAPorCorreo(usuarioId, false, password);
    res.json(resultado);
}));

/**
 * Habilita o deshabilita 2FA globalmente.
 */
router.post('/2fa/habilitar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { password } = req.body;

    if (typeof password !== 'string') {
        throw new ErrorApp('Contraseña es obligatoria para habilitar/deshabilitar 2FA.', 400);
    }

    const resultado = await authService.configurar2FAHabilitado(usuarioId, true, password);
    res.json(resultado);
}));

router.post('/2fa/deshabilitar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { password } = req.body;

    if (typeof password !== 'string') {
        throw new ErrorApp('Contraseña es obligatoria para deshabilitar 2FA.', 400);
    }

    const resultado = await authService.configurar2FAHabilitado(usuarioId, false, password);
    res.json(resultado);
}));

/**
 * Genera códigos de respaldo.
 */
router.post('/2fa/respaldo/generar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { codigos, grupoId } = await authService.generarCodigosRespaldo(usuarioId);

    res.json({
        mensaje: 'Códigos de respaldo generados correctamente',
        codigos,
        grupoId
    });
}));

/**
 * Obtiene información sobre códigos de respaldo.
 */
router.get('/2fa/respaldo', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const info = await authService.obtenerInfoCodigosRespaldo(usuarioId);
    res.json(info);
}));

/**
 * Lista dispositivos de confianza.
 */
router.get('/2fa/dispositivos', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const dispositivos = await authService.listarDispositivosConfianza(usuarioId);
    res.json({ dispositivos });
}));

/**
 * Registra el dispositivo actual como de confianza.
 */
router.post('/2fa/dispositivos/confiar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const { nombre } = req.body;

    const { tokenConfianza, expiraEn } = await authService.registrarDispositivoConfianza(
        usuarioId, ip, userAgent, nombre || null
    );

    // Devolver token como cookie
    res.cookie('tokenConfianza', tokenConfianza, {
        httpOnly: true,
        secure: env.ES_PRODUCCION || env.HTTPS_ACTIVO,
        sameSite: 'strict',
        expires: expiraEn
    });

    res.json({
        mensaje: 'Dispositivo registrado como de confianza',
        expiraEn
    });
}));

/**
 * Revoca un dispositivo de confianza.
 */
router.post('/2fa/dispositivos/revocar', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { dispositivoId } = req.body;

    if (typeof dispositivoId !== 'string') {
        throw new ErrorApp('ID del dispositivo es obligatorio.', 400);
    }

    await authService.revocarDispositivoConfianza(usuarioId, dispositivoId);
    res.json({ mensaje: 'Dispositivo revocado correctamente' });
}));

/**
 * Revoca todos los dispositivos de confianza.
 */
router.post('/2fa/dispositivos/revocar-todos', autenticar, asyncHandler(async (req, res) => {
    const usuarioId = req.user.id;
    const { password } = req.body;

    if (typeof password !== 'string') {
        throw new ErrorApp('Contraseña es obligatoria.', 400);
    }

    // Verificar contraseña
    const { rows } = await consulta(
        'SELECT password_hash FROM usuarios WHERE id = $1',
        [usuarioId]
    );

    const claveValida = await verificarPassword(password, rows[0].password_hash);
    if (!claveValida) {
        throw new ErrorApp('Contraseña incorrecta.', 401);
    }

    const resultado = await authService.revocarTodosDispositivosConfianza(usuarioId);
    res.json(resultado);
}));

export default router;