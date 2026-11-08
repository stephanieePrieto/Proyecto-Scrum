import { verificarPassword, necesitaRehash, hashearPassword, gastarTiempoDeHash } from '../../utils/hash.js';
import jwt from 'jsonwebtoken';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { randomUUID, randomInt, createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { enviarCorreo } from '../../utils/correo.js'; // Utilidad de correo existente en el proyecto

/**
 * @file auth.service.js
 * @description Lógica de negocio para autenticación, control de intentos y tokens.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

/**
 * Comprueba si la IP está bloqueada temporalmente por intentos fallidos.
 *
 * @param {string} ip Dirección IP de la petición.
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
 * @param {string} ip Dirección IP de la petición.
 * @param {string|null} correo Correo de la cuenta afectada; null si la cuenta no existe o está inactiva.
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
 * @param {string} correo Correo de la cuenta.
 * @param {string} password Contraseña en texto plano.
 * @param {string} ip Dirección IP de la petición.
 * @param {string} [tokenConfianza] Valor de la cookie tokenConfianza, si el navegador la envió (para dispositivos de confianza).
 * @returns {Promise<{accessToken: string, refreshToken: string, usuario: {id: number, nombre: string, correo: string}, requiere2fa: boolean, metodos2fa: string[]}>}
 * @throws {ErrorApp} 401 si las credenciales son incorrectas, 429 si la IP o la cuenta están bloqueadas.
 */
export const autenticarUsuario = async (correo, password, ip, tokenConfianza = null) => {
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

    // Verificar si el usuario tiene 2FA activado
    const config2FA = await obtenerConfiguracion2FA(usuario.id);

    // Verificar si es un dispositivo de confianza
    let esDispositivoConfianza = false;
    if (config2FA.habilitado && tokenConfianza) {
        esDispositivoConfianza = await esDispositivoDeConfianza(usuario.id, tokenConfianza);
    }

    // Si no tiene 2FA habilitado o es dispositivo de confianza, crear sesión normal
    if (!config2FA.habilitado || esDispositivoConfianza) {
        const sid = await abrirSesion(usuario.id);
        const payload = { id: usuario.id, sid };
        const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
        const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

        return {
            accessToken,
            refreshToken,
            usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
            requiere2fa: false
        };
    }

    // Generar token temporal para 2FA
    const tokenTemporal = await generarTokenTemporal2FA(usuario.id);

    // Obtener métodos de 2FA disponibles
    const metodos2fa = [];
    if (config2FA.totpActivado) metodos2fa.push('totp');
    if (config2FA.correoActivado) metodos2fa.push('correo');

    return {
        tokenTemporal: tokenTemporal.token,
        usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo },
        requiere2fa: true,
        metodos2fa
    };
};

/**
 * Guarda un token en la lista de revocados hasta que expire.
 *
 * @param {string} token Token a revocar.
 * @param {number} minutosExpiracion Minutos de vigencia restantes del token.
 * @returns {Promise<boolean>} True si el token se revocó en esta llamada, false si ya estaba revocado.
 */
export const revocarToken = async (token, minutosExpiracion) => {
    const { rows } = await consulta(`
    INSERT INTO tokens_revocados (token, expira_en) 
    VALUES ($1, NOW() + ($2::int * INTERVAL '1 minute'))
    ON CONFLICT (token) DO NOTHING
    RETURNING token
    `, [token, minutosExpiracion]);

    return rows.length > 0;
};

/**
 * Registra la sesión de la persona que acaba de iniciar sesión. Cada inicio de sesión es una sesión
 * distinta, así que cada dispositivo lleva su propio tiempo de inactividad.
 *
 * @param {number} usuarioId Identificador de la cuenta.
 * @returns {Promise<string>} Identificador de la sesión (sid) que viaja dentro de los tokens.
 */
export const abrirSesion = async (usuarioId) => {
    const sid = randomUUID();
    await consulta('INSERT INTO sesiones (id, usuario_id) VALUES ($1, $2)', [sid, usuarioId]);
    return sid;
};

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea un error 401 con un código que el frontend puede leer en "detalles.codigo".
 *
 * @param {string} mensaje Texto para la persona usuaria.
 * @param {string} codigo SESION_INACTIVA, SESION_CERRADA o SESION_INVALIDA.
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
 * @param {string} sid Identificador de la sesión.
 * @param {number|null} segundosDesdeInteraccion Segundos desde la última interacción humana, según el navegador.
 * @returns {Promise<{activa: true, usuarioId: number}|{activa: false, motivo: 'inactiva'|'cerrada'}>}
 */
