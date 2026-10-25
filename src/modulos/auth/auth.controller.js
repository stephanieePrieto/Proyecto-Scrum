import * as authService from './auth.service.js';
import { env } from '../../config/env.js';

/**
 * @file auth.controller.js
 * @description Controladores para gestionar peticiones HTTP de autenticación.
 * @author Citlaly Morales Viveros
 */

const configurarCookies = (res, accessToken, refreshToken) => {
    const opciones = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
    };

    res.cookie('accessToken', accessToken, { ...opciones, maxAge: env.JWT_ACCESO_MINUTOS * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...opciones, maxAge: env.JWT_RENOVACION_MINUTOS * 60 * 1000 });
};

export const login = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const { correo, password } = req.body;

    const { accessToken, refreshToken, usuario } = await authService.autenticarUsuario(correo, password, ip);

    configurarCookies(res, accessToken, refreshToken);
    res.status(200).json({ mensaje: 'Inicio de sesión exitoso', usuario });
};

export const logout = async (req, res) => {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, current) => {
            const [key, value] = current.trim().split('=');
            acc[key] = value;
            return acc;
        }, {});

        if (cookies.accessToken) {
            await authService.revocarToken(cookies.accessToken, env.JWT_ACCESO_MINUTOS);
        }
        if (cookies.refreshToken) {
            await authService.revocarToken(cookies.refreshToken, env.JWT_RENOVACION_MINUTOS);
        }
    }

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.status(200).json({ mensaje: 'Sesión cerrada correctamente' });
};

export const renovarToken = async (req, res) => {
    const cookieHeader = req.headers.cookie;
    let refreshToken;

    if (cookieHeader) {
        const cookies = cookieHeader.split(';').reduce((acc, current) => {
            const [key, value] = current.trim().split('=');
            acc[key] = value;
            return acc;
        }, {});
        refreshToken = cookies.refreshToken;
    }

    const { nuevoAccessToken, nuevoRefreshToken } = await authService.renovarSesion(refreshToken);
    configurarCookies(res, nuevoAccessToken, nuevoRefreshToken);
    res.status(200).json({ mensaje: 'Token renovado' });
};