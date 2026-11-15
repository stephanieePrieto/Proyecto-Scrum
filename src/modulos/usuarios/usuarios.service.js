/**
 * @file usuarios.service.js
 * @description Lógica de negocio para la gestión de usuarios y recuperación de contraseñas.
 * 
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { hashearPassword } from '../../utils/hash.js';
import { esPasswordFuerte } from '../../utils/validar.js';
import crypto from 'crypto';
import { consulta } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enviarCorreo } from '../../utils/correo.js';
import { leerPreferencias, normalizarPreferencias } from '../notificaciones/notificaciones.service.js';

/** Valores por defecto de la apariencia y la accesibilidad de la persona. */
export const PREFERENCIAS_APP_POR_DEFECTO = Object.freeze({ tema: 'claro', textoGrande: false, altoContraste: false, reducirAnimaciones: false });
/** Temas que acepta la aplicación. */
const TEMAS_APP = Object.freeze(['claro', 'oscuro']);
const CLAVES_APP_BOOLEANAS = Object.freeze(['textoGrande', 'altoContraste', 'reducirAnimaciones']);

import { mkdirSync, promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Genera un token de recuperación y lo envía por correo.
 *
 * @param {string} correo - Correo del usuario que solicita la recuperación.
 * @returns {Promise<void>}
 */
export const solicitarRecuperacion = async (correo) => {
    const { rows } = await consulta('SELECT id, nombre FROM usuarios WHERE correo = $1 AND activo = TRUE', [correo.trim().toLowerCase()]);
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

/**
 * Define la contraseña de un usuario nuevo (alta directa).
 * @param {string} tokenPlano - Token de recuperación (usado para definir contraseña).
 * @param {string} nuevaPassword - Nueva contraseña.
 * @returns {Promise<void>}
 */
export const definirPassword = async (tokenPlano, nuevaPassword) => {
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');

    const { rows } = await consulta(
        `SELECT tr.id, tr.usuario_id, u.correo
        FROM tokens_recuperacion tr
        JOIN usuarios u ON u.id = tr.usuario_id
        WHERE tr.token_hash = $1 AND tr.usado = FALSE AND tr.expira_en > NOW()`,
        [tokenHash]
    );

    const registroToken = rows[0];
    if (!registroToken) {
        throw new ErrorApp('El enlace para definir contraseña es inválido o ha expirado.', 400);
    }

    if (!esPasswordFuerte(nuevaPassword)) {
        throw new ErrorApp('La contraseña no cumple los requisitos de seguridad.', 400);
    }

    const passwordHash = await hashearPassword(nuevaPassword);
    await consulta('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [passwordHash, registroToken.usuario_id]);
    await consulta('UPDATE tokens_recuperacion SET usado = TRUE WHERE id = $1', [registroToken.id]);

    await enviarCorreo({
        para: registroToken.correo,
        asunto: 'Bienvenido a ScrumFlow',
        texto: `Hola,\n\nTu contraseña ha sido definida correctamente. Ahora puedes iniciar sesión en:\n${env.APP_URL}/pages/login.html`,
    });
};

/**
 * Obtiene los datos del perfil de la persona con la sesión iniciada.
 * El correo se entrega solo para mostrarlo: este módulo no lo modifica.
 *
 * @param {number} usuarioId - Identificador de la persona autenticada.
 * @returns {Promise<{id: number, nombre: string, correo: string, fotoUrl: string|null}>}
 * @throws {ErrorApp} 404 si la cuenta no existe o está inactiva.
 */
export const obtenerPerfil = async (usuarioId) => {
    const { rows } = await consulta(
        'SELECT id, nombre, correo, foto_url, zona_horaria, preferencias_notif, preferencias_app FROM usuarios WHERE id = $1 AND activo = TRUE',
        [usuarioId]
    );
    const usuario = rows[0];

    if (!usuario) {
        throw new ErrorApp('No se encontró tu cuenta.', 404);
    }

    return {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        fotoUrl: usuario.foto_url ?? null,
        zonaHoraria: usuario.zona_horaria ?? null,
        preferenciasNotif: leerPreferencias(usuario.preferencias_notif),
        preferenciasApp: leerPreferenciasApp(usuario.preferencias_app)
    };
};

/** Formato de un identificador IANA, por ejemplo "America/Mexico_City" o "UTC". */
const PATRON_ZONA_HORARIA = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/**
 * Guarda la zona horaria de la persona con la sesión iniciada. Solo acepta zonas que PostgreSQL
 * reconoce, porque otros módulos las usan en sus consultas SQL.
 *
 * @param {number} usuarioId - Identificador de la persona autenticada.
 * @param {*} zonaHoraria - Identificador IANA elegido por la persona.
 * @returns {Promise<{zonaHoraria: string}>}
 * @throws {ErrorApp} 400 si la zona no es válida; 404 si la cuenta no existe o está inactiva.
 */
export const actualizarZonaHoraria = async (usuarioId, zonaHoraria) => {
    if (typeof zonaHoraria !== 'string' || zonaHoraria.length > 64 || !PATRON_ZONA_HORARIA.test(zonaHoraria)) {
        throw new ErrorApp('La zona horaria no es válida.', 400);
    }

    const { rows: zonas } = await consulta('SELECT name FROM pg_timezone_names WHERE name = $1', [zonaHoraria]);
    if (zonas.length === 0) {
        throw new ErrorApp('La zona horaria no es válida.', 400);
    }

    const { rows } = await consulta(
        'UPDATE usuarios SET zona_horaria = $1 WHERE id = $2 AND activo = TRUE RETURNING zona_horaria',
        [zonaHoraria, usuarioId]
    );
    if (rows.length === 0) {
        throw new ErrorApp('No se encontró tu cuenta.', 404);
    }

    return { zonaHoraria: rows[0].zona_horaria };
};

/**
 * Guarda las preferencias de notificación (canal interna y canal correo, por tipo) de la persona
 * con la sesión iniciada. Solo acepta la forma de PREFERENCIAS_POR_DEFECTO.
 *
 * @param {number} usuarioId - Identificador de la persona autenticada.
 * @param {*} entrada - Matriz enviada por la persona.
 * @returns {Promise<{preferenciasNotif: Object}>} Preferencias confirmadas por la base.
 * @throws {ErrorApp} 400 si la matriz no es válida; 404 si la cuenta no existe o está inactiva.
 */
export const actualizarPreferenciasNotificacion = async (usuarioId, entrada) => {
    const preferencias = normalizarPreferencias(entrada);
    if (!preferencias) {
        throw new ErrorApp('Las preferencias de notificación no son válidas.', 400);
    }

    const { rows } = await consulta(
        'UPDATE usuarios SET preferencias_notif = $1 WHERE id = $2 AND activo = TRUE RETURNING preferencias_notif',
        [JSON.stringify(preferencias), usuarioId]
    );
    if (rows.length === 0) {
        throw new ErrorApp('No se encontró tu cuenta.', 404);
    }

    return { preferenciasNotif: rows[0].preferencias_notif };
};

/**
 * Lee las preferencias de apariencia guardadas. Lo que falte o no sea válido toma su valor por defecto.
 *
 * @param {*} guardado - Valor de la columna JSONB preferencias_app.
 * @returns {{tema: string, textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}}
 */
export function leerPreferenciasApp(guardado) {
    const valores = guardado !== null && typeof guardado === 'object' && !Array.isArray(guardado) ? guardado : {};
    const salida = {
        tema: TEMAS_APP.includes(valores.tema) ? valores.tema : PREFERENCIAS_APP_POR_DEFECTO.tema,
    };
    for (const clave of CLAVES_APP_BOOLEANAS) {
        salida[clave] = typeof valores[clave] === 'boolean' ? valores[clave] : PREFERENCIAS_APP_POR_DEFECTO[clave];
    }
    return salida;
}

/**
 * Valida la entrada estricta de apariencia: exactamente las claves conocidas, con tema válido y booleanos.
 *
 * @param {*} entrada - Valor sin confiar (cuerpo de la petición).
 * @returns {{tema: string, textoGrande: boolean, altoContraste: boolean, reducirAnimaciones: boolean}|null}
 */
export function normalizarPreferenciasApp(entrada) {
    if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) return null;
    const claves = Object.keys(PREFERENCIAS_APP_POR_DEFECTO);
    if (Object.keys(entrada).length !== claves.length || !TEMAS_APP.includes(entrada.tema)) return null;
    for (const clave of CLAVES_APP_BOOLEANAS) {
        if (typeof entrada[clave] !== 'boolean') return null;
    }
    return {
        tema: entrada.tema,
        textoGrande: entrada.textoGrande,
        altoContraste: entrada.altoContraste,
        reducirAnimaciones: entrada.reducirAnimaciones,
    };
}

/**
 * Guarda las preferencias de apariencia y accesibilidad de la persona con la sesión iniciada.
 *
 * @param {number} usuarioId - Identificador de la persona autenticada.
 * @param {*} entrada - Preferencias completas enviadas por la persona.
 * @returns {Promise<{preferenciasApp: Object}>} Preferencias confirmadas por la base.
 * @throws {ErrorApp} 400 si la entrada no es válida; 404 si la cuenta no existe o está inactiva.
 */
export const actualizarPreferenciasApp = async (usuarioId, entrada) => {
    const preferencias = normalizarPreferenciasApp(entrada);
    if (!preferencias) {
        throw new ErrorApp('Las preferencias de apariencia no son válidas.', 400);
    }

    const { rows } = await consulta(
        'UPDATE usuarios SET preferencias_app = $1 WHERE id = $2 AND activo = TRUE RETURNING preferencias_app',
        [JSON.stringify(preferencias), usuarioId]
    );
    if (rows.length === 0) {
        throw new ErrorApp('No se encontró tu cuenta.', 404);
    }

    return { preferenciasApp: leerPreferenciasApp(rows[0].preferencias_app) };
};

/** Peso máximo de la foto de perfil. */
export const LIMITE_FOTO_BYTES = 2 * 1024 * 1024;

/** Mensaje cuando el formato de la foto no es uno de los permitidos. */
export const MENSAJE_FORMATO_FOTO = 'Formato no permitido. Usa una imagen JPEG, PNG o WebP.';

/** Carpeta donde se guardan las fotos (raíz del proyecto / uploads / avatares), fuera de public. */
export const CARPETA_AVATARES = path.resolve(
    fileURLToPath(new URL('../../../uploads/avatares', import.meta.url))
);

mkdirSync(CARPETA_AVATARES, { recursive: true });

/** Ruta con la que se sirven las fotos; es lo que se guarda en usuarios.foto_url. */
const RUTA_FOTO = '/api/usuarios/foto';

/** Formatos aceptados con la extensión con la que se guardan. SVG no se acepta. */
const FORMATOS_FOTO = Object.freeze({
    jpeg: { extension: '.jpg', mime: 'image/jpeg' },
    png: { extension: '.png', mime: 'image/png' },
    webp: { extension: '.webp', mime: 'image/webp' }
});

/** Tipos MIME que se dejan pasar a la validación del contenido. */
export const MIMES_FOTO = new Set(Object.values(FORMATOS_FOTO).map((formato) => formato.mime));

/** Nombre con el que se guarda una foto: UUID y una de las extensiones permitidas. */
const PATRON_ARCHIVO_FOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/**
 * Reconoce el formato real de una imagen por sus primeros bytes, sin fiarse del nombre ni del tipo
 * que declara el navegador.
 *
 * @param {Buffer} contenido - Contenido del archivo.
 * @returns {'jpeg'|'png'|'webp'|null} El formato, o null si no es JPEG, PNG ni WebP.
 */
export const detectarFormatoFoto = (contenido) => {
    if (!Buffer.isBuffer(contenido) || contenido.length < 12) {
        return null;
    }
    if (contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) {
        return 'jpeg';
    }
    if (contenido.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'png';
    }
    if (contenido.toString('latin1', 0, 4) === 'RIFF' && contenido.toString('latin1', 8, 12) === 'WEBP') {
        return 'webp';
    }
    return null;
};

/**
 * Borra una foto de la carpeta sin lanzar error si ya no existe. Ignora nombres que no tengan
 * el formato con el que se guardan, para no tocar otros archivos.
 *
 * @param {string|null} nombreArchivo - Nombre guardado en disco.
 * @returns {Promise<void>}
 */
const borrarFoto = async (nombreArchivo) => {
    if (typeof nombreArchivo !== 'string' || !PATRON_ARCHIVO_FOTO.test(nombreArchivo)) {
        return;
    }
    await fsp.unlink(path.join(CARPETA_AVATARES, nombreArchivo)).catch(() => { });
};

/**
 * Obtiene el nombre del archivo a partir de lo guardado en usuarios.foto_url.
 *
 * @param {string|null} fotoUrl
 * @returns {string|null}
 */
const nombreDeFoto = (fotoUrl) =>
    typeof fotoUrl === 'string' && fotoUrl.startsWith(`${RUTA_FOTO}/`)
        ? fotoUrl.slice(RUTA_FOTO.length + 1)
        : null;

/**
 * Valida y guarda la foto de perfil de la persona con la sesión iniciada, y borra la anterior.
 * Si algo falla después de escribir el archivo, lo elimina para no dejar basura.
 *
 * @param {number} usuarioId - Identificador de la persona autenticada.
 * @param {{buffer: Buffer, size: number}|undefined} archivo - Archivo recibido por multer en memoria.
 * @returns {Promise<{fotoUrl: string}>} Ruta con la que se sirve la nueva foto.
 * @throws {ErrorApp} 400 sin archivo o vacío; 413 si supera 2 MB; 415 si el formato no está permitido;
 *   404 si la cuenta no existe o está inactiva; 500 si falla el almacenamiento.
 */
export const actualizarFoto = async (usuarioId, archivo) => {
    if (!archivo || !Buffer.isBuffer(archivo.buffer)) {
        throw new ErrorApp('Selecciona una foto para guardar.', 400);
    }
    if (!archivo.size || archivo.size <= 0) {
        throw new ErrorApp('La foto está vacía.', 400);
    }
    if (archivo.size > LIMITE_FOTO_BYTES) {
        throw new ErrorApp('La foto supera el límite de 2 MB.', 413);
    }

    const formato = detectarFormatoFoto(archivo.buffer);
    if (!formato) {
        throw new ErrorApp(MENSAJE_FORMATO_FOTO, 415);
    }

    const nombreArchivo = `${crypto.randomUUID()}${FORMATOS_FOTO[formato].extension}`;

    try {
        await fsp.mkdir(CARPETA_AVATARES, { recursive: true });
        await fsp.writeFile(path.join(CARPETA_AVATARES, nombreArchivo), archivo.buffer, { flag: 'wx' });
    } catch (error) {
        console.error('[usuarios] No se pudo guardar la foto en disco:', error.message);
        throw new ErrorApp('No se pudo guardar la foto. Inténtalo de nuevo.', 500);
    }

    let fotoAnterior;
    try {
        const { rows } = await consulta(
            `UPDATE usuarios u SET foto_url = $1
               FROM (SELECT id, foto_url AS anterior FROM usuarios WHERE id = $2 FOR UPDATE) v
              WHERE u.id = v.id AND u.activo = TRUE
          RETURNING v.anterior`,
            [`${RUTA_FOTO}/${nombreArchivo}`, usuarioId]
        );
        if (rows.length === 0) {
            throw new ErrorApp('No se encontró tu cuenta.', 404);
        }
        fotoAnterior = rows[0].anterior;
    } catch (error) {
        await borrarFoto(nombreArchivo);
        if (error instanceof ErrorApp) {
            throw error;
        }
        console.error('[usuarios] No se pudo actualizar la foto en la base de datos:', error.message);
        throw new ErrorApp('No se pudo guardar la foto. Inténtalo de nuevo.', 500);
    }

    await borrarFoto(nombreDeFoto(fotoAnterior));

    return { fotoUrl: `${RUTA_FOTO}/${nombreArchivo}` };
};

/**
 * Comprueba que el nombre pedido sea el de una foto guardada por este módulo. Rechaza cualquier otro
 * valor, así no se puede salir de la carpeta de fotos.
 *
 * @param {string} archivo - Nombre recibido en la ruta.
 * @returns {string} El mismo nombre, ya validado.
 * @throws {ErrorApp} 404 si el nombre no tiene el formato esperado.
 */
export const validarNombreFoto = (archivo) => {
    if (typeof archivo !== 'string' || !PATRON_ARCHIVO_FOTO.test(archivo)) {
        throw new ErrorApp('La foto no existe.', 404);
    }
    return archivo;
};