export const evaluarSesion = async (sid, segundosDesdeInteraccion) => {
    if (typeof sid !== 'string' || !ES_UUID.test(sid)) return { activa: false, motivo: 'cerrada' };

    const { rows } = await consulta(`
        WITH vigente AS (
            SELECT s.id, s.usuario_id FROM sesiones s
            JOIN usuarios u ON u.id = s.usuario_id AND u.activo = TRUE
            WHERE s.id = $1 AND s.cerrada_en IS NULL
              AND s.ultima_actividad > NOW() - ($3::int * INTERVAL '1 minute')
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
 * @param {string} sid Identificador de la sesión.
 * @returns {Promise<boolean>}
 */
export const sesionVigente = async (sid) => {
    const vigentes = await sesionesVigentes([sid]);
    return vigentes.has(sid);
};

/**
 * Indica, sin modificar nada, cuáles de las sesiones recibidas siguen vigentes.
 *
 * @param {string[]} sids Identificadores de sesión.
 * @returns {Promise<Set<string>>} Identificadores que siguen vigentes.
 */
export const sesionesVigentes = async (sids) => {
    const validos = sids.filter((sid) => typeof sid === 'string' && ES_UUID.test(sid));
    if (validos.length === 0) return new Set();

    const { rows } = await consulta(`
        SELECT s.id FROM sesiones s
        JOIN usuarios u ON u.id = s.usuario_id AND u.activo = TRUE
        WHERE s.id = ANY($1::uuid[]) AND s.cerrada_en IS NULL
          AND s.ultima_actividad > NOW() - ($2::int * INTERVAL '1 minute')
        `, [validos, env.INACTIVIDAD_MINUTOS]
    );
    return new Set(rows.map((fila) => fila.id));
};

/**
 * Revoca un token solo si la firma es auténtica y todavía no expiró. La expiración se ignora al
 * verificar para poder leer el contenido de un token vencido, pero uno vencido no se guarda
 * porque ya no sirve, y uno falsificado se descarta sin tocar la base de datos.
 *
 * @param {string|undefined} token Token recibido del cliente.
 * @param {string} secreto Secreto con el que se firmó ese tipo de token.
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
 * @param {string|undefined} accessToken Token de acceso recibido del cliente.
 * @param {string|undefined} refreshToken Token de renovación recibido del cliente.
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
 * @param {string|undefined} refreshToken Token de renovación recibido en la cookie.
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

    /**
     * Revocar el token de renovación usado, por los minutos de vigencia que le quedan según su propio exp.
     * (Antes se usaba env.JWT_REFRESH_MINUTOS, que no existe y dejaba expira_en en null.)
     */
    const minutosRestantes = Math.max(1, Math.ceil((payload.exp - Math.floor(Date.now() / 1000)) / 60));
    await revocarToken(refreshToken, minutosRestantes);

    const nuevoPayload = { id: payload.id, sid: payload.sid };
    const nuevoAccessToken = jwt.sign(nuevoPayload, env.JWT_SECRET, { expiresIn: `${env.JWT_ACCESO_MINUTOS}m` });
    const nuevoRefreshToken = jwt.sign(nuevoPayload, env.JWT_REFRESH_SECRET, { expiresIn: `${env.JWT_RENOVACION_MINUTOS}m` });

    return { nuevoAccessToken, nuevoRefreshToken };
};

/**
 * Registra un nuevo usuario en la base de datos con contraseña hasheada y envía correo de bienvenida.
 *
 * @param {string} nombre Nombre del usuario.
 * @param {string} correo Correo electrónico único.
 * @param {string} password Contraseña en texto plano.
 * @returns {Promise<Object>} Datos básicos del usuario creado.
 */
export const registrarUsuario = async (nombre, correo, password) => {
    const correoLimpio = correo.trim().toLowerCase();

    // Validación de seguridad de contraseña en servidor (Mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número)
    const regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!regexPassword.test(password)) {
        throw new ErrorApp('La contraseña debe tener al menos 8 caracteres, incluir una mayúscula, una minúscula y un número.', 400);
    }

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

    const usuarioCreado = rows[0];

    // Enviar correo de bienvenida de forma real por SMTP
    try {
        await enviarCorreo({
            para: correoLimpio, // <-- CAMBIADO: Debe ser 'para' para que correo.js lo lea bien
            asunto: '¡Bienvenido a ScrumFlow!',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
                    <h2 style="color: #055651;">¡Hola, ${nombre.trim()}!</h2>
                    <p>Te damos la más cordial bienvenida a <strong>ScrumFlow</strong>, tu plataforma de gestión ágil de proyectos.</p>
                    <p>Tu cuenta ha sido creada exitosamente. Ya puedes iniciar sesión con tu correo electrónico y contraseña para comenzar a organizar tus sprints y equipos.</p>
                    <br>
                    <p>¡Mucho éxito en tus proyectos!</p>
                    <p style="color: #666; font-size: 0.9rem;">Equipo de ScrumFlow</p>
                </div>
            `
        });
    } catch (errorCorreo) {
        console.error('[auth.service] No se pudo enviar el correo de bienvenida:', errorCorreo);
    }

    return usuarioCreado;
};

/**
 * Algoritmo de cifrado AES-256-GCM para secretos TOTP.
 * @type {string}
 */
const ALGORITMO_CIFRADO = 'aes-256-gcm';

/**
 * Cifra un texto usando AES-256-GCM.
 *
 * @param {string} texto Texto a cifrar.
 * @param {string} claveBase64 Clave de cifrado en base64 (32 bytes).
 * @returns {string} Texto cifrado en formato IV:cifrado:authTag (todo en hex).
 */
