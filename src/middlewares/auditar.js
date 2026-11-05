/**
 * @file auditar.js
 * @description Registro de auditoría de las acciones sensibles de un proyecto. El registro se inserta en
 * la tabla bitacora con el mismo cliente de la transacción que realiza la acción: si el registro falla,
 * la transacción completa se revierte y la acción no se aplica. También ofrece utilidades para armar los
 * valores anteriores y nuevos que se guardan en el detalle.
 * @author Citlaly Morales Viveros
 */
import { pool } from '../config/db.js';
import emisor from '../sockets/emisor.js';

/** Tipos de objeto que se guardan en la columna objeto de la bitácora. */
export const OBJETOS = Object.freeze({
    PROYECTO: 'proyecto',
    SPRINT: 'sprint',
    HISTORIA: 'historia',
    EPICA: 'epica',
    TAREA: 'tarea',
    IMPEDIMENTO: 'impedimento',
    INVITACION: 'invitacion',
    TABLERO: 'tablero',
});

/** Catálogo de acciones auditables, con el formato objeto_verbo. */
export const ACCIONES = Object.freeze({
    PROYECTO_CREADO: 'proyecto_creado',
    PROYECTO_MODIFICADO: 'proyecto_modificado',
    PROYECTO_ARCHIVADO: 'proyecto_archivado',
    SPRINT_CREADO: 'sprint_creado',
    SPRINT_INICIADO: 'sprint_iniciado',
    SPRINT_CERRADO: 'sprint_cerrado',
    HISTORIA_CREADA: 'historia_creada',
    HISTORIA_MODIFICADA: 'historia_modificada',
    HISTORIA_ELIMINADA: 'historia_eliminada',
    HISTORIA_ESTADO_CAMBIADO: 'historia_estado_cambiado',
    HISTORIA_PROPUESTA_ACEPTADA: 'historia_propuesta_aceptada',
    HISTORIA_PROPUESTA_RECHAZADA: 'historia_propuesta_rechazada',
    EPICA_CREADA: 'epica_creada',
    EPICA_MODIFICADA: 'epica_modificada',
    EPICA_ELIMINADA: 'epica_eliminada',
    TAREA_CREADA: 'tarea_creada',
    TAREA_MODIFICADA: 'tarea_modificada',
    TAREA_ELIMINADA: 'tarea_eliminada',
    TAREA_MOVIDA: 'tarea_movida',
    TABLERO_CONFIGURADO: 'tablero_configurado',
    IMPEDIMENTO_CREADO: 'impedimento_creado',
    IMPEDIMENTO_RESUELTO: 'impedimento_resuelto',
    INVITACION_CREADA: 'invitacion_creada',
    INVITACION_ACEPTADA: 'invitacion_aceptada',
    INVITACION_RECHAZADA: 'invitacion_rechazada',
    INVITACION_CANCELADA: 'invitacion_cancelada',
    INVITACION_REENVIADA: 'invitacion_reenviada',
    ROL_PROYECTO_ASIGNADO: 'rol_proyecto_asignado',
    ROL_PROYECTO_MODIFICADO: 'rol_proyecto_modificado',
    ROL_PROYECTO_RETIRADO: 'rol_proyecto_retirado',
});

const ACCIONES_VALIDAS = new Set(Object.values(ACCIONES));

/**
 * Convierte un valor en entero positivo.
 *
 * @param {*} valor - Valor a convertir.
 * @returns {number|null} El entero, o null si no es un entero positivo.
 */
