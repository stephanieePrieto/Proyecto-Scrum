/**
 * @file recuperacion.service.js
 * @description Lógica de negocio para el flujo de recuperación de cuenta cuando se pierde el 2FA.
 * @author Citlaly Morales Viveros
 */

import { randomBytes, createHash } from 'crypto';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enviarCorreo } from '../../utils/correo.js';
import { cerrarSocketsDeSesion } from '../../sockets/index.js';
import { obtenerConfiguracion2FA } from '../auth/auth.service.js';

const hashear = (texto) => createHash('sha256').update(texto).digest('hex');
const generarTokenAleatorio = () => randomBytes(32).toString('hex');

/**
 * Obtiene el estado actual de recuperación de un usuario.
 */
export const obtenerEstado = async (usuarioId) => {
    const { rows } = await consulta(
        `SELECT estado, solicitado_en, espera_hasta, enlace_expira_en, ultimo_envio_correo 
         FROM recuperacion_2fa 
         WHERE usuario_id = $1 AND estado = 'pendiente' AND expira_en > NOW()
         ORDER BY solicitado_en DESC LIMIT 1`,
        [usuarioId]
    );
    return rows[0] || null;
};

/**
 * Inicia el proceso de recuperación (Etapa 1).
 */
export const iniciarSolicitud = async (usuarioId) => {
    const config = await obtenerConfiguracion2FA(usuarioId);
    if (!config.habilitado) {
        throw new ErrorApp('El 2FA no está habilitado en esta cuenta.', 400);
    }

    // Verificar límite global (max 3 en 24h)
    const { rows: limite } = await consulta(
        `SELECT count(*) as total FROM recuperacion_2fa 
         WHERE usuario_id = $1 AND solicitado_en > NOW() - INTERVAL '24 hours'`,
        [usuarioId]
    );
    if (parseInt(limite[0].total, 10) >= 3) {
        throw new ErrorApp('Has superado el límite de solicitudes de recuperación en 24 horas.', 429);
    }

    // Verificar si ya existe una solicitud pendiente y aplicar cooldown
    const estadoActual = await obtenerEstado(usuarioId);
    if (estadoActual) {
        if (new Date(estadoActual.ultimo_envio_correo) > new Date(Date.now() - 60000)) {
            throw new ErrorApp('Debes esperar 60 segundos antes de solicitar otro correo.', 429);
        }
        throw new ErrorApp('Ya tienes una recuperación en proceso.', 400);
    }

    const tokenCancelacion = generarTokenAleatorio();

    await consulta(
        `INSERT INTO recuperacion_2fa 
        (usuario_id, token_cancelacion, espera_hasta, expira_en) 
        VALUES ($1, $2, NOW() + INTERVAL '24 hours', NOW() + INTERVAL '7 days')`,
        [usuarioId, hashear(tokenCancelacion)]
    );

    // Enviar correo de aviso inicial (sin transacción, si falla queda pendiente y se puede reenviar)
    await notificarSolicitud(usuarioId, tokenCancelacion);
};

/**
 * Reenvía el correo de la etapa 1 o 2 respetando el enfriamiento de 60s.
 */
export const reenviarAviso = async (usuarioId) => {
    const estadoActual = await obtenerEstado(usuarioId);
    if (!estadoActual) {
        throw new ErrorApp('No hay ninguna recuperación en proceso.', 400);
    }
    if (new Date(estadoActual.ultimo_envio_correo) > new Date(Date.now() - 60000)) {
        throw new ErrorApp('Debes esperar 60 segundos antes de reenviar el correo.', 429);
    }

    const nuevoTokenCancelacion = generarTokenAleatorio();
    await consulta(
        `UPDATE recuperacion_2fa SET token_cancelacion = $1, ultimo_envio_correo = NOW()
         WHERE usuario_id = $2 AND estado = 'pendiente'`,
        [hashear(nuevoTokenCancelacion), usuarioId]
    );

    await notificarSolicitud(usuarioId, nuevoTokenCancelacion);
};

