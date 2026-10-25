import { hashearPassword } from '../../utils/hash.js';
import { esPasswordFuerte } from '../../utils/validar.js';
import crypto from 'crypto';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enviarCorreo } from '../../utils/correo.js';

/**
 * @file usuarios.service.js
 * @description Lógica de negocio para la gestión de usuarios y recuperación de contraseñas.
 * @author Citlaly Morales Viveros
 */

/**
 * Genera un token de recuperación y lo envía por correo.
 *
 * @param {string} correo - Correo del usuario que solicita la recuperación.
 * @returns {Promise<void>}
 */
export const solicitarRecuperacion = async (correo) => {
    const { rows } = await consulta('SELECT id, nombre FROM usuarios WHERE correo = $1', [correo.toLowerCase()]);
    const usuario = rows[0];

    if (!usuario) {
        return;
    }

    const tokenPlano = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');

    await consulta(
        `INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en) 
        VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'))`,
        [usuario.id, tokenHash, env.RECUPERACION_MINUTOS]
    );

    const enlace = `${env.APP_URL}/pages/restablecer-password.html?token=${tokenPlano}`;
    
    await enviarCorreo({
        para: correo,
        asunto: 'Recuperación de contraseña',
        texto: `Hola ${usuario.nombre},\n\nPara restablecer tu contraseña, visita este enlace: ${enlace}\n\nEste enlace expirará en ${env.RECUPERACION_MINUTOS} minutos.`
    });
};

/**
 * Valida el token y actualiza la contraseña del usuario.
 *
 * @param {string} tokenPlano - El token recibido en la URL.
 * @param {string} nuevaPassword - La nueva contraseña a establecer.
 * @returns {Promise<void>}
 */
export const restablecerPassword = async (tokenPlano, nuevaPassword) => {
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');

    const { rows } = await consulta(
        `SELECT id, usuario_id FROM tokens_recuperacion 
        WHERE token_hash = $1 AND usado = FALSE AND expira_en > NOW()`,
        [tokenHash]
    );
    const registroToken = rows[0];

    if (!registroToken) {
        throw new ErrorApp('El enlace de recuperación es inválido o ha expirado.', 400);
    }
    if (!esPasswordFuerte(nuevaPassword)) {
        throw new ErrorApp('La contraseña no cumple los requisitos de seguridad.', 400);
    }
    const passwordHash = await hashearPassword(nuevaPassword);

    await consulta('UPDATE usuarios SET password_hash = $1, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $2', [passwordHash, registroToken.usuario_id]);
    await consulta('UPDATE tokens_recuperacion SET usado = TRUE WHERE id = $1', [registroToken.id]);
};