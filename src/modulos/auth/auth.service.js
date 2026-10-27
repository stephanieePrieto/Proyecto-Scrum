import { verificarPassword, necesitaRehash, hashearPassword, gastarTiempoDeHash } from '../../utils/hash.js';
import jwt from 'jsonwebtoken';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { randomUUID } from 'crypto';

/**
 * @file auth.service.js
 * @description Lógica de negocio para autenticación, control de intentos y tokens.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

/**
 * Comprueba si la IP está bloqueada temporalmente por intentos fallidos.
 *
 * @param {string} ip - Dirección IP de la petición.
 * @returns {Promise<Object|undefined>} Registro de intentos de la IP, si existe.
 * @throws {ErrorApp} 429 si la IP sigue bloqueada.
 */
const verificarBloqueoIp = async (ip) => {
    const { rows } = await consulta('SELECT * FROM intentos_ip WHERE ip = $1', [ip]);
    const registro = rows[0];

    if (registro && registro.bloqueado_hasta && new Date() < new Date(registro.bloqueado_hasta)) {
        throw new ErrorApp('IP bloqueada temporalmente por múltiples intentos fallidos.', 429);
    }
    return registro;
};

/**
 * Registra un intento fallido de inicio de sesión. Bloquea la IP al llegar al máximo de intentos
 * y, si se indica el correo, cuenta el intento en la cuenta y la bloquea al llegar a su máximo.
 *
 * @param {string} ip - Dirección IP de la petición.
 * @param {string|null} correo - Correo de la cuenta afectada; null si la cuenta no existe o está inactiva.
 * @returns {Promise<void>}
 */
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
        const { rows: cuenta } = await consulta(
            'UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1 WHERE correo = $1 RETURNING intentos_fallidos',
            [correo]
        );

        if (cuenta[0] && cuenta[0].intentos_fallidos >= env.MAX_INTENTOS_CORREO) {
            await consulta(
                `UPDATE usuarios SET bloqueado_hasta = NOW() + ($2::int * INTERVAL '1 minute'), intentos_fallidos = 0 WHERE correo = $1`,
                [correo, env.BLOQUEO_MINUTOS]
            );
        }
    }
};

/**
 * Valida las credenciales, controla los bloqueos por IP y por cuenta y genera los tokens de sesión.
 *
 * @param {string} correo - Correo de la cuenta.
 * @param {string} password - Contraseña en texto plano.
 * @param {string} ip - Dirección IP de la petición.
 * @returns {Promise<{accessToken: string, refreshToken: string, usuario: {id: number, nombre: string, correo: string}}>}
 * @throws {ErrorApp} 401 si las credenciales son incorrectas, 429 si la IP o la cuenta están bloqueadas.
 */
export const autenticarUsuario = async (correo, password, ip) => {
    await verificarBloqueoIp(ip);

    const { rows } = await consulta('SELECT * FROM usuarios WHERE correo = $1', [correo.trim().toLowerCase()]);
    const usuario = rows[0];

    if (!usuario || !usuario.activo || !usuario.password_hash) {
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

    const sid = await abrirSesion(usuario.id);
    const payload = { id: usuario.id, sid };
    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    return { accessToken, refreshToken, usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo } };
};

/**
 * Guarda un token en la lista de revocados hasta que expire.
 *
 * @param {string} token - Token a revocar.
 * @param {number} minutosExpiracion - Minutos de vigencia restantes del token.
 * @returns {Promise<void>}
 */
export const revocarToken = async (token, minutosExpiracion) => {
    await consulta(`
    INSERT INTO tokens_revocados (token, expira_en) 
    VALUES ($1, NOW() + ($2::int * INTERVAL '1 minute'))
    ON CONFLICT (token) DO NOTHING
    `, [token, minutosExpiracion]);
};

/**
 * Registra la sesión de la persona que acaba de iniciar sesión. Cada inicio de sesión es una sesión
 * distinta, así que cada dispositivo lleva su propio tiempo de inactividad.
 *
 * @param {number} usuarioId - Identificador de la cuenta.
 * @returns {Promise<string>} Identificador de la sesión (sid) que viaja dentro de los tokens.
 */
