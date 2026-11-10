/**
 * @file tablero.service.js
 * @description Capa de servicio para la gestión de datos y persistencia del tablero del sprint (HU-17, HU-18, HU-22, HU-59).
 * 
 * @author Camila Mariné Crespo Zurita
 * @author Citlaly Morales Viveros
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { evaluarUmbral } from '../desviacion/desviacion.alertas.js';

/**
 * Obtiene la estructura completa de columnas y tareas asociadas al proyecto.
 * 
 * @async
 * @function obtenerEstructuraTablero
 * @param {number|string} proyectoId - ID del proyecto a consultar.
 * @returns {Promise<Object>} Estructura del sprint, columnas y lista de tareas.
 */
export const obtenerEstructuraTablero = async (proyectoId) => {
    const sprintRes = await consulta(
        `SELECT id, nombre, objetivo, fecha_inicio, fecha_fin, estado
         FROM sprints
         WHERE proyecto_id = $1 AND estado = 'activo'
         LIMIT 1`,
        [proyectoId]
    );
    const sprintActivo = sprintRes?.rows?.[0] || null;

    const colRes = await consulta(
        `SELECT id, nombre, orden, limite_wip, wip_duro, es_final
         FROM columnas_tablero 
         WHERE proyecto_id = $1 
         ORDER BY orden ASC`,
        [proyectoId]
    );

    let columnas = colRes?.rows || [];

    // Si la BD responde vacía, se entregan las columnas por defecto
    if (columnas.length === 0) {
        columnas = [
            { id: 1, nombre: 'Por hacer', orden: 1, limite_wip: 5, wip_duro: false, es_final: false },
            { id: 2, nombre: 'En progreso', orden: 2, limite_wip: 3, wip_duro: false, es_final: false },
            { id: 3, nombre: 'En revision', orden: 3, limite_wip: null, wip_duro: false, es_final: false },
            { id: 4, nombre: 'Hecho', orden: 4, limite_wip: null, wip_duro: false, es_final: true }
        ];
    }

    // Se incluye versión, horas estimadas, etiquetas, responsable y épica (HU-19, HU-21, HU-25, HU-59).
    const tarRes = await consulta(
        `SELECT t.id, t.historia_id, t.proyecto_id, t.sprint_id,
                t.titulo, COALESCE(t.descripcion, '') AS descripcion,
                t.columna_id, t.orden, t.version,
                t.bloqueada, t.motivo_bloqueo,
                h.numero_hu, h.titulo AS historia_titulo,
                t.responsable_id,
                t.horas_estimadas::float8 AS horas_estimadas,
                COALESCE(t.etiquetas, '{}') AS etiquetas,
                u.nombre AS responsable,
                (u.id IS NOT NULL AND u.activo = FALSE) AS responsable_inactivo,
                h.titulo AS historia_padre,
                h.puntos,
                h.epica_id,
                e.nombre AS epica_nombre,
                COALESCE((SELECT SUM(r.horas)::float8 FROM registros_horas r WHERE r.tarea_id = t.id), 0) AS horas_reales,
                (SELECT i.id FROM impedimentos i WHERE i.tarea_id = t.id AND i.estado = 'abierto' ORDER BY i.id DESC LIMIT 1) AS "idImpedimento"
         FROM tareas t
         JOIN historias h ON h.id = t.historia_id
         LEFT JOIN epicas e ON e.id = h.epica_id
         LEFT JOIN usuarios u ON u.id = t.responsable_id
         WHERE t.proyecto_id = $1
         ORDER BY t.orden ASC, t.id ASC`,
        [proyectoId]
    );

    const umbralRes = await consulta('SELECT umbral_desviacion FROM proyectos WHERE id = $1', [proyectoId]);
    const umbral = umbralRes?.rows?.[0]?.umbral_desviacion ?? 20;
    const columnasFinales = new Set(columnas.filter((c) => c.es_final).map((c) => c.id));
    const tareas = (tarRes?.rows || []).map((t) => ({
        ...t,
        supera_umbral: evaluarUmbral({
            estimadas: t.horas_estimadas, reales: t.horas_reales, umbral, terminada: columnasFinales.has(t.columna_id),
        }).supera,
    }));

    return {
        sprint: sprintActivo || { nombre: 'Sprint 1', diasRestantes: 7 },
        columnas,
        tareas
    };
};

/**
 * Actualiza los nombres y configuración de las columnas en la base de datos (HU-17, HU-22).
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
            const limiteWip = col.limite_wip !== undefined && col.limite_wip !== '' && col.limite_wip !== null
                ? Number(col.limite_wip)
                : null;
            await consulta(
                `UPDATE columnas_tablero 
                 SET nombre = $1,
                     limite_wip = COALESCE($2, limite_wip),
                     wip_duro = COALESCE($3, wip_duro)
                 WHERE id = $4 AND proyecto_id = $5`,
                [
                    col.nombre,
                    Number.isInteger(limiteWip) && limiteWip > 0 ? limiteWip : null,
                    typeof col.wip_duro === 'boolean' ? col.wip_duro : null,
                    col.id,
                    proyectoId
                ]
            );
        }
    }
    return true;
};

/**
 * Procesa el movimiento de una tarjeta entre columnas e incrementa su versión (HU-18, HU-59).
 * 
 * @async
 * @function moverTarjeta
 * @param {number|string} proyectoId - ID del proyecto.
 * @param {number|string} tareaId - ID de la tarjeta/tarea.
 * @param {number|string} nuevaColumnaId - ID de la columna destino.
 * @param {number} nuevoOrden - Posición dentro de la columna.
 * @param {number} version - Versión de control para concurrencia.
 * @param {string} usuarioNombre - Nombre del usuario que realiza la acción.
 * @returns {Promise<Object>} Datos de la tarjeta actualizada con su nueva versión.
 */
export const moverTarjeta = async (proyectoId, tareaId, nuevaColumnaId, nuevoOrden, version, usuarioNombre) => {
    const ordenSolicitado = Number.isInteger(Number(nuevoOrden)) && nuevoOrden !== null && nuevoOrden !== ''
        ? Number(nuevoOrden)
        : null;

    const { rowCount, rows } = await consulta(
        `UPDATE tareas 
         SET columna_id = $1,
             orden = COALESCE($2::int, (SELECT COALESCE(MAX(t2.orden), 0) + 1 FROM tareas t2 WHERE t2.columna_id = $1 AND t2.proyecto_id = $4)),
             version = version + 1,
             actualizado_en = NOW()
         WHERE id = $3 AND proyecto_id = $4
           AND EXISTS (SELECT 1 FROM columnas_tablero c WHERE c.id = $1 AND c.proyecto_id = $4)
         RETURNING id, proyecto_id, columna_id, orden, version`,
        [nuevaColumnaId, ordenSolicitado, tareaId, proyectoId]
    );
    if (rowCount === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    const actualizada = rows[0];
    const eventoPayload = {
        proyectoId: Number(proyectoId),
        tareaId: Number(tareaId),
        columnaId: Number(nuevaColumnaId),
        nuevaColumnaId: Number(nuevaColumnaId),
        orden: actualizada.orden,
        version: actualizada.version,
        usuarioNombre: usuarioNombre || 'Un compañero'
    };

    emitirAProyecto(Number(proyectoId), 'tablero:tarjeta_movida', eventoPayload);
    emitirAProyecto(Number(proyectoId), 'tablero:tarjeta-movida', eventoPayload);

    return actualizada;
};