const cifrarTexto = (texto, claveBase64) => {
    if (!claveBase64) {
        throw new ErrorApp('No se puede cifrar: TOTP_ENCRYPTION_KEY no está configurada.', 500);
    }
    const clave = Buffer.from(claveBase64, 'base64');
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITMO_CIFRADO, clave, iv);
    let cifrado = cipher.update(texto, 'utf8', 'hex');
    cifrado += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${cifrado}:${authTag.toString('hex')}`;
};

/**
 * Descifra un texto cifrado con AES-256-GCM.
 *
 * @param {string} textoCifrado Texto cifrado en formato IV:cifrado:authTag.
 * @param {string} claveBase64 Clave de cifrado en base64 (32 bytes).
 * @returns {string} Texto descifrado.
 * @throws {Error} Si el descifrado falla.
 */
const descifrarTexto = (textoCifrado, claveBase64) => {
    if (!claveBase64) {
        throw new ErrorApp('No se puede descifrar: TOTP_ENCRYPTION_KEY no está configurada.', 500);
    }
    const clave = Buffer.from(claveBase64, 'base64');
    const [ivHex, cifrado, authTagHex] = textoCifrado.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITMO_CIFRADO, clave, iv);
    decipher.setAuthTag(authTag);
    let texto = decipher.update(cifrado, 'hex', 'utf8');
    texto += decipher.final('utf8');
    return texto;
};

/**
 * Genera un secreto TOTP aleatorio (Base32, 20 caracteres).
 *
 * @returns {string} Secreto TOTP.
 */
const generarSecretoTotp = () => {
    const buffer = randomBytes(20);
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secreto = '';
    for (let i = 0; i < 20; i++) {
        const index = buffer[i] & 0x1F;
        secreto += base32Chars[index];
    }
    return secreto;
};

/**
 * Decodifica una cadena Base32 (RFC 4648) a bytes.
 * Ignora espacios, guiones, relleno '=' y diferencias de mayúsculas; los bits
 * sobrantes al final se descartan, igual que hacen las apps autenticadoras.
 *
 * @param {string} cadena Texto en Base32.
 * @returns {Buffer} Bytes decodificados.
 * @throws {Error} Si la cadena contiene caracteres fuera del alfabeto Base32.
 */
const decodificarBase32 = (cadena) => {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const limpia = String(cadena).toUpperCase().replace(/[\s=-]/g, '');
    const bytes = [];
    let bits = 0;
    let acumulado = 0;

    for (const caracter of limpia) {
        const valor = alfabeto.indexOf(caracter);
        if (valor === -1) {
            throw new Error('Secreto TOTP con caracteres inválidos');
        }
        acumulado = (acumulado << 5) | valor;
        bits += 5;
        if (bits >= 8) {
            bytes.push((acumulado >>> (bits - 8)) & 0xFF);
            bits -= 8;
            acumulado &= (1 << bits) - 1;
        }
    }

    return Buffer.from(bytes);
};

/**
 * Genera un código TOTP de 6 dígitos usando HMAC-SHA1.
 * Implementación del estándar RFC 6238.
 *
 * @param {string} secreto Secreto TOTP en Base32.
 * @param {number} [epoch] Timestamp en segundos (para pruebas). Si no se proporciona, usa Date.now().
 * @returns {string} Código TOTP de 6 dígitos.
 */
const generarCodigototp = (secreto, epoch = null) => {
    const step = 30; // 30 segundos por código
    let tiempo = Math.floor((epoch || Math.floor(Date.now() / 1000)) / step);
    const tiempoBuffer = Buffer.alloc(8);
    for (let i = 7; i >= 0; i--) {
        tiempoBuffer[i] = tiempo & 0xFF;
        tiempo >>= 8;
    }

    const claveBuffer = decodificarBase32(secreto);
    const hmac = createHmac('sha1', claveBuffer);
    hmac.update(tiempoBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0F;
    const binary = ((hash[offset] & 0x7F) << 24) |
        ((hash[offset + 1] & 0xFF) << 16) |
        ((hash[offset + 2] & 0xFF) << 8) |
        (hash[offset + 3] & 0xFF);

    return (binary % 1_000_000).toString().padStart(6, '0');
};

/**
 * Verifica un código TOTP.
 *
 * @param {string} secreto Secreto TOTP en Base32.
 * @param {string} codigo Código de 6 dígitos a verificar.
 * @param {number} [tolerance] Tolerancia en segundos (para permitir códigos anteriores/Posteriores).
 * @returns {boolean} True si el código es válido.
 */
const verificarCodigototp = (secreto, codigo, tolerance = 60) => {
    const now = Math.floor(Date.now() / 1000);
    for (let i = -Math.floor(tolerance / 30); i <= Math.floor(tolerance / 30); i++) {
        const testEpoch = now + (i * 30);
        const testCode = generarCodigototp(secreto, testEpoch);
        if (testCode === codigo) return true;
    }
    return false;
};

/**
 * Hash de un código usando SHA-256.
 *
 * @param {string} codigo Código en texto plano.
 * @returns {string} Hash SHA-256 en hexadecimal.
 */
const hashearCodigo = (codigo) => {
    return createHash('sha256').update(codigo).digest('hex');
};

/**
 * Verifica si un usuario tiene el 2FA activado.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<boolean>} True si el 2FA está habilitado.
 */
export const tiene2FAHabilitado = async (usuarioId) => {
    const { rows } = await consulta(
        'SELECT habilitado FROM autenticacion_2fa WHERE usuario_id = $1',
        [usuarioId]
    );
    return rows[0]?.habilitado || false;
};

/**
 * Obtiene la configuración de 2FA de un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<Object>} Configuración de 2FA.
 */
export const obtenerConfiguracion2FA = async (usuarioId) => {
    const { rows } = await consulta(
        `SELECT usuario_id, secreto_totp_cifrado, totp_activado, totp_activado_en,
                correo_2fa_activado, correo_2fa_activado_en, habilitado, actualizado_en
         FROM autenticacion_2fa WHERE usuario_id = $1`,
        [usuarioId]
    );

    if (rows.length === 0) {
        return {
            usuarioId,
            totpActivado: false,
            correoActivado: false,
            habilitado: false
        };
    }

    return {
        usuarioId: rows[0].usuario_id,
        totpActivado: rows[0].totp_activado,
        totpActivadoEn: rows[0].totp_activado_en,
        correoActivado: rows[0].correo_2fa_activado,
        correoActivadoEn: rows[0].correo_2fa_activado_en,
        habilitado: rows[0].habilitado,
        actualizadoEn: rows[0].actualizado_en
    };
};

/**
 * Inicia el proceso de configuración de TOTP generando un nuevo secreto.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{secreto: string, uri: string}>} Secreto y URI para código QR.
 */
export const iniciarConfiguracionTotp = async (usuarioId) => {
    // Verificar si ya tiene TOTP configurado
    const config = await obtenerConfiguracion2FA(usuarioId);
    if (config.totpActivado) {
        throw new ErrorApp('Ya tienes TOTP configurado. Desactívalo primero.', 400);
    }

    // Generar nuevo secreto
    const secreto = generarSecretoTotp();

    // Guardar secreto temporalmente cifrado (se activará después de la confirmación)
    const secretoCifrado = cifrarTexto(secreto, env.TOTP_ENCRYPTION_KEY);

    // Guardar o actualizar registro
    await consulta(
        `INSERT INTO autenticacion_2fa (usuario_id, secreto_totp_cifrado, totp_activado, actualizado_en)
         VALUES ($1, $2, false, NOW())
         ON CONFLICT (usuario_id)
         DO UPDATE SET secreto_totp_cifrado = EXCLUDED.secreto_totp_cifrado, 
                       totp_activado = false, 
                       actualizado_en = NOW()`,
        [usuarioId, secretoCifrado]
    );

    // Generar URI para código QR
    const { rows: usuarioRow } = await consulta(
        'SELECT correo, nombre FROM usuarios WHERE id = $1',
        [usuarioId]
    );
    const usuario = usuarioRow[0];
    const issuername = 'ScrumFlow';
    const label = `${issuername}:${usuario.correo}`;
    const uri = `otpauth://totp/${label}?secret=${secreto}&issuer=${issuername}`;

    return { secreto, uri };
};

