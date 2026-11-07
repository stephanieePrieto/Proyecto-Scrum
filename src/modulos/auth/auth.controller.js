import { ErrorApp } from '../../utils/ErrorApp.js';
import * as authService from './auth.service.js';
import { env } from '../../config/env.js';
import { consulta } from '../../config/db.js';
import jwt from 'jsonwebtoken';
import { cerrarSocketsDeSesion } from '../../sockets/index.js';

/**
 * @file auth.controller.js
 * @description Controladores para gestionar peticiones HTTP de autenticación.
 * 
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
 * Configura la cookie del token temporal de 2FA.
 *
 * @param {import('express').Response} res
 * @param {string} token - Token temporal de 2FA.
 */
const configurarCookieTokenTemporal = (res, token) => {
    const opciones = opcionesCookies();
    res.cookie('token2faTemporal', token, {
        ...opciones,
        maxAge: env.TOKEN_2FA_TEMPORAL_MINUTOS * 60 * 1000
    });
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
 * Borra las cookies de 2FA.
 *
 * @param {import('express').Response} res
 */
const limpiarCookieTokenTemporal = (res) => {
    res.clearCookie('token2faTemporal', opcionesCookies());
};

/**
 * Termina por completo la sesión a la que pertenecen los tokens recibidos: la cierra, revoca los
 * tokens vigentes, desconecta sus conexiones en tiempo real y limpia las cookies.
 * Los tokens se verifican por firma, así que uno falsificado no cierra nada.
 *
 * @param {import('express').Response} res
 * @param {string|undefined} accessToken - Token de acceso recibido, aunque ya haya expirado.
 * @param {string|undefined} refreshToken - Token de renovación recibido.
 * @param {string|undefined} token2faTemporal - Token temporal de 2FA (opcional).
 * @returns {Promise<void>}
 */
export const terminarSesion = async (res, accessToken, refreshToken, token2faTemporal) => {
    const sesiones = await authService.cerrarSesionPorTokens(accessToken, refreshToken);
    sesiones.forEach((sid) => cerrarSocketsDeSesion(sid));
    limpiarCookies(res);
    limpiarCookieTokenTemporal(res);
};

export const login = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;
    const { correo, password } = req.body ?? {};

    // Evita errores 500 (y entradas raras) si llegan objetos o arreglos en vez de texto
    if (typeof correo !== 'string' || typeof password !== 'string') {
        throw new ErrorApp('Correo y contraseña son obligatorios.', 400);
    }

    const resultado = await authService.autenticarUsuario(correo, password, ip, userAgent);

    if (resultado.requiere2fa) {
        // 2FA requerido - devolver token temporal
        configurarCookieTokenTemporal(res, resultado.tokenTemporal);
        res.status(202).json({
            mensaje: 'Se requiere verificación en dos pasos',
            requiere2fa: true,
            metodos: resultado.metodos2fa,
            usuario: resultado.usuario
        });
    } else {
        // 2FA no requerido o dispositivo de confianza - crear sesión completa
        configurarCookies(res, resultado.accessToken, resultado.refreshToken);
        res.status(200).json({
            mensaje: 'Inicio de sesión exitoso',
            usuario: resultado.usuario
        });
    }
};

