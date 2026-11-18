/**
 * @file tablero.controller.js
 * @description Controladores para atender peticiones HTTP del tablero (obtención, configuración de columnas y movimiento de tarjetas).
 * 
 * @author Camila Mariné Crespo Zurita
 * @author Dana Carmona Santamaria
 */

import { asyncHandler } from '../../utils/asyncHandler.js';
import { actualizarColumnas, obtenerEstructuraTablero } from './tablero.service.js';
import { moverTarjetaConVersion } from '../tarjetas/tarjetas.service.js';

/**
 * Obtiene la estructura de columnas y tareas del proyecto, junto con el Sprint activo.
 * 
 * @async
 * @function obtenerTablero
 * @param {import('express').Request} req - Objeto de petición Express.
 * @param {import('express').Response} res - Objeto de respuesta Express.
 * @returns {Promise<void>}
 */
export const obtenerTablero = asyncHandler(async (req, res) => {
    const proyectoId = req.params.proyectoId;

    // Validar que el proyectoId exista
    if (!proyectoId || proyectoId === 'null') {
        return res.status(200).json({
            status: 'success',
            mensaje: 'No hay proyecto seleccionado.',
            data: { columnas: [], tareas: [] } // Proyecto nulo = estructura vacía
        });
    }

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
    const { tareaId, nuevaColumnaId, nuevoOrden } = req.body || {};
    const tareaActualizada = await moverTarjetaConVersion(
        tareaId,
        { nuevaColumnaId, nuevoOrden },
        req.user
    );

    res.status(200).json({
        status: 'success',
        mensaje: 'Tarjeta movida exitosamente.',
        data: { tarea: tareaActualizada }
    });
});