/**
 * @file usuarios.controller.js
 * @description Controladores para la gestión de usuarios, incluyendo la recuperación de contraseñas.
 * 
 * @author Citlaly Morales Viveros
 */

import * as usuariosService from './usuarios.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { cerrarSocketsDeSesion } from '../../sockets/index.js';
import { leerCookies, terminarSesion } from '../auth/auth.controller.js';

/**
 * Procesa la solicitud de recuperación de contraseña.
 * Retorna siempre un mensaje genérico para evitar la enumeración de correos válidos.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const solicitarRecuperacion = async (req, res) => {
    const { correo } = req.body;

    if (correo) {
        await usuariosService.solicitarRecuperacion(correo);
    }

    res.status(200).json({
        mensaje: 'Si el correo está registrado, se enviará un enlace de recuperación.'
    });
};

/**
 * Procesa el restablecimiento de contraseña utilizando un token válido.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const restablecerPassword = async (req, res) => {
    const { token, nuevaPassword } = req.body;

    await usuariosService.restablecerPassword(token, nuevaPassword);

    res.status(200).json({
        mensaje: 'Contraseña actualizada correctamente.'
    });
};

/**
 * Controlador para definir contraseña (alta directa).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const definirPasswordController = async (req, res) => {
    const { token, password, aceptoAviso, versionAviso } = req.body;

    if (typeof token !== 'string' || typeof password !== 'string') {
        throw new ErrorApp('Token y contraseña son obligatorios.', 400);
    }

    if (aceptoAviso !== true) {
        throw new ErrorApp('Debes aceptar el aviso de privacidad para definir tu contraseña.', 400);
    }

    await usuariosService.definirPassword(token, password, versionAviso);
    res.status(200).json({ mensaje: 'Contraseña definida correctamente.' });
};

/**
 * Responde con los datos del perfil de la persona que tiene la sesión iniciada.
 * Solo lee la cuenta del token, nunca un identificador enviado por el cliente.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const obtenerPerfil = async (req, res) => {
    const usuario = await usuariosService.obtenerPerfil(req.user.id);

    res.status(200).json({ usuario });
};

/**
 * Guarda la foto de perfil de la persona con la sesión iniciada.
 * Solo modifica la cuenta del token, nunca un identificador enviado por el cliente.
 *
 * @param {import('express').Request} req - Lleva la foto en req.file (campo "foto").
 * @param {import('express').Response} res
 */
export const actualizarFoto = async (req, res) => {
    const usuario = await usuariosService.actualizarFoto(req.user.id, req.file);

    res.status(200).json({ mensaje: 'Foto de perfil actualizada correctamente.', usuario });
};

/**
 * Entrega el archivo de una foto de perfil a las personas con sesión iniciada.
 * El tipo de contenido sale de la extensión guardada y se impide que el navegador lo reinterprete.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const obtenerFoto = async (req, res) => {
    const archivo = usuariosService.validarNombreFoto(req.params.archivo);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(archivo, { root: usuariosService.CARPETA_AVATARES, dotfiles: 'deny' }, (error) => {
        if (error && !res.headersSent) {
            res.status(404).json({ mensaje: 'La foto ya no está disponible.' });
        }
    });
};

/**
 * Elimina la cuenta de la persona con sesión iniciada y cierra todas sus sesiones. Antes de responder,
 * desconecta los sockets de cada sesión y limpia las cookies de la sesión actual.
 *
 * @param {import('express').Request} req - Lleva la frase y la contraseña en req.body.
 * @param {import('express').Response} res
 */
export const eliminarCuentaController = async (req, res) => {
    const { sids } = await usuariosService.eliminarCuenta(req.user.id, req.body ?? {});

    sids.forEach((sid) => cerrarSocketsDeSesion(sid));
    const cookies = leerCookies(req);
    await terminarSesion(res, cookies.accessToken, cookies.refreshToken, cookies.token2faTemporal);

    res.status(200).json({ mensaje: 'Tu cuenta fue eliminada. Tus datos personales se borraron y tu historial quedó anonimizado.' });
};

/**
 * Lista los proyectos en los que la persona es Scrum Master o Product Owner y debe
 * transferir su rol antes de eliminar su cuenta. Solo consulta la cuenta del token.
 *
 * @param {import('express').Request} req - Sesión de la persona que consulta.
 * @param {import('express').Response} res
 */
export const obtenerRolesPorTransferir = async (req, res) => {
    const proyectos = await usuariosService.rolesPorTransferir(req.user.id);
    res.status(200).json({ proyectos });
};

/**
 * Guarda la zona horaria de la persona con la sesión iniciada.
 * Solo modifica la cuenta del token, nunca un identificador enviado por el cliente.
 *
 * @param {import('express').Request} req - Lleva la zona en req.body.zonaHoraria.
 * @param {import('express').Response} res
 */
export const actualizarZonaHoraria = async (req, res) => {
    const usuario = await usuariosService.actualizarZonaHoraria(req.user.id, req.body?.zonaHoraria);

    res.status(200).json({ mensaje: 'Zona horaria actualizada correctamente.', usuario });
};

/**
 * Guarda las preferencias de notificación de la persona con la sesión iniciada.
 * Solo modifica la cuenta del token, nunca un identificador enviado por el cliente.
 *
 * @param {import('express').Request} req - Lleva la matriz en req.body.
 * @param {import('express').Response} res
 */
export const actualizarPreferenciasNotificacion = async (req, res) => {
    const usuario = await usuariosService.actualizarPreferenciasNotificacion(req.user.id, req.body);

    res.status(200).json({ mensaje: 'Preferencias de notificación actualizadas correctamente.', usuario });
};

/**
 * Guarda las preferencias de apariencia y accesibilidad de la persona con la sesión iniciada.
 * Solo modifica la cuenta del token, nunca un identificador enviado por el cliente.
 *
 * @param {import('express').Request} req - Lleva las preferencias en req.body.
 * @param {import('express').Response} res
 */
export const actualizarPreferenciasApp = async (req, res) => {
    const usuario = await usuariosService.actualizarPreferenciasApp(req.user.id, req.body);

    res.status(200).json({ mensaje: 'Preferencias de apariencia actualizadas correctamente.', usuario });
};