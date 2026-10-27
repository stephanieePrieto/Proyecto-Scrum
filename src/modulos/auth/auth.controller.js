import { ErrorApp } from '../../utils/ErrorApp.js';
import * as authService from './auth.service.js';
import { env } from '../../config/env.js';
import { cerrarSocketsDeSesion } from '../../sockets/index.js';

/**
 * @file auth.controller.js
 * @description Controladores para gestionar peticiones HTTP de autenticación.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

const opcionesCookies = () => ({
    httpOnly: true,
    secure: env.ES_PRODUCCION || env.HTTPS_ACTIVO,
    sameSite: 'strict',
});

const configurarCookies = (res, accessToken, refreshToken) => {
    const opciones = opcionesCookies();

    res.cookie('accessToken', accessToken, { ...opciones, maxAge: env.JWT_ACCESO_MINUTOS * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...opciones, maxAge: env.JWT_RENOVACION_MINUTOS * 60 * 1000 });
};

/**
 * Lee las cookies de la petición como un objeto nombre -> valor.
 *
 * @param {import('express').Request} req
 * @returns {Object<string, string>}
 */
export const leerCookies = (req) => {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return {};

    return cookieHeader.split(';').reduce((acc, current) => {
        const [key, value] = current.trim().split('=');
        acc[key] = value;
        return acc;
    }, {});
};

/**
 * Borra las cookies de sesión con las mismas opciones con las que se crearon.
 *
 * @param {import('express').Response} res
 */
const limpiarCookies = (res) => {
    res.clearCookie('accessToken', opcionesCookies());
    res.clearCookie('refreshToken', opcionesCookies());
};

/**
 * Termina por completo la sesión a la que pertenecen los tokens recibidos: la cierra, revoca los
 * tokens vigentes, desconecta sus conexiones en tiempo real y limpia las cookies.
 * Los tokens se verifican por firma, así que uno falsificado no cierra nada.
 *
 * @param {import('express').Response} res
 * @param {string|undefined} accessToken - Token de acceso recibido, aunque ya haya expirado.
 * @param {string|undefined} refreshToken - Token de renovación recibido.
 * @returns {Promise<void>}
 */
export const terminarSesion = async (res, accessToken, refreshToken) => {
    const sesiones = await authService.cerrarSesionPorTokens(accessToken, refreshToken);
    sesiones.forEach((sid) => cerrarSocketsDeSesion(sid));
    limpiarCookies(res);
};

export const login = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const { correo, password } = req.body ?? {};

    // Evita errores 500 (y entradas raras) si llegan objetos o arreglos en vez de texto
    if (typeof correo !== 'string' || typeof password !== 'string') {
        throw new ErrorApp('Correo y contraseña son obligatorios.', 400);
    }

    const { accessToken, refreshToken, usuario } = await authService.autenticarUsuario(correo, password, ip);

    configurarCookies(res, accessToken, refreshToken);
    res.status(200).json({ mensaje: 'Inicio de sesión exitoso', usuario });
};

export const logout = async (req, res) => {
    const cookies = leerCookies(req);
    const bearer = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : undefined;

    // No exige un token de acceso vigente: debe poder cerrar la sesión aunque ya haya expirado
    await terminarSesion(res, cookies.accessToken ?? bearer, cookies.refreshToken);
    res.status(200).json({ mensaje: 'Sesión cerrada correctamente' });
};

export const renovarToken = async (req, res) => {
    const cookies = leerCookies(req);

    let tokens;
    try {
        tokens = await authService.renovarSesion(cookies.refreshToken);
    } catch (error) {
        // Si la sesión terminó (inactividad o cierre), se revocan los tokens y se limpian las cookies
        if (error.detalles?.codigo?.startsWith('SESION_')) {
            await terminarSesion(res, cookies.accessToken, cookies.refreshToken);
        }
        throw error;
    }

    configurarCookies(res, tokens.nuevoAccessToken, tokens.nuevoRefreshToken);
    res.status(200).json({ mensaje: 'Token renovado' });
};

/**
 * Confirma que la sesión sigue vigente. El control de inactividad ocurre en el middleware
 * autenticar, que es quien registra la actividad según la cabecera X-Interaccion-Segundos.
 */
export const latido = (req, res) => {
    res.status(204).end();
};

export const register = async (req, res) => {
    const { nombre, correo, password } = req.body ?? {};

    if (typeof nombre !== 'string' || typeof correo !== 'string' || typeof password !== 'string' ||
        !nombre.trim() || !correo.trim() || !password.trim()) {
        throw new ErrorApp('Nombre, correo y contraseña son obligatorios y deben ser válidos.', 400);
    }

    const nuevoUsuario = await authService.registrarUsuario(nombre, correo, password);

    res.status(201).json({
        mensaje: 'Cuenta creada exitosamente. Ahora puedes iniciar sesión.',
        usuario: nuevoUsuario
    });
};