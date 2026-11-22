/**
 * @file auditoria.service.js
 * @description Reglas de negocio para consultar la bitácora de auditoría.
 * Usa la tabla bitacora de database/schema.sql.
 *
 * @author Citlaly Morales Viveros
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { exigirPermiso } from '../../utils/permisos.js';

/** Límite máximo de registros por página. */
const LIMITE_MAXIMO = 100;

/** Límite por defecto de registros por página. */
const LIMITE_POR_DEFECTO = 50;

/**
 * Indica si un parámetro de query no fue enviado (undefined, null o cadena vacía).
 *
 * @param {*} valor - Valor a revisar.
 * @returns {boolean}
 */
function estaVacio(valor) {
    return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/**
 * Convierte un parámetro a entero dentro de un rango. Si no se envió, devuelve el valor por defecto.
 * Si se envió pero no es válido, lanza un error 400.
 *
 * @param {*} valor - Valor recibido.
 * @param {{minimo: number, maximo: number, porDefecto: *, mensaje: string}} opciones - Reglas de validación.
 * @returns {number|*}
 * @throws {ErrorApp} 400 si el valor no es un entero dentro del rango.
 */
function parsearEntero(valor, { minimo, maximo, porDefecto, mensaje }) {
    if (estaVacio(valor)) return porDefecto;
    const numero = typeof valor === 'string' ? Number(valor.trim()) : Number(valor);
    if (typeof valor === 'object' || !Number.isInteger(numero) || numero < minimo || numero > maximo) {
        throw new ErrorApp(mensaje, 400);
    }
    return numero;
}

/**
 * Obtiene un parámetro de texto opcional. Rechaza valores repetidos (arreglos) u objetos.
 *
 * @param {*} valor - Valor recibido.
 * @param {string} mensaje - Mensaje de error si el tipo no es válido.
 * @returns {string} Texto sin espacios laterales, o '' si no se envió.
 * @throws {ErrorApp} 400 si el valor no es una cadena.
 */
function parsearTexto(valor, mensaje) {
    if (estaVacio(valor)) return '';
    if (typeof valor !== 'string') throw new ErrorApp(mensaje, 400);
    return valor.trim();
}

/**
 * Valida que una cadena tenga formato de fecha YYYY-MM-DD y sea una fecha real.
 *
 * @param {string} fecha - Cadena a validar.
 * @returns {boolean}
 */
function esFechaValida(fecha) {
    if (typeof fecha !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
    const date = new Date(`${fecha}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === fecha;
}

/**
 * Obtiene los registros de auditoría de un proyecto con los filtros y paginación especificados.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number|string} proyectoId - Identificador del proyecto.
 * @param {Object} [filtros] - Filtros de consulta.
 * @param {number|string} [filtros.usuarioId] - Filtrar por usuario que realizó la acción.
 * @param {string} [filtros.accion] - Filtrar por tipo de acción.
 * @param {string} [filtros.fechaDesde] - Fecha mínima (YYYY-MM-DD, inclusive).
 * @param {string} [filtros.fechaHasta] - Fecha máxima (YYYY-MM-DD, inclusive).
 * @param {number|string} [filtros.limite] - Registros por página (1-100).
 * @param {number|string} [filtros.offset] - Desplazamiento (0+).
 * @returns {Promise<{registros: Object[], total: number}>}
 * @throws {ErrorApp} 400 si los parámetros son inválidos, 403 si no tiene permiso, 404 si el proyecto no existe.
 */
export async function listar(usuario, proyectoId, filtros = {}) {
    const idProyecto = Number(proyectoId);
    if (!Number.isInteger(idProyecto) || idProyecto <= 0) {
        throw new ErrorApp('El identificador del proyecto no es válido.', 400);
    }

    // Solo quien tenga el permiso (Scrum Master) puede consultar la bitácora
    await exigirPermiso(usuario, 'auditoria.ver', idProyecto);

    // Paginación: los valores llegan como strings desde req.query
    const limite = parsearEntero(filtros.limite, {
        minimo: 1,
        maximo: LIMITE_MAXIMO,
        porDefecto: LIMITE_POR_DEFECTO,
        mensaje: `El límite de registros por página debe ser un entero entre 1 y ${LIMITE_MAXIMO}.`,
    });
    const offset = parsearEntero(filtros.offset, {
        minimo: 0,
        maximo: Number.MAX_SAFE_INTEGER,
        porDefecto: 0,
        mensaje: 'El desplazamiento debe ser un entero mayor o igual a 0.',
    });

    const condiciones = ['b.proyecto_id = $1'];
    const params = [idProyecto];

    // Filtrar por usuario
    const usuarioId = parsearEntero(filtros.usuarioId, {
        minimo: 1,
        maximo: Number.MAX_SAFE_INTEGER,
        porDefecto: null,
        mensaje: 'El identificador de usuario no es válido.',
    });
    if (usuarioId !== null) {
        params.push(usuarioId);
        condiciones.push(`b.usuario_id = $${params.length}`);
    }

    // Filtrar por acción
    const accion = parsearTexto(filtros.accion, 'El filtro de acción no es válido.');
    if (accion) {
        params.push(accion);
        condiciones.push(`b.accion = $${params.length}`);
    }

    // Filtrar por fechas
    const fechaDesde = parsearTexto(filtros.fechaDesde, 'El formato de fecha desde no es válido. Usa YYYY-MM-DD.');
    const fechaHasta = parsearTexto(filtros.fechaHasta, 'El formato de fecha hasta no es válido. Usa YYYY-MM-DD.');

    if (fechaDesde && !esFechaValida(fechaDesde)) {
        throw new ErrorApp('El formato de fecha desde no es válido. Usa YYYY-MM-DD.', 400);
    }
    if (fechaHasta && !esFechaValida(fechaHasta)) {
        throw new ErrorApp('El formato de fecha hasta no es válido. Usa YYYY-MM-DD.', 400);
    }
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        throw new ErrorApp('La fecha desde no puede ser posterior a la fecha hasta.', 400);
    }

    if (fechaDesde) {
        params.push(fechaDesde);
        condiciones.push(`b.creado_en >= $${params.length}::date`);
    }
    if (fechaHasta) {
        // Incluir todo el día: menor a fechaHasta + 1 día
        params.push(fechaHasta);
        condiciones.push(`b.creado_en < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = condiciones.join(' AND ');

    // Total de coincidencias y página de registros en paralelo
    const [{ rows: totalRows }, { rows: registros }] = await Promise.all([
        consulta(`SELECT COUNT(*)::int AS total FROM bitacora b WHERE ${where}`, params),
        consulta(
            `SELECT b.id, b.usuario_id, b.proyecto_id, b.accion, b.objeto, b.objeto_id, b.detalle, b.creado_en,
                    u.nombre AS usuario_nombre
             FROM bitacora b
             LEFT JOIN usuarios u ON u.id = b.usuario_id
             WHERE ${where}
             ORDER BY b.creado_en DESC, b.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limite, offset],
        ),
    ]);

    return {
        registros: registros.map((row) => ({
            id: row.id,
            usuarioId: row.usuario_id,
            usuarioNombre: row.usuario_nombre ?? 'Sistema',
            proyectoId: row.proyecto_id,
            accion: row.accion,
            objeto: row.objeto,
            objetoId: row.objeto_id,
            detalle: row.detalle,
            creadoEn: row.creado_en,
        })),
        total: totalRows[0].total,
    };
}