/**
 * Genera los códigos de respaldo que se entregan al activar el primer método de 2FA.
 * Si la generación falla no se revierte la activación: la persona puede generarlos
 * después desde su perfil, por eso se devuelve null y el error queda en el registro.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<string[]|null>} Los códigos en claro (solo se muestran una vez) o null si no se pudieron generar.
 */
const generarCodigosRespaldoIniciales = async (usuarioId) => {
    try {
        const { codigos } = await generarCodigosRespaldo(usuarioId);
        return codigos;
    } catch (error) {
        console.error('[auth.service] No se pudieron generar los códigos de respaldo iniciales:', error);
        return null;
    }
};

/**
 * Confirma y activa la configuración de TOTP con un código generado.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} codigo Código TOTP de 6 dígitos.
 * @returns {Promise<{mensaje: string, totpActivado: boolean, activadoAutomaticamente: boolean, codigos: string[]|null}>}
 *          Si era el primer método activo, el 2FA queda habilitado y se devuelven los códigos de respaldo recién generados.
 */
export const confirmarConfiguracionTotp = async (usuarioId, codigo) => {
    // Obtener el secreto temporal
    const { rows } = await consulta(
        'SELECT secreto_totp_cifrado FROM autenticacion_2fa WHERE usuario_id = $1',
        [usuarioId]
    );

    if (rows.length === 0 || !rows[0].secreto_totp_cifrado) {
        throw new ErrorApp('No hay configuración de TOTP en progreso.', 400);
    }

    // Descifrar el secreto
    const secreto = descifrarTexto(rows[0].secreto_totp_cifrado, env.TOTP_ENCRYPTION_KEY);

    // Verificar el código
    if (!verificarCodigototp(secreto, codigo)) {
        throw new ErrorApp('Código inválido o expirado.', 400);
    }

    // Activar TOTP. Si no había otro método activo, esta confirmación también habilita el 2FA
    const { rows: activado } = await consulta(
        `UPDATE autenticacion_2fa 
         SET totp_activado = true, totp_activado_en = NOW(),
             habilitado = CASE WHEN correo_2fa_activado = false THEN true ELSE habilitado END,
             actualizado_en = NOW()
         WHERE usuario_id = $1 AND totp_activado = false
         RETURNING correo_2fa_activado`,
        [usuarioId]
    );

    // Otra confirmación ya activó el método: no se habilita ni se generan códigos otra vez
    if (activado.length === 0) {
        return { mensaje: 'TOTP configurado correctamente', totpActivado: true, activadoAutomaticamente: false, codigos: null };
    }

    const esPrimerMetodo = !activado[0].correo_2fa_activado;
    const codigos = esPrimerMetodo ? await generarCodigosRespaldoIniciales(usuarioId) : null;

    return { mensaje: 'TOTP configurado correctamente', totpActivado: true, activadoAutomaticamente: esPrimerMetodo, codigos };
};

/**
 * Desactiva TOTP para un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} password Contraseña actual para verificación.
 * @returns {Promise<{mensaje: string, totpActivado: boolean}>}
 */
export const desactivarTotp = async (usuarioId, password) => {
    // Verificar contraseña
    await exigirPasswordVigente(usuarioId, password);

    // Verificar que no sea el único método activo
    const config = await obtenerConfiguracion2FA(usuarioId);
    const metodosActivos = [config.totpActivado, config.correoActivado].filter(Boolean).length;

    if (config.habilitado && metodosActivos <= 1) {
        throw new ErrorApp(
            'No puedes desactivar el único método de 2FA activo. Configura otro método primero o deshabilita el 2FA completamente.',
            403
        );
    }

    // Desactivar TOTP
    await consulta(
        `UPDATE autenticacion_2fa 
         SET secreto_totp_cifrado = NULL, totp_activado = false, totp_activado_en = NULL, 
         actualizado_en = NOW()
         WHERE usuario_id = $1`,
        [usuarioId]
    );

    // Si era el único método, deshabilitar 2FA completamente
    if (config.habilitado && metodosActivos <= 1) {
        await consulta(
            'UPDATE autenticacion_2fa SET habilitado = false, actualizado_en = NOW() WHERE usuario_id = $1',
            [usuarioId]
        );
    }

    return { mensaje: 'TOTP desactivado correctamente', totpActivado: false };
};

/**
 * Activa o desactiva 2FA por correo electrónico.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {boolean} activar True para activar, false para desactivar.
 * @param {string} [password] Contraseña actual (requerida para desactivar).
 * @param {string} [ip] Dirección IP de la solicitud (se registra al enviar el código de activación).
 * @param {string} [userAgent] User-Agent del navegador (se registra al enviar el código de activación).
 * @returns {Promise<{mensaje: string, correoActivado: boolean, pendienteVerificacion?: boolean}>}
 *          Al activar, el método queda pendiente hasta confirmar el código enviado (ver confirmarActivacionCorreo).
 */
