import { verificarPassword, necesitaRehash, hashearPassword, gastarTiempoDeHash } from '../../utils/hash.js';
import jwt from 'jsonwebtoken';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * @file auth.service.js
 * @description Lógica de negocio para autenticación, control de intentos y tokens.
 * @author Citlaly Morales Viveros
 */

const verificarBloqueoIp = async (ip) => {
    const { rows } = await consulta('SELECT * FROM intentos_ip WHERE ip = $1', [ip]);
    const registro = rows[0];

    if (registro && registro.bloqueado_hasta && new Date() < new Date(registro.bloqueado_hasta)) {
        throw new ErrorApp('IP bloqueada temporalmente por múltiples intentos fallidos.', 429);
    }
    return registro;
};

const registrarIntentoFallido = async (ip, correo) => {
    await consulta(`
        INSERT INTO intentos_ip (ip, intentos) VALUES ($1, 1)
        ON CONFLICT (ip) DO UPDATE SET intentos = intentos_ip.intentos + 1, ultimo_intento = NOW()
        `, [ip]
    );

    const { rows: reqIp } = await consulta(
        'SELECT intentos FROM intentos_ip WHERE ip = $1', [ip]
    );

    if (reqIp[0].intentos >= env.MAX_INTENTOS_IP) {
        await consulta(
            `UPDATE intentos_ip SET bloqueado_hasta = NOW() + ($2::int * INTERVAL '1 minute') WHERE ip = $1`,
            [ip, env.BLOQUEO_MINUTOS]
        );
    }

    if (correo) {
        const { rows: reqUser } = await consulta(
            `UPDATE usuarios SET bloqueado_hasta = NOW() + ($2::int * INTERVAL '1 minute') WHERE correo = $1`, 
            [correo, env.BLOQUEO_MINUTOS]
        );

        if (reqUser[0] && reqUser[0].intentos_fallidos >= env.MAX_INTENTOS_CORREO) {
            await consulta(
                `UPDATE usuarios SET bloqueado_hasta = NOW() + INTERVAL '${env.BLOQUEO_MINUTOS} minutes' WHERE correo = $1`, [correo]
            );
        }
    }
};

export const autenticarUsuario = async (correo, password, ip) => {
    await verificarBloqueoIp(ip);

    const { rows } = await consulta('SELECT * FROM usuarios WHERE correo = $1', [correo.toLowerCase()]);
    const usuario = rows[0];

    if (!usuario || !usuario.activo) {
        await gastarTiempoDeHash(password); // iguala tiempos: evita enumeración de usuarios
        await registrarIntentoFallido(ip, null);
        throw new ErrorApp('Credenciales incorrectas.', 401);
    }

    if (usuario.bloqueado_hasta && new Date() < new Date(usuario.bloqueado_hasta)) {
        throw new ErrorApp('Cuenta bloqueada temporalmente.', 429);
    }

    const claveValida = await verificarPassword(password, usuario.password_hash);
    if (!claveValida) {
        await registrarIntentoFallido(ip, usuario.correo);
        throw new ErrorApp('Credenciales incorrectas.', 401);
    }

    // Migración transparente bcrypt -> Argon2id
    if (necesitaRehash(usuario.password_hash)) {
        const nuevoHash = await hashearPassword(password);
        await consulta('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [nuevoHash, usuario.id]);
    }

    await consulta(
        'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [usuario.id]
    );

    await consulta(
        'DELETE FROM intentos_ip WHERE ip = $1', [ip]
    );

    const payload = { id: usuario.id, es_admin: usuario.es_admin };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    return { accessToken, refreshToken, usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo } };
};

export const revocarToken = async (token, minutosExpiracion) => {
    await consulta(`
    INSERT INTO tokens_revocados (token, expira_en) 
    VALUES ($1, NOW() + ($2::int * INTERVAL '1 minute'))
    ON CONFLICT (token) DO NOTHING
    `, [token, minutosExpiracion]);
};

export const renovarSesion = async (refreshToken) => {
    if (!refreshToken) throw new ErrorApp('Token de renovación no proporcionado.', 401);

    const { rows } = await consulta('SELECT 1 FROM tokens_revocados WHERE token = $1', [refreshToken]);
    if (rows.length > 0) throw new ErrorApp('Token de renovación revocado.', 401);

    try {
        const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
        await revocarToken(refreshToken, env.JWT_RENOVACION_MINUTOS);

        const nuevoPayload = { id: payload.id, es_admin: payload.es_admin };
        const nuevoAccessToken = jwt.sign(nuevoPayload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
        const nuevoRefreshToken = jwt.sign(nuevoPayload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

        return { nuevoAccessToken, nuevoRefreshToken };
    } catch (error) {
        throw new ErrorApp('Token de renovación inválido o expirado.', 401);
    }
};