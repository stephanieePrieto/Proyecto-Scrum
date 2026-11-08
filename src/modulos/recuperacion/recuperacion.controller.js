/**
 * @file recuperacion.controller.js
 * @description Controladores para el flujo de recuperación de cuenta (Problema 10).
 * @author Citlaly Morales Viveros
 */

import { ErrorApp } from '../../utils/ErrorApp.js';
import { leerCookies } from '../auth/auth.controller.js';
import { verificarTokenTemporal2FA, consumirTokenTemporal2FA } from '../auth/auth.service.js';
import * as recuperacionService from './recuperacion.service.js';

/**
 * Obtiene y valida el token temporal 2FA de las cookies.
 */
const obtenerUsuarioIdDesdeToken = async (req) => {
    const token = leerCookies(req).token2faTemporal;
    if (!token) throw new ErrorApp('Token temporal expirado o no encontrado. Inicia sesión de nuevo.', 401);
    return { usuarioId: await verificarTokenTemporal2FA(token), token };
};

export const estado = async (req, res) => {
    const cookies = leerCookies(req);
    if (!cookies.token2faTemporal) return res.json(null);

    const usuarioId = await verificarTokenTemporal2FA(cookies.token2faTemporal);
    const estadoRecuperacion = await recuperacionService.obtenerEstado(usuarioId);
    res.json(estadoRecuperacion);
};

export const solicitar = async (req, res) => {
    const { usuarioId, token } = await obtenerUsuarioIdDesdeToken(req);
    await recuperacionService.iniciarSolicitud(usuarioId);
    await consumirTokenTemporal2FA(token);
    res.json({ mensaje: 'Solicitud registrada. Revisa tu bandeja de entrada en unos minutos.' });
};

export const reenviarAviso = async (req, res) => {
    const { usuarioId, token } = await obtenerUsuarioIdDesdeToken(req);
    await recuperacionService.reenviarAviso(usuarioId);
    await consumirTokenTemporal2FA(token);
    res.json({ mensaje: 'Se ha reenviado el correo de aviso.' });
};

export const enviarEnlace = async (req, res) => {
    const { usuarioId, token } = await obtenerUsuarioIdDesdeToken(req);
    await recuperacionService.enviarEnlace(usuarioId);
    await consumirTokenTemporal2FA(token);
    res.json({ mensaje: 'Se ha enviado el enlace de confirmación a tu correo.' });
};

export const confirmar = async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
        throw new ErrorApp('Token de confirmación ausente o inválido.', 400);
    }
    await recuperacionService.confirmarRecuperacion(token);
    res.json({ mensaje: 'Cuenta recuperada exitosamente. Se ha deshabilitado el 2FA y cerrado otras sesiones.' });
};

export const cancelar = async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
        throw new ErrorApp('Token de cancelación ausente o inválido.', 400);
    }
    await recuperacionService.cancelarRecuperacion(token, null);
    res.json({ mensaje: 'La solicitud de recuperación fue cancelada exitosamente.' });
};