export const configurar2FAPorCorreo = async (usuarioId, activar, password = null, ip = null, userAgent = null) => {
    if (activar) {
        // Activar 2FA por correo
        const config = await obtenerConfiguracion2FA(usuarioId);
        if (config.correoActivado) {
            return { mensaje: 'La autenticación por correo ya está activada', correoActivado: true, pendienteVerificacion: false };
        }

        // El método no cuenta como activo hasta que se confirme el código enviado al correo
        await consulta(
            `INSERT INTO autenticacion_2fa (usuario_id, actualizado_en)
             VALUES ($1, NOW())
             ON CONFLICT (usuario_id)
             DO UPDATE SET actualizado_en = NOW()`,
            [usuarioId]
        );

        await enviarCodigoOtpCorreo(usuarioId, ip, userAgent, true);

        return {
            mensaje: 'Te enviamos un código de verificación a tu correo. Ingrésalo para terminar de activar el método.',
            correoActivado: false,
            pendienteVerificacion: true
        };
    } else {
        // Desactivar requiere contraseña
        if (!password) {
            throw new ErrorApp('Contraseña requerida para desactivar.', 400);
        }

        // Verificar contraseña
        await exigirPasswordVigente(usuarioId, password);

        // Verificar que no sea el único método activo
        const config = await obtenerConfiguracion2FA(usuarioId);
        const metodosActivos = [config.totpActivado, config.correoActivado].filter(Boolean).length;

        if (config.habilitado && metodosActivos <= 1) {
            throw new ErrorApp(
                'No puedes desactivar el único método de 2FA activo. Configura otro método primero o deshabilita el 2FA completamente.',
                403
            );
        }

        // Desactivar
        await consulta(
            `UPDATE autenticacion_2fa 
             SET correo_2fa_activado = false, correo_2fa_activado_en = NULL, 
             actualizado_en = NOW()
             WHERE usuario_id = $1`,
            [usuarioId]
        );

        return { mensaje: 'Autenticación por correo desactivada', correoActivado: false };
    }
};

/**
 * Comprueba la contraseña actual antes de una acción sensible sobre el 2FA.
 * Una contraseña incorrecta responde 403 y no 401, porque el cliente trata un 401
 * como sesión caducada y cerraría la sesión de la persona.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} password Contraseña ingresada.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 404 si el usuario no existe, 403 si la contraseña es incorrecta.
 */
export const exigirPasswordVigente = async (usuarioId, password) => {
    const { rows } = await consulta(
        'SELECT password_hash FROM usuarios WHERE id = $1',
        [usuarioId]
    );

    if (rows.length === 0 || !rows[0].password_hash) {
        throw new ErrorApp('Usuario no encontrado.', 404);
    }

    const claveValida = await verificarPassword(password, rows[0].password_hash);
    if (!claveValida) {
        await gastarTiempoDeHash(password);
        throw new ErrorApp('Contraseña incorrecta.', 403);
    }
};

/**
 * Habilita o deshabilita el 2FA global para un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {boolean} habilitar True para habilitar, false para deshabilitar.
 * @param {string} [password] Contraseña actual (requerida para deshabilitar).
 * @returns {Promise<{mensaje: string, habilitado: boolean}>}
 */
export const configurar2FAHabilitado = async (usuarioId, habilitar, password = null) => {
    if (habilitar) {
        // Volver a habilitar también exige la contraseña
        if (!password) {
            throw new ErrorApp('Contraseña requerida para habilitar.', 400);
        }
        await exigirPasswordVigente(usuarioId, password);

        // Verificar que al menos un método esté activo
        const config = await obtenerConfiguracion2FA(usuarioId);
        if (!config.totpActivado && !config.correoActivado) {
            throw new ErrorApp(
                'Debes activar al menos un método de autenticación (TOTP o Correo) antes de habilitar el 2FA.',
                400
            );
        }

        await consulta(
            `INSERT INTO autenticacion_2fa (usuario_id, habilitado, actualizado_en)
             VALUES ($1, true, NOW())
             ON CONFLICT (usuario_id)
             DO UPDATE SET habilitado = true, actualizado_en = NOW()`,
            [usuarioId]
        );

        return { mensaje: '2FA habilitado correctamente', habilitado: true };
    } else {
        // Deshabilitar requiere contraseña
        if (!password) {
            throw new ErrorApp('Contraseña requerida para deshabilitar.', 400);
        }

        // Verificar contraseña
        await exigirPasswordVigente(usuarioId, password);

        // Los dispositivos de confianza no deben revivir al volver a habilitar el 2FA
        await revocarTodosDispositivosConfianza(usuarioId);

        // Deshabilitar 2FA
        await consulta(
            'UPDATE autenticacion_2fa SET habilitado = false, actualizado_en = NOW() WHERE usuario_id = $1',
            [usuarioId]
        );

        return { mensaje: '2FA deshabilitado correctamente', habilitado: false };
    }
};

/**
 * Genera y envía un código OTP por correo.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} ip Dirección IP de la solicitud.
 * @param {string} userAgent User-Agent del navegador.
 * @param {boolean} [paraActivacion=false] True cuando el código sirve para activar el método, que aún no está activo.
 * @returns {Promise<{mensaje: string}>}
 */
export const enviarCodigoOtpCorreo = async (usuarioId, ip, userAgent, paraActivacion = false) => {
    // Verificar que el método por correo esté activado
    const config = await obtenerConfiguracion2FA(usuarioId);
    if (!config.correoActivado && !paraActivacion) {
        throw new ErrorApp('Método de correo no está activado.', 400);
    }

    // Limpiar OTP antiguos de este usuario
    await consulta('DELETE FROM otp_correo WHERE usuario_id = $1', [usuarioId]);

    // Generar código OTP de 6 dígitos
    const codigo = randomInt(100000, 1000000).toString();
    const codigoHash = hashearCodigo(codigo);

    // Guardar OTP en BD
    await consulta(
        `INSERT INTO otp_correo (usuario_id, codigo_hash, expira_en, ip_solicitud, user_agent, creado_en)
         VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 minute'), $4, $5, NOW())`,
        [usuarioId, codigoHash, env.OTP_CORREO_MINUTOS, ip, userAgent]
    );

    // Obtener correo del usuario
    const { rows } = await consulta('SELECT correo, nombre FROM usuarios WHERE id = $1', [usuarioId]);
    const usuario = rows[0];

    // Enviar correo
    try {
        await enviarCorreo({
            para: usuario.correo,
            asunto: 'Código de verificación - ScrumFlow',
            html: `
                <div style="font-family: Arial, sans-serif; color: #333; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #055651;">Hola, ${usuario.nombre}!</h2>
                    <p>Tu código de verificación para iniciar sesión en <strong>ScrumFlow</strong> es:</p>
                    <div style="background: #f8f9fa; padding: 15px; margin: 20px 0; text-align: center; border-radius: 5px;">
                        <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #055651;">${codigo}</span>
                    </div>
                    <p>Este código expirará en <strong>${env.OTP_CORREO_MINUTOS} minutos</strong>.</p>
                    <p>Si no solicitaste este código, por favor ignora este mensaje o contacta a soporte.</p>
                    <br>
                    <p style="color: #666; font-size: 0.9rem;">Equipo de ScrumFlow</p>
                </div>
            `
        });
    } catch (errorCorreo) {
        console.error('[auth.service] No se pudo enviar el código OTP:', errorCorreo);
        // No lanzar error, el código ya está generado
    }

    return { mensaje: 'Código enviado a tu correo electrónico' };
};

