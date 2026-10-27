import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { consulta } from '../config/db.js';
import { ErrorApp } from '../utils/ErrorApp.js';
import { asyncHandler } from '../utils/asyncHandler.js'
import { evaluarSesion, errorDeSesion } from '../modulos/auth/auth.service.js';
import { leerCookies, terminarSesion } from '../modulos/auth/auth.controller.js';

/**
 * @file autenticar.js
 * @description Middleware para verificar y validar la sesión o token de usuario mediante cookies httpOnly.
 * @author Citlaly Morales Viveros
 */
/**
 * Lee la cabecera con los segundos transcurridos desde la última interacción humana en el navegador.
 *
 * @param {import('express').Request} req
 * @returns {number|null} Segundos; null si falta, no es un entero válido o supera el límite de inactividad.
 */
const leerEdadInteraccion = (req) => {
  const valor = req.headers['x-interaccion-segundos'];
  if (typeof valor !== 'string' || !/^\d{1,6}$/.test(valor)) return null;

  const segundos = Number(valor);
  return segundos <= env.INACTIVIDAD_MINUTOS * 60 ? segundos : null;
};

export const autenticar = asyncHandler(async (req, res, next) => {
  const cookies = leerCookies(req);
  let token = cookies.accessToken;

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

  let decodificado;
  try {
    decodificado = jwt.verify(token, env.JWT_SECRET);
  } catch (error) {
    return next(new ErrorApp('Token inválido o expirado.', 401));
  }

  // Los tokens emitidos antes del control de sesiones no traen sid y ya no se aceptan
  if (!decodificado.sid) {
    return next(errorDeSesion('Sesión no válida. Inicia sesión de nuevo.', 'SESION_INVALIDA'));
  }

  // Solo cuenta como actividad la petición que informa una interacción humana reciente
  const sesion = await evaluarSesion(decodificado.sid, leerEdadInteraccion(req));
  if (!sesion.activa) {
    await terminarSesion(res, token, cookies.refreshToken);
    return next(sesion.motivo === 'inactiva'
      ? errorDeSesion('Sesión cerrada por inactividad.', 'SESION_INACTIVA')
      : errorDeSesion('Sesión finalizada o token inválido.', 'SESION_CERRADA'));
  }

  req.user = decodificado;
  next();
});

export default autenticar;