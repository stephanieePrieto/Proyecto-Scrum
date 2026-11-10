// Responsable: Diego - envoltorio de controladores que usan Daily, impedimentos, ciclo del sprint y retrospectiva
import { asyncHandler } from './asyncHandler.js';

/**
 * Envolver un controlador asíncrono.
 * Los errores controlados (ErrorApp: 400, 404, 409...) se responden aquí como { mensaje, detalles } para que
 * la pantalla pueda marcar el campo con error o explicar lo que pasó. Cualquier otro error pasa al manejador global.
 *
 * @param {function(import('express').Request, import('express').Response): Promise<void>} funcion
 * @returns {import('express').RequestHandler}
 */
export const envolver = (funcion) => asyncHandler(async (req, res) => {
  try {
    await funcion(req, res);
  } catch (error) {
    if (error?.isOperational) {
      return res.status(error.statusCode || 400).json({
        mensaje: error.message,
        ...(error.detalles ? { detalles: error.detalles } : {}),
      });
    }
    throw error;
  }
});
