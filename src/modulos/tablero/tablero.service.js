/**
 * @file tablero.service.js
 * @description Capa de servicio para la gestión de datos y persistencia del tablero del sprint (HU-17, HU-18, HU-22).
 * 
 * @author Camila Mariné Crespo Zurita
 * @author Citlaly Morales Viveros
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';

/**
 * Obtiene la estructura completa de columnas y tareas asociadas al proyecto.
 * 
 * @async
 * @function obtenerEstructuraTablero
 * @param {number|string} proyectoId - ID del proyecto a consultar.
 * @returns {Promise<Object>} Estructura del sprint, columnas y lista de tareas.
 */
export const obtenerEstructuraTablero = async (proyectoId) => {
    const colRes = await consulta(
        `SELECT id, nombre, orden, limite_wip 
         FROM columnas_tablero 
         WHERE proyecto_id = $1 
         ORDER BY orden ASC`,
        [proyectoId]
    );

    let columnas = colRes?.rows || [];

    // Si la BD responde vacía, se entregan las columnas por defecto
    if (columnas.length === 0) {
        columnas = [
            { id: 1, nombre: 'Por hacer', orden: 1, limite_wip: 5 },
            { id: 2, nombre: 'En progreso', orden: 2, limite_wip: 3 },
            { id: 3, nombre: 'En revision', orden: 3, limite_wip: null },
            { id: 4, nombre: 'Hecho', orden: 4, limite_wip: null }
        ];
    }

    // Se incluye responsable y épica (la épica vive en la historia padre) para que
    // el tablero pueda poblar y aplicar los filtros de Persona / Épica (HU-21).
    const tarRes = await consulta(
        `SELECT t.id, t.titulo, t.descripcion, t.columna_id, t.orden, t.version,
                t.bloqueada, t.motivo_bloqueo,
                t.responsable_id,
                u.nombre AS responsable,
                (u.id IS NOT NULL AND u.activo = FALSE) AS responsable_inactivo,
                h.epica_id,
                e.nombre AS epica_nombre,
                COALESCE((SELECT SUM(r.horas) FROM registros_horas r WHERE r.tarea_id = t.id), 0) AS horas_reales
         FROM tareas t
         JOIN historias h ON h.id = t.historia_id
         LEFT JOIN epicas e ON e.id = h.epica_id
         LEFT JOIN usuarios u ON u.id = t.responsable_id
         WHERE t.proyecto_id = $1
         ORDER BY t.orden ASC`,
        [proyectoId]
    );

    return {
        sprint: { nombre: 'Sprint 1', diasRestantes: 7 },
        columnas,
        tareas: tarRes?.rows || []
    };
};

/**
 * Actualiza los nombres y configuración de las columnas en la base de datos (HU-17).
 * 
 * @async
 * @function actualizarColumnas
 * @param {number|string} proyectoId - ID del proyecto.
 * @param {Array<Object>} columnas - Arreglo con los nuevos datos de las columnas.
 * @returns {Promise<boolean>} Estado final de la operación.
 */
export const actualizarColumnas = async (proyectoId, columnas) => {
    if (Array.isArray(columnas)) {
        for (const col of columnas) {
            await consulta(
                `UPDATE columnas_tablero 
                 SET nombre = $1 
                 WHERE id = $2 AND proyecto_id = $3`,
                [col.nombre, col.id, proyectoId]
            );
        }
    }
    return true;
};

/**
 * Procesa el movimiento de una tarjeta entre columnas (HU-18).
 * 
 * @async
 * @function moverTarjeta
 * @param {number|string} proyectoId - ID del proyecto.
 * @param {number|string} tareaId - ID de la tarjeta/tarea.
 * @param {number|string} nuevaColumnaId - ID de la columna destino.
 * @param {number} nuevoOrden - Posición dentro de la columna.
 * @param {number} version - Versión de control para concurrencia.
 * @param {string} usuarioNombre - Nombre del usuario que realiza la acción.
 * @returns {Promise<Object>} Datos de la tarjeta actualizada.
 */
export const moverTarjeta = async (proyectoId, tareaId, nuevaColumnaId, nuevoOrden, version, usuarioNombre) => {
    // La tarjeta y la columna destino deben pertenecer al mismo proyecto; de lo contrario no se modifica nada
    // Si no llega un orden válido (p. ej. movimientos pendientes guardados sin él), va al final de la columna
    const ordenSolicitado = Number.isInteger(Number(nuevoOrden)) && nuevoOrden !== null && nuevoOrden !== '' ? Number(nuevoOrden) : null;

    const { rowCount, rows } = await consulta(
        `UPDATE tareas 
         SET columna_id = $1,
             orden = COALESCE($2::int, (SELECT COALESCE(MAX(t2.orden), 0) + 1 FROM tareas t2 WHERE t2.columna_id = $1 AND t2.proyecto_id = $4)),
             version = version + 1 
         WHERE id = $3 AND proyecto_id = $4
           AND EXISTS (SELECT 1 FROM columnas_tablero c WHERE c.id = $1 AND c.proyecto_id = $4)
         RETURNING orden`,
        [nuevaColumnaId, ordenSolicitado, tareaId, proyectoId]
    );
    if (rowCount === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    return { id: tareaId, columna_id: nuevaColumnaId, orden: rows[0].orden };
};