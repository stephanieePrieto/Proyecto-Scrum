/**
 * @file asyncHandler.js
 * @description Middleware de utilería para el manejo de controladores asíncronos (HU-47).
 * Captura automáticamente las promesas rechazadas y redirige los errores
 * al middleware global de Express evitando bloqueos en el servidor.
 * @author Stephanie Elizdeth Hernández Prieto (Tracker / Programadora XP)
 */

/**
 * Función de orden superior que envuelve una función de controlador asíncrona.
 * Intercepta cualquier excepción o promesa rechazada y la transfiere al
 * siguiente middleware de manejo de errores mediante next().
 *
 * @function asyncHandler
 * @param {function(import('express').Request, import('express').Response, import('express').NextFunction): Promise<void>} fn Función asíncrona del controlador Express a ejecutar.
 * @returns {function(import('express').Request, import('express').Response, import('express').NextFunction): void} Función middleware de Express protegida contra excepciones no capturadas.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;