/**
 * Genera y envía el enlace de confirmación tras las 24 horas (Etapa 2).
 */
export const enviarEnlace = async (usuarioId) => {
    const estadoActual = await obtenerEstado(usuarioId);
    if (!estadoActual) {
        throw new ErrorApp('No hay ninguna recuperación en proceso.', 400);
    }
    if (new Date() < new Date(estadoActual.espera_hasta)) {
        throw new ErrorApp('El periodo de seguridad de 24 horas aún no termina.', 403);
    }
    if (new Date(estadoActual.ultimo_envio_correo) > new Date(Date.now() - 60000)) {
        throw new ErrorApp('Debes esperar 60 segundos antes de reenviar el enlace.', 429);
    }

    const tokenConfirmacion = generarTokenAleatorio();

    await consulta(
        `UPDATE recuperacion_2fa 
         SET token_confirmacion = $1, enlace_expira_en = NOW() + INTERVAL '30 minutes', ultimo_envio_correo = NOW()
         WHERE usuario_id = $2 AND estado = 'pendiente'`,
        [hashear(tokenConfirmacion), usuarioId]
    );

    await notificarEnlace(usuarioId, tokenConfirmacion);
};

/**
 * Completa la recuperación usando CTE atómica (Etapa 3).
 */
export const confirmarRecuperacion = async (tokenConfirmacion) => {
    const sqlAtomico = `
        WITH rec AS (
            UPDATE recuperacion_2fa SET estado = 'completada' 
            WHERE token_confirmacion = $1 AND estado = 'pendiente' AND enlace_expira_en > NOW()
            RETURNING usuario_id
        ),
        upd_auth AS (
            UPDATE autenticacion_2fa 
            SET totp_activado = false, secreto_totp_cifrado = NULL, correo_2fa_activado = false, habilitado = false, actualizado_en = NOW() 
            WHERE usuario_id IN (SELECT usuario_id FROM rec)
        ),
        upd_cod AS (
            UPDATE codigos_respaldo SET usado = true, usado_en = NOW() 
            WHERE usuario_id IN (SELECT usuario_id FROM rec) AND usado = false
        ),
        upd_disp AS (
            UPDATE dispositivos_confianza SET revocado = true, revocado_en = NOW() 
            WHERE usuario_id IN (SELECT usuario_id FROM rec) AND revocado = false
        )
        UPDATE sesiones SET cerrada_en = NOW() 
        WHERE usuario_id IN (SELECT usuario_id FROM rec) AND cerrada_en IS NULL
        RETURNING id AS sid, (SELECT usuario_id FROM rec) AS u_id;
    `;

    const { rows } = await consulta(sqlAtomico, [hashear(tokenConfirmacion)]);

    if (rows.length === 0) {
        throw new ErrorApp('El enlace de recuperación es inválido, ya fue usado o ha expirado.', 400);
    }

    // Expulsar conexiones activas de todas las sesiones devueltas
    rows.forEach(row => cerrarSocketsDeSesion(row.sid));

    const usuarioId = rows[0].u_id;
    const { rows: uRows } = await consulta('SELECT correo, nombre FROM usuarios WHERE id = $1', [usuarioId]);
    if (uRows[0]) await notificarExito(uRows[0]);
};

/**
 * Cancela una solicitud, ya sea por token de correo o desde sesión de usuario.
 */
export const cancelarRecuperacion = async (tokenCancelacion = null, usuarioId = null) => {
    let sql = '';
    let params = [];

    if (tokenCancelacion) {
        sql = `UPDATE recuperacion_2fa SET estado = 'cancelada' WHERE token_cancelacion = $1 AND estado = 'pendiente' RETURNING id`;
        params = [hashear(tokenCancelacion)];
    } else if (usuarioId) {
        sql = `UPDATE recuperacion_2fa SET estado = 'cancelada' WHERE usuario_id = $1 AND estado = 'pendiente' RETURNING id`;
        params = [usuarioId];
    } else {
        throw new ErrorApp('Datos insuficientes para cancelar.', 400);
    }

    const { rows } = await consulta(sql, params);
    if (rows.length === 0) {
        throw new ErrorApp('No se encontró una solicitud pendiente válida para cancelar.', 400);
    }
};

