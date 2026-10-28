/**
 * @file hash.js
 * @description Hash y verificación de contraseñas utilizando exclusivamente Bcrypt.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import bcrypt from 'bcryptjs';

/**
 * Número de rondas de sal (salt rounds) recomendadas para bcrypt.
 * @type {number}
 */
const SALT_ROUNDS = 10;

/**
 * Genera el hash Bcrypt de una contraseña (la sal es aleatoria y va incluida).
 *
 * @param {string} password - Contraseña en texto plano.
 * @returns {Promise<string>} Hash listo para guardar en usuarios.password_hash.
 */
export const hashearPassword = async (password) => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Verifica una contraseña contra un hash Bcrypt.
 * Nunca lanza error: ante entradas inválidas o hash corrupto devuelve false.
 *
 * @param {string} password - Contraseña en texto plano.
 * @param {string|null} hash - Hash guardado (puede ser null en usuarios invitados).
 * @returns {Promise<boolean>} true si la contraseña coincide.
 */
export const verificarPassword = async (password, hash) => {
  if (typeof password !== 'string' || typeof hash !== 'string' || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
};

/**
 * En esta versión unificada con Bcrypt, ya no se requiere migración de hashes antiguos,
 * por lo que siempre devuelve false (a menos que se requiera actualizar rondas en el futuro).
 *
 * @param {string} hash - Hash guardado.
 * @returns {boolean}
 */
export const necesitaRehash = (hash) => {
  // Opcional: si quisieras verificar si el costo de salt cambió, se podría implementar,
  // pero al ser unificado con Bcrypt, por defecto no es obligatorio hacer rehash.
  return false;
};

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