export const logout = async (req, res) => {
    const cookies = leerCookies(req);
    const bearer = req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : undefined;

    // No exige un token de acceso vigente: debe poder cerrar la sesión aunque ya haya expirado
    await terminarSesion(res, cookies.accessToken ?? bearer, cookies.refreshToken, cookies.token2faTemporal);
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

/**
 * Verifica un código de 2FA y completa el inicio de sesión.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const verificar2FA = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const { codigo, metodo } = req.body ?? {};
    const cookies = leerCookies(req);

    if (typeof codigo !== 'string' || !metodo) {
        throw new ErrorApp('Código y método son obligatorios.', 400);
    }

    // Obtener usuario del token temporal
    const tokenTemporal = cookies.token2faTemporal;
    if (!tokenTemporal) {
        throw new ErrorApp('Token temporal no proporcionado o expirado.', 401);
    }

    let usuarioId;
    try {
        usuarioId = await authService.verificarTokenTemporal2FA(tokenTemporal);
    } catch (error) {
        limpiarCookieTokenTemporal(res);
        throw error;
    }

    // Verificar código según el método
    let codigoValido = false;

    switch (metodo) {
        case 'totp':
            codigoValido = await authService.verificarCodigoTotp(usuarioId, codigo, ip);
            break;
        case 'correo':
            await authService.enviarCodigoOtpCorreo(usuarioId, ip, req.headers['user-agent']);
            throw new ErrorApp('Código enviado a tu correo electrónico. Verifica tu bandeja de entrada.', 200);
        case 'respaldo':
            {
                const resultado = await authService.verificarCodigoRespaldo(usuarioId, codigo, ip);
                codigoValido = resultado.valido;
            }
            break;
        default:
            throw new ErrorApp('Método de verificación no válido.', 400);
    }

    if (!codigoValido) {
        throw new ErrorApp('Código inválido o expirado.', 401);
    }

    // Código válido - registrar dispositivo de confianza si se solicita
    const confiarDispositivo = req.body.confiarDispositivo === true;
    if (confiarDispositivo) {
        await authService.registrarDispositivoConfianza(
            usuarioId,
            ip,
            req.headers['user-agent'] || '',
            req.body.nombreDispositivo || null
        );
    }

    // Generar tokens de sesión completos
    const sid = await authService.abrirSesion(usuarioId);
    const payload = { id: usuarioId, sid };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    // Limpiar token temporal y configurar cookies de sesión
    limpiarCookieTokenTemporal(res);
    configurarCookies(res, accessToken, refreshToken);

    // Obtener información del usuario
    const { rows } = await consulta('SELECT id, nombre, correo FROM usuarios WHERE id = $1', [usuarioId]);

    res.status(200).json({
        mensaje: 'Verificación exitosa. Inicio de sesión completado.',
        usuario: rows[0]
    });
};

/**
 * Solicita envío de código OTP por correo.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const solicitarCodigoOtp = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const cookies = leerCookies(req);

    const tokenTemporal = cookies.token2faTemporal;
    if (!tokenTemporal) {
        throw new ErrorApp('Token temporal no proporcionado o expirado.', 401);
    }

    const usuarioId = await authService.verificarTokenTemporal2FA(tokenTemporal);

    await authService.enviarCodigoOtpCorreo(usuarioId, ip, userAgent);

    res.status(200).json({
        mensaje: 'Código enviado a tu correo electrónico'
    });
};

/**
 * Verifica código OTP recibido por correo.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const verificarCodigoOtp = async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const { codigo } = req.body ?? {};
    const cookies = leerCookies(req);

    if (typeof codigo !== 'string') {
        throw new ErrorApp('Código es obligatorio.', 400);
    }

    const tokenTemporal = cookies.token2faTemporal;
    if (!tokenTemporal) {
        throw new ErrorApp('Token temporal no proporcionado o expirado.', 401);
    }

    const usuarioId = await authService.verificarTokenTemporal2FA(tokenTemporal);

    const valido = await authService.verificarCodigoOtpCorreo(usuarioId, codigo, ip);
    if (!valido) {
        throw new ErrorApp('Código inválido o expirado.', 401);
    }

    // Código válido - registrar dispositivo de confianza si se solicita
    const confiarDispositivo = req.body.confiarDispositivo === true;
    if (confiarDispositivo) {
        await authService.registrarDispositivoConfianza(
            usuarioId,
            ip,
            req.headers['user-agent'] || '',
            req.body.nombreDispositivo || null
        );
    }

    // Generar tokens de sesión completos
    const sid = await authService.abrirSesion(usuarioId);
    const payload = { id: usuarioId, sid };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    // Limpiar token temporal y configurar cookies de sesión
    limpiarCookieTokenTemporal(res);
    configurarCookies(res, accessToken, refreshToken);

    // Obtener información del usuario
    const { rows } = await consulta('SELECT id, nombre, correo FROM usuarios WHERE id = $1', [usuarioId]);

    res.status(200).json({
        mensaje: 'Verificación exitosa. Inicio de sesión completado.',
        usuario: rows[0]
    });
};