function aEntero(valor) {
    const numero = Number(valor);
    return valor !== null && valor !== undefined && Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Representación comparable de un valor, para decidir si cambió realmente.
 *
 * @param {*} valor - Valor a normalizar.
 * @returns {string}
 */
function comparable(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return valor.toISOString();
    if (typeof valor === 'object') return JSON.stringify(valor);
    return String(valor);
}

/**
 * Copia solo los campos indicados de un objeto, para no guardar en la bitácora datos que no se necesitan.
 *
 * @param {Object} origen - Objeto del que se toman los valores.
 * @param {string[]} campos - Nombres de los campos a conservar.
 * @returns {Object}
 */
export function extraerCampos(origen, campos) {
    const resultado = {};
    for (const campo of campos) {
        if (origen && Object.prototype.hasOwnProperty.call(origen, campo)) resultado[campo] = origen[campo] ?? null;
    }
    return resultado;
}

/**
 * Compara dos versiones de un objeto y devuelve solo los campos que cambiaron.
 *
 * @param {Object} antes - Valores anteriores.
 * @param {Object} despues - Valores nuevos; solo se comparan sus campos.
 * @returns {{antes: Object, despues: Object}|null} Los campos modificados, o null si no hubo cambios.
 */
export function diferencias(antes, despues) {
    const cambiosAntes = {};
    const cambiosDespues = {};
    for (const campo of Object.keys(despues)) {
        if (comparable(antes?.[campo]) !== comparable(despues[campo])) {
            cambiosAntes[campo] = antes?.[campo] ?? null;
            cambiosDespues[campo] = despues[campo] ?? null;
        }
    }
    return Object.keys(cambiosDespues).length ? { antes: cambiosAntes, despues: cambiosDespues } : null;
}

/**
 * Registra una acción sensible en la bitácora dentro de la transacción en curso. Si el INSERT falla o los
 * datos son inválidos lanza un error, de modo que la transacción se revierta y la acción se cancele.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción; no se acepta el pool.
 * @param {Object} evento - Datos de la acción.
 * @param {number|null} [evento.usuarioId=null] - Quién realizó la acción; null si no hay sesión.
 * @param {number|string} evento.proyectoId - Proyecto al que pertenece el registro.
 * @param {string} evento.accion - Una de las acciones de ACCIONES.
 * @param {string} evento.objeto - Tipo del objeto afectado, normalmente una de OBJETOS.
 * @param {number|string|null} [evento.objetoId=null] - Identificador del objeto afectado.
 * @param {Object} [evento.antes] - Valores anteriores.
 * @param {Object} [evento.despues] - Valores nuevos.
 * @param {Object} [evento.contexto] - Datos adicionales que se guardan junto a antes y despues.
 * @param {boolean} [evento.emitirEvento=true] - Si se debe emitir evento de Socket.io después del registro.
 * @returns {Promise<{id: number, creadoEn: string}>} Identificador y fecha del registro creado.
 * @throws {Error} Si no se recibe el cliente de una transacción, la acción no está en el catálogo o falla el INSERT.
 */
export async function registrarAuditoria(cliente, { usuarioId = null, proyectoId, accion, objeto, objetoId = null, antes, despues, contexto, emitirEvento = true }) {
    if (!cliente || typeof cliente.query !== 'function' || typeof cliente.release !== 'function') {
        throw new Error('registrarAuditoria: se requiere el cliente de la transacción, no el pool.');
    }
    if (!ACCIONES_VALIDAS.has(accion)) {
        throw new Error(`registrarAuditoria: la acción "${accion}" no está en el catálogo.`);
    }
    const proyecto = aEntero(proyectoId);
    if (!proyecto) throw new Error('registrarAuditoria: el proyecto no es válido.');
    if (typeof objeto !== 'string' || !objeto) throw new Error('registrarAuditoria: falta el tipo de objeto.');

    const detalle = {};
    if (antes !== undefined) detalle.antes = antes;
    if (despues !== undefined) detalle.despues = despues;
    Object.assign(detalle, contexto);

    const { rows } = await cliente.query(
        'INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, creado_en',
        [aEntero(usuarioId), proyecto, accion, objeto, aEntero(objetoId), Object.keys(detalle).length ? JSON.stringify(detalle) : null],
    );

    const registro = rows[0];

    // Emitir evento por Socket.io si está habilitado
    if (emitirEvento && emisor && typeof emisor.emitirAProyecto === 'function') {
        try {
            await emisor.emitirAProyecto(proyecto, 'auditoria:nuevo_registro', {
                id: registro.id,
                usuario_id: aEntero(usuarioId),
                proyecto_id: proyecto,
                accion,
                objeto,
                objeto_id: aEntero(objetoId),
                detalle: Object.keys(detalle).length ? detalle : null,
                creado_en: registro.creado_en,
            });
        } catch (error) {
            // No romper la transacción si falla la emisión del evento
            console.error('[auditar] Falló al emitir evento de auditoría:', error.message);
        }
    }

    return { id: registro.id, creadoEn: registro.creado_en };
}

/**
 * Ejecuta el trabajo dentro de una transacción: confirma si termina bien y revierte si falla.
 * Pensado para las operaciones que hoy se ejecutan con consultas sueltas y necesitan registrar su auditoría.
 *
 * @param {(cliente: import('pg').PoolClient) => Promise<*>} trabajo - Función que recibe el cliente de la transacción.
 * @param {(resultado: *) => Promise<void>} [despuesCommit] - Función opcional a ejecutar después del COMMIT.
 * @returns {Promise<*>} Lo que devuelva el trabajo.
 */
export async function enTransaccion(trabajo, despuesCommit) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        const resultado = await trabajo(cliente);
        await cliente.query('COMMIT');
        if (despuesCommit) {
            await despuesCommit(resultado);
        }
        return resultado;
    } catch (error) {
        await cliente.query('ROLLBACK').catch(() => { });
        throw error;
    } finally {
        cliente.release();
    }
}