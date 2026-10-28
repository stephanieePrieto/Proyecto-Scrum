import * as usuariosService from './usuarios.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * @file usuarios.controller.js
 * @description Controladores para la gestión de usuarios, incluyendo la recuperación de contraseñas.
 * @author Citlaly Morales Viveros
 */

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
    const { token, password } = req.body;

    if (typeof token !== 'string' || typeof password !== 'string') {
        throw new ErrorApp('Token y contraseña son obligatorios.', 400);
    }

    await usuariosService.definirPassword(token, password);
    res.status(200).json({ mensaje: 'Contraseña definida correctamente.' });
};