const abrirSesion = async (usuarioId) => {
    const sid = randomUUID();
    await consulta('INSERT INTO sesiones (id, usuario_id) VALUES ($1, $2)', [sid, usuarioId]);
    return sid;
};

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea un error 401 con un código que el frontend puede leer en "detalles.codigo".
 *
 * @param {string} mensaje - Texto para la persona usuaria.
 * @param {string} codigo - SESION_INACTIVA, SESION_CERRADA o SESION_INVALIDA.
 * @returns {ErrorApp}
 */
export const errorDeSesion = (mensaje, codigo) => {
    const error = new ErrorApp(mensaje, 401);
    error.detalles = { codigo };
    return error;
};

/**
 * Evalúa si una sesión sigue vigente (abierta y con actividad dentro del límite de inactividad).
 * Solo adelanta la última actividad cuando se indica cuánto hace que la persona interactuó con la
 * pantalla; las renovaciones y las conexiones en tiempo real pasan null y nunca la reinician.
 * Evaluar y adelantar ocurre en una sola sentencia, y la fecha nunca retrocede ni se escribe
 * más de una vez cada 10 segundos.
 *
 * @param {string} sid - Identificador de la sesión.
 * @param {number|null} segundosDesdeInteraccion - Segundos desde la última interacción humana, según el navegador.
 * @returns {Promise<{activa: true, usuarioId: number}|{activa: false, motivo: 'inactiva'|'cerrada'}>}
 */
export const evaluarSesion = async (sid, segundosDesdeInteraccion) => {
    if (typeof sid !== 'string' || !ES_UUID.test(sid)) return { activa: false, motivo: 'cerrada' };

    const { rows } = await consulta(`
        WITH vigente AS (
            SELECT id, usuario_id FROM sesiones
            WHERE id = $1 AND cerrada_en IS NULL
              AND ultima_actividad > NOW() - ($3::int * INTERVAL '1 minute')
        ), avance AS (
            UPDATE sesiones s
            SET ultima_actividad = NOW() - ($2::int * INTERVAL '1 second')
            FROM vigente v
            WHERE s.id = v.id
              AND s.ultima_actividad < NOW() - ($2::int * INTERVAL '1 second') - INTERVAL '10 seconds'
            RETURNING s.id
        )
        SELECT usuario_id FROM vigente
        `, [sid, segundosDesdeInteraccion ?? null, env.INACTIVIDAD_MINUTOS]
    );
    if (rows[0]) return { activa: true, usuarioId: rows[0].usuario_id };

    const { rows: estado } = await consulta('SELECT cerrada_en FROM sesiones WHERE id = $1', [sid]);
    return { activa: false, motivo: estado[0] && !estado[0].cerrada_en ? 'inactiva' : 'cerrada' };
};

/**
 * Indica, sin modificar nada, si una sesión sigue vigente.
 *
 * @param {string} sid - Identificador de la sesión.
 * @returns {Promise<boolean>}
 */
export const sesionVigente = async (sid) => {
    const vigentes = await sesionesVigentes([sid]);
    return vigentes.has(sid);
};

/**
 * Indica, sin modificar nada, cuáles de las sesiones recibidas siguen vigentes.
 *
 * @param {string[]} sids - Identificadores de sesión.
 * @returns {Promise<Set<string>>} Identificadores que siguen vigentes.
 */
export const sesionesVigentes = async (sids) => {
    const validos = sids.filter((sid) => typeof sid === 'string' && ES_UUID.test(sid));
    if (validos.length === 0) return new Set();

    const { rows } = await consulta(`
        SELECT id FROM sesiones
        WHERE id = ANY($1::uuid[]) AND cerrada_en IS NULL
          AND ultima_actividad > NOW() - ($2::int * INTERVAL '1 minute')
        `, [validos, env.INACTIVIDAD_MINUTOS]
    );
    return new Set(rows.map((fila) => fila.id));
};

/**
 * Revoca un token solo si la firma es auténtica y todavía no expiró. La expiración se ignora al
 * verificar para poder leer el contenido de un token vencido, pero uno vencido no se guarda
 * porque ya no sirve, y one falsificado se descarta sin tocar la base de datos.
 *
 * @param {string|undefined} token - Token recibido del cliente.
 * @param {string} secreto - Secreto con el que se firmó ese tipo de token.
 * @returns {Promise<Object|null>} Contenido del token si la firma es válida; null en otro caso.
 */
