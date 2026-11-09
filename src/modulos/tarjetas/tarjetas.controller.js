/**
 * @file tarjetas.controller.js
 * @description Controladores HTTP para el módulo de tarjetas (HU-18, HU-23, HU-25).
 * @author Camila Mariné Crespo Zurita
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './tarjetas.service.js';

/**
 * Envuelve el controlador para asegurar que los errores operacionales con detalles
 * (como 409 Conflict en HU-25) conserven su estructura JSON en la respuesta.
 */
const responderConDetalles = (fn) => asyncHandler(async (req, res, next) => {
    try {
        await fn(req, res, next);
    } catch (error) {
        if (error?.isOperational && error?.statusCode) {
            return res.status(error.statusCode).json({
                status: 'fail',
                mensaje: error.message,
                ...(error.detalles ? { detalles: error.detalles } : {})
            });
        }
        throw error;
    }
});

export const obtenerTarjetaController = responderConDetalles(async (req, res) => {
    const tarea = await servicio.obtenerTarjetaPorId(req.params.id, req.user);
    res.status(200).json({
        status: 'success',
        data: { tarea }
    });
});

export const actualizarTarjetaController = responderConDetalles(async (req, res) => {
    const resultado = await servicio.actualizarTarjetaConVersion(
        req.params.id,
        req.body,
        req.user
    );
    res.status(200).json({
        status: 'success',
        mensaje: resultado.fusionadoAutomaticamente
            ? 'Cambios fusionados automáticamente con otra edición reciente.'
            : 'Tarjeta actualizada correctamente.',
        data: resultado
    });
});

export const notificarEdicionController = responderConDetalles(async (req, res) => {
    const resultado = await servicio.notificarEstadoEdicion(
        req.params.id,
        Boolean(req.body?.editando),
        req.user
    );
    res.status(200).json({
        status: 'success',
        data: resultado
    });
});

export const cambiarBloqueoController = responderConDetalles(async (req, res) => {
    const tarea = await servicio.cambiarBloqueoTarjeta(
        req.params.id,
        req.body,
        req.user
    );
    res.status(200).json({
        status: 'success',
        mensaje: tarea.bloqueada ? 'Tarjeta marcada como bloqueada.' : 'Tarjeta desbloqueada.',
        data: { tarea }
    });
});

export const moverTarjetaIndividualController = responderConDetalles(async (req, res) => {
    const tarea = await servicio.moverTarjetaConVersion(
        req.params.id,
        req.body,
        req.user
    );
    res.status(200).json({
        status: 'success',
        mensaje: 'Tarjeta movida exitosamente.',
        data: { tarea }
    });
});