/**
 * @file validar.js
 * @description Funciones de validación de datos de entrada.
 * @author Citlaly Morales Viveros
 */

/**
 * Valida si una cadena tiene formato de correo electrónico.
 *
 * @param {string} correo - El correo a validar.
 * @returns {boolean} Verdadero si es válido, falso en caso contrario.
 */
export const esCorreoValido = (correo) => {
    const expresion = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return expresion.test(correo);
};

/**
 * Valida la fortaleza de una contraseña.
 * Requiere mínimo 8 caracteres.
 *
 * @param {string} password - La contraseña a validar.
 * @returns {boolean} Verdadero si cumple los requisitos.
 */
export const esPasswordFuerte = (password) => {
    return typeof password === 'string' && password.length >= 8;
};