const revocarSiEsValido = async (token, secreto) => {
    if (typeof token !== 'string' || token === '') return null;

    let payload;
    try {
        payload = jwt.verify(token, secreto, { ignoreExpiration: true });
    } catch (error) {
        return null;
    }

    const segundosRestantes = payload.exp - Math.floor(Date.now() / 1000);
    if (segundosRestantes > 0) await revocarToken(token, Math.ceil(segundosRestantes / 60));
    return payload;
};

/**
 * Cierra las sesiones a las que pertenecen los tokens recibidos y revoca los que sigan vigentes.
 * Funciona aunque el token de acceso ya haya expirado y no hace nada con tokens falsificados.
 *
 * @param {string|undefined} accessToken - Token de acceso recibido del cliente.
 * @param {string|undefined} refreshToken - Token de renovación recibido del cliente.
 * @returns {Promise<string[]>} Identificadores de las sesiones cerradas.
 */
export const cerrarSesionPorTokens = async (accessToken, refreshToken) => {
    const sids = new Set();
    const accesos = await revocarSiEsValido(accessToken, env.JWT_SECRET);
    const renovaciones = await revocarSiEsValido(refreshToken, env.JWT_REFRESH_SECRET);

    for (const payload of [accesos, renovaciones]) {
        if (payload && typeof payload.sid === 'string' && ES_UUID.test(payload.sid)) sids.add(payload.sid);
    }

    for (const sid of sids) {
        await consulta('UPDATE sesiones SET cerrada_en = NOW() WHERE id = $1 AND cerrada_en IS NULL', [sid]);
    }
    return [...sids];
};

/**
 * Renueva la sesión a partir de un token de renovación válido y revoca el anterior.
 *
 * @param {string|undefined} refreshToken - Token de renovación recibido en la cookie.
 * @returns {Promise<{nuevoAccessToken: string, nuevoRefreshToken: string}>}
 * @throws {ErrorApp} 401 si no hay token, está revocado o es inválido o expiró.
 */
export const renovarSesion = async (refreshToken) => {
    if (!refreshToken) throw new ErrorApp('Token de renovación no proporcionado.', 401);

    const { rows } = await consulta('SELECT 1 FROM tokens_revocados WHERE token = $1', [refreshToken]);
    if (rows.length > 0) throw new ErrorApp('Token de renovación revocado.', 401);

    let payload;
    try {
        payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    } catch (error) {
        throw new ErrorApp('Token de renovación inválido o expirado.', 401);
    }

    // Renovar no es actividad de la persona: solo se comprueba que la sesión siga vigente
    if (!payload.sid) throw errorDeSesion('Sesión no válida. Inicia sesión de nuevo.', 'SESION_INVALIDA');
    const sesion = await evaluarSesion(payload.sid, null);
    if (!sesion.activa) {
        throw sesion.motivo === 'inactiva'
            ? errorDeSesion('Sesión cerrada por inactividad.', 'SESION_INACTIVA')
            : errorDeSesion('Sesión finalizada o token inválido.', 'SESION_CERRADA');
    }

    await revocarToken(refreshToken, env.JWT_REFRESH_MINUTOS);

    const nuevoPayload = { id: payload.id, sid: payload.sid };
    const nuevoAccessToken = jwt.sign(nuevoPayload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const nuevoRefreshToken = jwt.sign(nuevoPayload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    return { nuevoAccessToken, nuevoRefreshToken };
};

/**
 * Registra un nuevo usuario en la base de datos con contraseña hasheada.
 *
 * @param {string} nombre - Nombre del usuario.
 * @param {string} correo - Correo electrónico único.
 * @param {string} password - Contraseña en texto plano.
 * @returns {Promise<Object>} Datos básicos del usuario creado.
 */
export const registrarUsuario = async (nombre, correo, password) => {
    const correoLimpio = correo.trim().toLowerCase();

    // Verificar si el correo ya está registrado
    const { rows: existente } = await consulta('SELECT id FROM usuarios WHERE correo = $1', [correoLimpio]);
    if (existente.length > 0) {
        throw new ErrorApp('El correo electrónico ya está registrado.', 400);
    }

    // Hashear la contraseña de forma segura
    const passwordHash = await hashearPassword(password);

    // Insertar el nuevo usuario
    const { rows } = await consulta(
        `INSERT INTO usuarios (nombre, correo, password_hash, activo) 
         VALUES ($1, $2, $3, true) 
         RETURNING id, nombre, correo`,
        [nombre.trim(), correoLimpio, passwordHash]
    );

    return rows[0];
};