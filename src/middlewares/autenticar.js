/**
 * @file autenticar.js
 * @description Middleware para verificar y validar la sesión o token de usuario mediante cookies httpOnly.
 * 
 * @author Citlaly Morales Viveros
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { consulta } from '../config/db.js';
import { ErrorApp } from '../utils/ErrorApp.js';
import { asyncHandler } from '../utils/asyncHandler.js'
import { evaluarSesion, errorDeSesion, obtenerAvisoVigente } from '../modulos/auth/auth.service.js';
import { leerCookies, terminarSesion } from '../modulos/auth/auth.controller.js';

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

/**
 * Verifica la sesión: token vigente, sesión abierta y cuenta activa y no eliminada.
 * No revisa el aviso de privacidad, por eso lo usan las rutas que permiten aceptarlo.
 */
export const autenticarSesion = asyncHandler(async (req, res, next) => {
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

  // Los tokens de sesión no llevan tipo; el temporal de 2FA sí y solo sirve para completar la verificación
  if (decodificado.tipo) {
    return next(new ErrorApp('Token no válido como sesión. Completa la verificación en dos pasos.', 401));
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

  // La cuenta se revisa en cada petición: una cuenta desactivada o eliminada pierde el acceso aunque su token siga firmado
  const { rows: cuentas } = await consulta(
    'SELECT activo, eliminado_en, version_aviso_privacidad FROM usuarios WHERE id = $1',
    [decodificado.id]
  );
  const cuenta = cuentas[0];
  if (!cuenta || !cuenta.activo || cuenta.eliminado_en) {
    await terminarSesion(res, token, cookies.refreshToken);
    return next(errorDeSesion('Sesión finalizada o token inválido.', 'SESION_CERRADA'));
  }

  req.user = decodificado;
  req.versionAvisoUsuario = cuenta.version_aviso_privacidad;
  next();
});

/**
 * Exige que la cuenta haya aceptado la versión vigente del aviso de privacidad. Si no la aceptó,
 * responde 403 con el código AVISO_PENDIENTE para que la interfaz lleve a la persona a la página del aviso.
 */
const exigirAvisoVigente = asyncHandler(async (req, res, next) => {
  const vigente = await obtenerAvisoVigente();
  if (vigente && req.versionAvisoUsuario !== vigente.version) {
    const error = new ErrorApp('Debes aceptar la versión vigente del aviso de privacidad.', 403);
    error.detalles = { codigo: 'AVISO_PENDIENTE' };
    return next(error);
  }
  next();
});

/**
 * Middleware completo para las rutas protegidas: sesión válida y aviso de privacidad aceptado.
 * Se exporta como arreglo para que Express ejecute primero la sesión y después el aviso.
 */
export const autenticar = [autenticarSesion, exigirAvisoVigente];

export default autenticar;