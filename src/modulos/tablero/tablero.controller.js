/**
 * @file tablero.controller.js
 * @description Controladores para atender peticiones HTTP del tablero (obtención, configuración de columnas y movimiento de tarjetas) [HU-17, HU-18, HU-22].
 * @author Camila Mariné Crespo Zurita
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import { actualizarColumnas, moverTarjeta, obtenerEstructuraTablero } from './tablero.service.js';

/**
 * Obtiene la estructura completa de columnas y tareas del sprint activo.
 * 
 * @async
 * @function obtenerTablero
 * @param {import('express').Request} req - Objeto de petición Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const obtenerTablero = asyncHandler(async (req, res) => {
    const proyectoId = req.params.proyectoId || 1;
    const datosTablero = await obtenerEstructuraTablero(proyectoId);

    res.status(200).json({
        status: 'success',
        mensaje: 'Estructura del tablero obtenida correctamente.',
        data: datosTablero
    });
});

/**
 * Guarda los cambios de nombres, orden y límites WIP de las columnas (HU-17, HU-22).
 * 
 * @async
 * @function configurarColumnas
 * @param {import('express').Request} req - Objeto de petición Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const configurarColumnas = asyncHandler(async (req, res) => {
    const { proyectoId } = req.params;
    const { columnas } = req.body;

    await actualizarColumnas(proyectoId, columnas);

    res.status(200).json({
        status: 'success',
        mensaje: 'Configuración de columnas actualizada correctamente.'
    });
});

/**
 * Procesa el movimiento de una tarjeta entre columnas en tiempo real (HU-18).
 * 
 * @async
 * @function moverTarjetaController
 * @param {import('express').Request} req - Objeto de petición Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const moverTarjetaController = asyncHandler(async (req, res) => {
    const { proyectoId, tareaId, nuevaColumnaId, nuevoOrden, version } = req.body;
    const usuarioNombre = req.usuario?.nombre || 'Un compañero';

    const tareaActualizada = await moverTarjeta(
        proyectoId,
        tareaId,
        nuevaColumnaId,
        nuevoOrden,
        version,
        usuarioNombre
    );

    res.status(200).json({
        status: 'success',
        mensaje: 'Tarjeta movida exitosamente.',
        data: { tarea: tareaActualizada }
    });
});