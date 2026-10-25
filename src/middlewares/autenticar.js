import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { consulta } from '../config/db.js';
import { ErrorApp } from '../utils/ErrorApp.js';
import { asyncHandler } from '../utils/asyncHandler.js'

/**
 * @file autenticar.js
 * @description Middleware para verificar y validar la sesión o token de usuario mediante cookies httpOnly.
 * @author Citlaly Morales Viveros
 */
export const autenticar = asyncHandler(async (req, res, next) => {
  let token;
  const cookieHeader = req.headers.cookie;

  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, current) => {
      const [key, value] = current.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});
    token = cookies.accessToken;
  }

  if (!token && req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new ErrorApp('No has iniciado sesión.', 401));
  }

  const { rows: revocados } = await consulta('SELECT 1 FROM tokens_revocados WHERE token = $1', [token]);
  if (revocados.length > 0) {
    return next(new ErrorApp('Sesión finalizada o token inválido.', 401));
  }

  try {
    const decodificado = jwt.verify(token, env.JWT_SECRET);
    req.user = decodificado;
    next();
  } catch (error) {
    return next(new ErrorApp('Token inválido o expirado.', 401));
  }
});

export default autenticar;