/**
 * Verifica un código OTP recibido por correo.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} codigo Código de 6 dígitos.
 * @param {string} ip Dirección IP de la verificación.
 * @returns {Promise<boolean>} True si el código es válido.
 */
export const verificarCodigoOtpCorreo = async (usuarioId, codigo, ip) => {
    // Verificar intentos fallidos
    await contarIntento2FA(usuarioId);

    const codigoHash = hashearCodigo(codigo);

    // Actualización y validación atómica (Race Condition mitigation)
    const { rows: consumido } = await consulta(
        `UPDATE otp_correo 
         SET usado = true, usado_en = NOW() 
         WHERE usuario_id = $1 AND codigo_hash = $2 AND usado = FALSE AND expira_en > NOW() 
         RETURNING id`,
        [usuarioId, codigoHash]
    );

    // Si no se afectó ninguna fila, el código no existía, estaba expirado, o ya se usó.
    if (consumido.length === 0) {
        return false;
    }

    // Limpiar intentos fallidos
    await consulta('DELETE FROM intentos_2fa_usuario WHERE usuario_id = $1', [usuarioId]);

    return true;
};

/**
 * Confirma la activación del método por correo con el código enviado a la dirección de la persona.
 * El método no cuenta como activo, ni sirve para iniciar sesión, hasta que esta verificación sea correcta.
 * Si no había otro método activo, también habilita el 2FA y genera los códigos de respaldo.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} codigo Código de 6 dígitos recibido por correo.
 * @param {string} ip Dirección IP de la verificación.
 * @returns {Promise<{mensaje: string, correoActivado: boolean, activadoAutomaticamente: boolean, codigos: string[]|null}>}
 * @throws {ErrorApp} 400 si el código es inválido o no hay una activación en curso.
 */
export const confirmarActivacionCorreo = async (usuarioId, codigo, ip) => {
    const config = await obtenerConfiguracion2FA(usuarioId);
    if (config.correoActivado) {
        return { mensaje: 'La autenticación por correo ya está activada', correoActivado: true, activadoAutomaticamente: false, codigos: null };
    }

    const valido = await verificarCodigoOtpCorreo(usuarioId, codigo.trim(), ip);
    if (!valido) {
        throw new ErrorApp('Código inválido o expirado.', 400);
    }

    // Si no había otro método activo, esta confirmación también habilita el 2FA
    const { rows } = await consulta(
        `UPDATE autenticacion_2fa
         SET correo_2fa_activado = true, correo_2fa_activado_en = NOW(),
             habilitado = CASE WHEN totp_activado = false THEN true ELSE habilitado END,
             actualizado_en = NOW()
         WHERE usuario_id = $1 AND correo_2fa_activado = false
         RETURNING totp_activado`,
        [usuarioId]
    );

    if (rows.length === 0) {
        throw new ErrorApp('No hay una activación de correo en curso.', 400);
    }

    const esPrimerMetodo = !rows[0].totp_activado;
    const codigos = esPrimerMetodo ? await generarCodigosRespaldoIniciales(usuarioId) : null;

    return { mensaje: 'Autenticación por correo activada', correoActivado: true, activadoAutomaticamente: esPrimerMetodo, codigos };
};

/**
 * Genera códigos de respaldo para un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{codigos: string[], grupoId: string}>} Array de 10 códigos de respaldo.
 */
export const generarCodigosRespaldo = async (usuarioId) => {
    // Verificar que el usuario tenga 2FA activado
    const config = await obtenerConfiguracion2FA(usuarioId);
    if (!config.totpActivado && !config.correoActivado) {
        throw new ErrorApp(
            'Debes tener al menos un método de 2FA activo para generar códigos de respaldo.',
            400
        );
    }

    // Generar nuevo grupo ID
    const grupoId = randomUUID();

    // Invalidar códigos antiguos de este usuario
    await consulta(
        'UPDATE codigos_respaldo SET usado = true, usado_en = NOW() WHERE usuario_id = $1 AND usado = false',
        [usuarioId]
    );

    // Generar 10 nuevos códigos
    const codigos = [];
    for (let i = 0; i < 10; i++) {
        const codigo = generarCodigoRespaldo();
        const codigoHash = hashearCodigo(codigo);
        codigos.push(codigo);

        await consulta(
            `INSERT INTO codigos_respaldo (usuario_id, codigo_hash, grupo_id, creado_en)
             VALUES ($1, $2, $3, NOW())`,
            [usuarioId, codigoHash, grupoId]
        );
    }

    return { codigos, grupoId };
};

/**
 * Genera un código de respaldo alfanumérico.
 *
 * @returns {string} Código de respaldo en formato XXX-XXX-XXX.
 */
const generarCodigoRespaldo = () => {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let codigo = '';
    for (let i = 0; i < 11; i++) {
        if (i === 3 || i === 7) {
            codigo += '-';
        } else {
            const randomIndex = randomInt(0, caracteres.length);
            codigo += caracteres[randomIndex];
        }
    }
    return codigo;
};

/**
 * Verifica un código de respaldo.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} codigo Código de respaldo.
 * @param {string} ip Dirección IP de la verificación.
 * @returns {Promise<{valido: boolean, codigosRestantes: number}>}
 */
