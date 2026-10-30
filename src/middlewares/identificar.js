// TEMPORAL - HU-20 (Alfonso): identifica a la persona de la petición mientras no todos los módulos usan `autenticar`.
/**
 * @file identificar.js
 * @description Deja a la persona de la petición en `req.user`.
 *  - Con USUARIO_DEMO_ID definido en el .env (y NODE_ENV distinto de "production"), usa ese usuario.
 *  - En cualquier otro caso delega en `autenticar` (cookie httpOnly o Bearer).
 *  Exporta `identificar` con nombre y por defecto.
 */
import { autenticar } from './autenticar.js';

/**
 * Identifica a la persona que hace la petición.
 * @param {import('express').Request} req Petición.
 * @param {import('express').Response} res Respuesta.
 * @param {import('express').NextFunction} next Siguiente middleware.
 * @returns {void}
 */
export function identificar(req, res, next) {
  const idDemo = Number(process.env.USUARIO_DEMO_ID);
  if (process.env.NODE_ENV !== 'production' && Number.isInteger(idDemo) && idDemo > 0) {
    req.user = { id: idDemo };
    return next();
  }
  return autenticar(req, res, next);
}

export default identificar;