/**
 * @file hash.js
 * @description Hash y verificación de contraseñas con Argon2id (OWASP).
 * Mantiene compatibilidad con hashes bcrypt anteriores y permite migrarlos
 * de forma transparente en el siguiente inicio de sesión.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

/**
 * Parámetros Argon2id recomendados por OWASP (19 MiB de memoria, 2 iteraciones).
 * @type {{type: number, memoryCost: number, timeCost: number, parallelism: number}}
 */
const OPCIONES_ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Indica si un hash fue generado con bcrypt ($2a$, $2b$ o $2y$).
 *
 * @param {string} hash - Hash almacenado.
 * @returns {boolean}
 */
const esHashBcrypt = (hash) => /^\$2[aby]\$/.test(hash);

/**
 * Genera el hash Argon2id de una contraseña (la sal es aleatoria y va incluida).
 *
 * @param {string} password - Contraseña en texto plano.
 * @returns {Promise<string>} Hash listo para guardar en usuarios.password_hash.
 */
export const hashearPassword = (password) => argon2.hash(password, OPCIONES_ARGON2);

/**
 * Verifica una contraseña contra un hash Argon2id o bcrypt.
 * Nunca lanza error: ante entradas inválidas o hash corrupto devuelve false.
 *
 * @param {string} password - Contraseña en texto plano.
 * @param {string|null} hash - Hash guardado (puede ser null en usuarios invitados).
 * @returns {Promise<boolean>} true si la contraseña coincide.
 */
export const verificarPassword = async (password, hash) => {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) return false;
  try {
    return esHashBcrypt(hash) ? await bcrypt.compare(password, hash) : await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

/**
 * Indica si el hash debe regenerarse (es bcrypt o usa parámetros antiguos).
 *
 * @param {string} hash - Hash guardado.
 * @returns {boolean}
 */
export const necesitaRehash = (hash) => esHashBcrypt(hash) || argon2.needsRehash(hash, OPCIONES_ARGON2);

/** Hash falso para igualar tiempos de respuesta cuando el correo no existe. */
const HASH_SENUELO = await hashearPassword('senuelo-no-es-una-contrasena-real');

/**
 * Consume el mismo tiempo que una verificación real. Se usa cuando el usuario
 * no existe, para que el tiempo de respuesta no revele qué correos están registrados.
 *
 * @param {string} password - Contraseña recibida.
 * @returns {Promise<boolean>} Siempre false.
 */
export const gastarTiempoDeHash = (password) => verificarPassword(password, HASH_SENUELO);