export const verificarCodigoRespaldo = async (usuarioId, codigo, ip) => {
    // Verificar intentos fallidos
    await contarIntento2FA(usuarioId);

    const codigoHash = hashearCodigo(codigo);

    // Actualización y validación atómica (Race Condition mitigation)
    const { rows: consumido } = await consulta(
        `UPDATE codigos_respaldo 
         SET usado = true, usado_en = NOW() 
         WHERE usuario_id = $1 AND codigo_hash = $2 AND usado = FALSE 
         RETURNING id`,
        [usuarioId, codigoHash]
    );

    // Si no se afectó ninguna fila, el código no existía o ya se usó.
    if (consumido.length === 0) {
        return { valido: false, codigosRestantes: 0 };
    }

    // Limpiar intentos fallidos
    await consulta('DELETE FROM intentos_2fa_usuario WHERE usuario_id = $1', [usuarioId]);

    // Contar códigos restantes
    const { rows: restantes } = await consulta(
        'SELECT COUNT(*) as count FROM codigos_respaldo WHERE usuario_id = $1 AND usado = FALSE',
        [usuarioId]
    );

    return { valido: true, codigosRestantes: parseInt(restantes[0].count, 10) };
};

/**
 * Obtiene información sobre los códigos de respaldo de un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<Object>} Información sobre códigos de respaldo.
 */
export const obtenerInfoCodigosRespaldo = async (usuarioId) => {
    const { rows } = await consulta(
        `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN usado = false THEN 1 ELSE 0 END) as restantes,
            MAX(creado_en) as generados_en
         FROM codigos_respaldo WHERE usuario_id = $1`,
        [usuarioId]
    );

    return {
        generados: rows[0].total > 0,
        total: parseInt(rows[0].total, 10),
        restantes: parseInt(rows[0].restantes, 10),
        generadosEn: rows[0].generados_en
    };
};

/**
 * Genera un token temporal para 2FA.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{token: string, expiraEn: Date}>}
 */
export const generarTokenTemporal2FA = async (usuarioId) => {
    const sidTemporal = randomUUID();
    const payload = { id: usuarioId, sid: sidTemporal, tipo: '2fa_temporal' };
    const token = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: `${env.TOKEN_2FA_TEMPORAL_MINUTOS}m`
    });

    // Guardar en tabla de tokens temporales (opcional, para mayor control)
    // Por ahora solo usamos JWT

    return { token, expiraEn: new Date(Date.now() + env.TOKEN_2FA_TEMPORAL_MINUTOS * 60000) };
};

/**
 * Verifica un token temporal de 2FA y devuelve el usuario.
 *
 * @param {string} token Token temporal.
 * @returns {Promise<number>} ID del usuario.
 * @throws {ErrorApp} Si el token es inválido o ha expirado.
 */
export const verificarTokenTemporal2FA = async (token) => {
    if (!token) {
        throw new ErrorApp('Token temporal no proporcionado.', 401);
    }

    let payload;
    try {
        payload = jwt.verify(token, env.JWT_SECRET);
    } catch (error) {
        throw new ErrorApp('Token temporal inválido o expirado.', 401);
    }

    if (payload.tipo !== '2fa_temporal') {
        throw new ErrorApp('Token no válido para verificación 2FA.', 401);
    }

    const { rows } = await consulta('SELECT 1 FROM tokens_revocados WHERE token = $1', [token]);
    if (rows.length > 0) {
        throw new ErrorApp('Token temporal inválido o expirado.', 401);
    }

    return payload.id;
};

/**
 * Consume un token temporal de 2FA al completar el inicio de sesión, de modo que no pueda
 * volver a usarse. La operación es atómica: si dos peticiones intentan consumir el mismo
 * token a la vez, solo una lo consigue.
 *
 * @author Citlaly Morales Viveros
 * @param {string} token Token temporal ya verificado.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 401 si el token ya había sido consumido.
 */
export const consumirTokenTemporal2FA = async (token) => {
    const consumido = await revocarToken(token, env.TOKEN_2FA_TEMPORAL_MINUTOS);
    if (!consumido) {
        throw new ErrorApp('Token temporal inválido o expirado.', 401);
    }
};

/**
 * Verifica un código TOTP para un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} codigo Código de 6 dígitos.
 * @param {string} ip Dirección IP de la verificación.
 * @returns {Promise<boolean>} True si el código es válido.
 */
export const verificarCodigoTotp = async (usuarioId, codigo, ip) => {
    // Verificar intentos fallidos
    await contarIntento2FA(usuarioId);

    // Obtener secreto TOTP
    const { rows } = await consulta(
        'SELECT secreto_totp_cifrado FROM autenticacion_2fa WHERE usuario_id = $1 AND totp_activado = true',
        [usuarioId]
    );

    if (rows.length === 0 || !rows[0].secreto_totp_cifrado) {
        return false;
    }

    // Descifrar secreto
    const secreto = descifrarTexto(rows[0].secreto_totp_cifrado, env.TOTP_ENCRYPTION_KEY);

    // Verificar código
    const valido = verificarCodigototp(secreto, codigo);

    if (!valido) {
        return false;
    }

    // Limpiar intentos fallidos
    await consulta('DELETE FROM intentos_2fa_usuario WHERE usuario_id = $1', [usuarioId]);

    return true;
};

/**
 * Cuenta un intento de verificación 2FA para la cuenta y corta el paso cuando ya se agotaron.
 * El intento se cuenta antes de comprobar el código, en una sola sentencia, para que varias
 * peticiones en paralelo no puedan adivinar más veces de las permitidas. Si el código resulta
 * correcto, quien llama borra el contador. El bloqueo dura BLOQUEO_MINUTOS desde el último
 * intento permitido, y pasado ese tiempo el conteo empieza de nuevo.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 429 si la cuenta ya agotó sus intentos de verificación.
 */