// ================= Métodos Privados de Correo =================
async function notificarSolicitud(usuarioId, tokenCancelacion) {
    const { rows } = await consulta('SELECT correo, nombre FROM usuarios WHERE id = $1', [usuarioId]);
    const { correo, nombre } = rows[0];
    const urlCancelacion = `${env.APP_URL}/pages/login.html?accion=cancelar_recuperacion&token=${tokenCancelacion}`;

    try {
        await enviarCorreo({
            para: correo,
            asunto: 'Recuperación de cuenta iniciada - ScrumFlow',
            html: `<div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
                    <h2 style="color: #055651;">Hola, ${nombre}</h2>
                    <p>Alguien ha solicitado desactivar el 2FA de tu cuenta de ScrumFlow.</p>
                    <p>Por seguridad, existe un <strong>periodo de espera de 24 horas</strong> antes de que podamos enviar el enlace de recuperación definitivo.</p>
                    <p>Si fuiste tú, no tienes que hacer nada por ahora. Regresa al inicio de sesión cuando pasen las 24 horas.</p>
                    <div style="background: #fff3cd; color: #856404; padding: 15px; border-left: 5px solid #ffeeba; margin-top: 20px;">
                        <strong>¿No fuiste tú?</strong><br>
                        Cancela esta solicitud inmediatamente haciendo clic aquí:<br><br>
                        <a href="${urlCancelacion}" style="background-color: #dc3545; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block;">Cancelar Recuperación</a>
                    </div>
                   </div>`
        });
    } catch (e) {
        console.error('[recuperacion.service] Error SMTP al enviar aviso inicial:', e);
    }
}

async function notificarEnlace(usuarioId, tokenConfirmacion) {
    const { rows } = await consulta('SELECT correo, nombre FROM usuarios WHERE id = $1', [usuarioId]);
    const { correo, nombre } = rows[0];
    const urlConfirmacion = `${env.APP_URL}/pages/login.html?accion=confirmar_recuperacion&token=${tokenConfirmacion}`;

    try {
        await enviarCorreo({
            para: correo,
            asunto: 'Enlace de recuperación - ScrumFlow',
            html: `<div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
                    <h2 style="color: #055651;">Hola, ${nombre}</h2>
                    <p>El periodo de seguridad de 24 horas ha concluido.</p>
                    <p>Para recuperar el acceso a tu cuenta y desactivar permanentemente tus configuraciones de 2FA, haz clic en el siguiente enlace:</p>
                    <a href="${urlConfirmacion}" style="background-color: #055651; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 15px 0;">Recuperar mi cuenta</a>
                    <p>Este enlace expirará en <strong>30 minutos</strong>.</p>
                   </div>`
        });
    } catch (e) {
        console.error('[recuperacion.service] Error SMTP al enviar enlace:', e);
    }
}

async function notificarExito({ correo, nombre }) {
    try {
        await enviarCorreo({
            para: correo,
            asunto: 'Cuenta recuperada exitosamente - ScrumFlow',
            html: `<div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
                    <h2 style="color: #055651;">Hola, ${nombre}</h2>
                    <p>Tu cuenta ha sido recuperada exitosamente.</p>
                    <p>Se han desactivado todos tus métodos de autenticación en dos pasos y se han cerrado tus sesiones activas por seguridad.</p>
                    <p>Te recomendamos encarecidamente que inicies sesión y <strong>vuelvas a configurar tu 2FA</strong> de inmediato.</p>
                   </div>`
        });
    } catch (e) {
        console.error('[recuperacion.service] Error SMTP al enviar éxito:', e);
    }
}