const contarIntento2FA = async (usuarioId) => {
    const { rows } = await consulta(
        `INSERT INTO intentos_2fa_usuario (usuario_id, intentos, ultimo_intento)
         VALUES ($1, 1, NOW())
         ON CONFLICT (usuario_id) DO UPDATE SET
            intentos = CASE
                WHEN intentos_2fa_usuario.ultimo_intento < NOW() - ($3::int * INTERVAL '1 minute') THEN 1
                ELSE intentos_2fa_usuario.intentos + 1
            END,
            ultimo_intento = CASE
                WHEN intentos_2fa_usuario.intentos >= $2::int
                     AND intentos_2fa_usuario.ultimo_intento >= NOW() - ($3::int * INTERVAL '1 minute')
                THEN intentos_2fa_usuario.ultimo_intento
                ELSE NOW()
            END
         RETURNING intentos, CEIL(EXTRACT(EPOCH FROM (
             ultimo_intento + ($3::int * INTERVAL '1 minute') - NOW()
         )))::int AS reintento_segundos`,
        [usuarioId, env.MAX_INTENTOS_2FA, env.BLOQUEO_MINUTOS]
    );

    if (rows[0].intentos > env.MAX_INTENTOS_2FA) {
        const minutos = Math.max(1, Math.ceil(rows[0].reintento_segundos / 60));
        throw new ErrorApp(
            `Demasiados intentos fallidos de verificación 2FA. Podrás reintentar en ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
            429
        );
    }
};

/**
 * Genera un hash único para identificar un dispositivo.
 *
 * @param {string} ip Dirección IP.
 * @param {string} userAgent User-Agent del navegador.
 * @returns {string} Hash del dispositivo.
 */
const generarDispositivoHash = (ip, userAgent) => {
    const texto = `${ip}:${userAgent}`;
    return createHash('sha256').update(texto).digest('hex');
};

/**
 * Genera un token de confianza para un dispositivo.
 *
 * @returns {string} Token de confianza.
 */
const generarTokenConfianza = () => {
    return randomBytes(32).toString('hex');
};

/**
 * Registra un dispositivo de confianza.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} ip Dirección IP.
 * @param {string} userAgent User-Agent del navegador.
 * @param {string} [nombre] Nombre opcional del dispositivo.
 * @returns {Promise<{tokenConfianza: string, expiraEn: Date}>}
 */
export const registrarDispositivoConfianza = async (usuarioId, ip, userAgent, nombre = null) => {
    const dispositivoHash = generarDispositivoHash(ip, userAgent);
    const tokenConfianza = generarTokenConfianza();
    const expiraEn = new Date(Date.now() + 14 * 24 * 60 * 60000); // 14 días

    // En la base solo se guarda el hash del token; el valor en claro viaja únicamente en la cookie
    await consulta(
        `INSERT INTO dispositivos_confianza 
         (id, usuario_id, dispositivo_hash, token_confianza, ip_registro, user_agent, nombre, expira_en, creado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [randomUUID(), usuarioId, dispositivoHash, hashearCodigo(tokenConfianza), ip, userAgent, nombre, expiraEn]
    );

    return {
        tokenConfianza,
        expiraEn
    };
};

// Los tokens salen de 32 bytes en hexadecimal; cualquier otro formato se descarta sin consultar la base
const FORMATO_TOKEN_CONFIANZA = /^[0-9a-f]{64}$/;

/**
 * Verifica si un dispositivo es de confianza a partir del token de su cookie. La IP y el
 * navegador ya no cuentan: solo vale el token que se entregó al registrar el dispositivo.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} tokenConfianza Token de confianza recibido en la cookie tokenConfianza.
 * @returns {Promise<boolean>} True si el token pertenece a ese usuario, no está revocado y no ha expirado.
 */
export const esDispositivoDeConfianza = async (usuarioId, tokenConfianza) => {
    if (typeof tokenConfianza !== 'string' || !FORMATO_TOKEN_CONFIANZA.test(tokenConfianza)) {
        return false;
    }

    // Si tenemos token de confianza, verificar directamente
    const { rows } = await consulta(
        `SELECT 1 FROM dispositivos_confianza 
         WHERE usuario_id = $1 AND token_confianza = $2 
         AND revocado = false AND expira_en > NOW()`,
        [usuarioId, hashearCodigo(tokenConfianza)]
    );
    return rows.length > 0;
};

/**
 * Obtiene la lista de dispositivos de confianza de un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<Array>} Lista de dispositivos.
 */
export const listarDispositivosConfianza = async (usuarioId) => {
    const { rows } = await consulta(
        `SELECT id, nombre, ip_registro, user_agent, creado_en, expira_en, revocado, revocado_en
         FROM dispositivos_confianza 
         WHERE usuario_id = $1 
         ORDER BY creado_en DESC`,
        [usuarioId]
    );

    return rows.map(row => ({
        id: row.id,
        nombre: row.nombre,
        ipRegistro: row.ip_registro,
        userAgent: row.user_agent,
        creadoEn: row.creado_en,
        expiraEn: row.expira_en,
        revocado: row.revocado,
        revocadoEn: row.revocado_en
    }));
};

/**
 * Revoca un dispositivo de confianza.
 *
 * @param {number} usuarioId ID del usuario.
 * @param {string} dispositivoId ID del dispositivo.
 * @returns {Promise<void>}
 */
export const revocarDispositivoConfianza = async (usuarioId, dispositivoId) => {
    await consulta(
        `UPDATE dispositivos_confianza 
         SET revocado = true, revocado_en = NOW()
         WHERE id = $1 AND usuario_id = $2`,
        [dispositivoId, usuarioId]
    );
};

/**
 * Revoca todos los dispositivos de confianza de un usuario.
 *
 * @param {number} usuarioId ID del usuario.
 * @returns {Promise<{dispositivosRevocados: number}>}
 */
export const revocarTodosDispositivosConfianza = async (usuarioId) => {
    const { rows } = await consulta(
        `UPDATE dispositivos_confianza 
         SET revocado = true, revocado_en = NOW()
         WHERE usuario_id = $1 AND revocado = false
         RETURNING id`,
        [usuarioId]
    );

    return { dispositivosRevocados: rows.length };
};