// Responsable: Alfonso - HU-20: datos de la tarjeta, subtareas (checklist) e historial de cambios
/**
 * @file detalle-tarjeta.service.js
 * @description Logica de negocio del detalle de tarjeta. Tambien exporta utilidades que reutilizan
 *              los modulos de comentarios y adjuntos (`leerId`, `enTransaccion`, `registrarHistorial`).
 * Tablas: tareas, historias, columnas_tablero, usuarios, registros_horas, checklist_items, historial_tareas.
 */
import { pool, consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';

const ENTERO_MAXIMO = 2147483647;
const MAX_TEXTO_ITEM = 200;
const LIMITE_HISTORIAL = 50;

/**
 * Convierte un valor de la peticion en un identificador entero positivo.
 * @param {*} valor Valor sin confiar.
 * @returns {number|null} Identificador valido o `null`.
 */
export function leerId(valor) {
  if (typeof valor === 'string' && !/^\d+$/.test(valor.trim())) return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 && numero <= ENTERO_MAXIMO ? numero : null;
}

/**
 * Ejecuta varias consultas en una transaccion (todo o nada).
 * @template T
 * @param {function(import('pg').PoolClient): Promise<T>} trabajo Funcion que recibe el cliente.
 * @returns {Promise<T>} Resultado de `trabajo`.
 */
export async function enTransaccion(trabajo) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try { await cliente.query('ROLLBACK'); } catch { /* la conexion ya fallo */ }
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Registra una entrada en `historial_tareas`.
 * @param {number} tareaId Tarjeta afectada.
 * @param {number} usuarioId Persona que hizo el cambio.
 * @param {string} accion Clave de la accion (ej. "comentario_agregado").
 * @param {Object|null} [detalle] Datos extra (se guardan como JSONB).
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente] Pool o cliente de una transaccion.
 * @returns {Promise<void>}
 */
export async function registrarHistorial(tareaId, usuarioId, accion, detalle = null, cliente = pool) {
  await cliente.query(
    'INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle) VALUES ($1, $2, $3, $4)',
    [tareaId, usuarioId, accion, detalle ? JSON.stringify(detalle) : null],
  );
}

/** @param {Object} fila Fila de checklist_items. */
function mapearItem(fila) {
  return { id: fila.id, texto: fila.texto, hecho: fila.hecho, orden: fila.orden };
}

/** @param {Object} fila Fila de historial_tareas con el nombre de la persona. */
function mapearHistorial(fila) {
  return {
    id: fila.id,
    accion: fila.accion,
    detalle: fila.detalle ?? null,
    creadoEn: fila.creado_en,
    usuario: fila.usuario_id ? { id: fila.usuario_id, nombre: fila.usuario_nombre } : null,
  };
}

/**
 * Lista el checklist (subtareas) de una tarjeta.
 * @param {number} tareaId Tarjeta.
 * @returns {Promise<Object[]>}
 */
export async function listarChecklist(tareaId) {
  const { rows } = await consulta(
    'SELECT id, texto, hecho, orden FROM checklist_items WHERE tarea_id = $1 ORDER BY orden, id',
    [tareaId],
  );
  return rows.map(mapearItem);
}

/**
 * Lista los cambios mas recientes de una tarjeta (mas nuevos primero).
 * @param {number} tareaId Tarjeta.
 * @returns {Promise<Object[]>}
 */
export async function listarHistorial(tareaId) {
  const { rows } = await consulta(
    `SELECT h.id, h.accion, h.detalle, h.creado_en, u.id AS usuario_id, u.nombre AS usuario_nombre
       FROM historial_tareas h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.tarea_id = $1
      ORDER BY h.creado_en DESC, h.id DESC
      LIMIT $2`,
    [tareaId, LIMITE_HISTORIAL],
  );
  return rows.map(mapearHistorial);
}

/**
 * Obtiene todo lo necesario para pintar el detalle de una tarjeta.
 * @param {number} tareaId Tarjeta.
 * @returns {Promise<{tarea: Object, checklist: Object[], historial: Object[]}>}
 * @throws {ErrorApp} 404 si la tarjeta no existe.
 */
export async function obtenerDetalle(tareaId) {
  const { rows } = await consulta(
    `SELECT t.id, t.proyecto_id, t.titulo, t.descripcion, t.etiquetas, t.bloqueada, t.motivo_bloqueo,
            t.version, t.creado_en, t.actualizado_en,
            t.horas_estimadas::float8 AS horas_estimadas,
            (SELECT COALESCE(SUM(r.horas), 0)::float8 FROM registros_horas r WHERE r.tarea_id = t.id) AS horas_reales,
            h.id AS historia_id, h.titulo AS historia_titulo,
            c.nombre AS columna,
            u.id AS responsable_id, u.nombre AS responsable_nombre, u.activo AS responsable_activo
       FROM tareas t
       JOIN historias h ON h.id = t.historia_id
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
       LEFT JOIN usuarios u ON u.id = t.responsable_id
      WHERE t.id = $1`,
    [tareaId],
  );
  if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

  const f = rows[0];
  const [checklist, historial] = await Promise.all([listarChecklist(tareaId), listarHistorial(tareaId)]);

  return {
    tarea: {
      id: f.id,
      proyectoId: f.proyecto_id,
      titulo: f.titulo,
      descripcion: f.descripcion ?? '',
      etiquetas: f.etiquetas ?? [],
      bloqueada: f.bloqueada,
      motivoBloqueo: f.motivo_bloqueo ?? '',
      version: f.version,
      creadaEn: f.creado_en,
      actualizadaEn: f.actualizado_en,
      horasEstimadas: f.horas_estimadas,
      horasReales: f.horas_reales,
      columna: f.columna ?? null,
      historia: { id: f.historia_id, titulo: f.historia_titulo },
      responsable: f.responsable_id
        ? { id: f.responsable_id, nombre: f.responsable_nombre, activo: f.responsable_activo }
        : null,
    },
    checklist,
    historial,
  };
}

/**
 * Agrega una subtarea al checklist.
 * @param {{tareaId:number, usuarioId:number, texto:*}} datos Datos de la subtarea.
 * @returns {Promise<Object>} Subtarea creada.
 * @throws {ErrorApp} 400 si el texto esta vacio o es demasiado largo.
 */
export async function agregarItem({ tareaId, usuarioId, texto }) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (!limpio) throw new ErrorApp('Escribe el texto de la subtarea.', 400);
  if (limpio.length > MAX_TEXTO_ITEM) {
    throw new ErrorApp(`La subtarea no puede superar ${MAX_TEXTO_ITEM} caracteres.`, 400);
  }

  return enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `INSERT INTO checklist_items (tarea_id, texto, orden)
       VALUES ($1, $2, (SELECT COALESCE(MAX(orden), 0) + 1 FROM checklist_items WHERE tarea_id = $1))
       RETURNING id, texto, hecho, orden`,
      [tareaId, limpio],
    );
    await registrarHistorial(tareaId, usuarioId, 'checklist_agregado', { texto: limpio }, cliente);
    return mapearItem(rows[0]);
  });
}

/**
 * Marca o desmarca una subtarea.
 * @param {{tareaId:number, itemId:number, usuarioId:number, hecho:*}} datos Datos del cambio.
 * @returns {Promise<Object>} Subtarea actualizada.
 * @throws {ErrorApp} 400 si `hecho` no es booleano; 404 si la subtarea no es de esa tarjeta.
 */
export async function actualizarItem({ tareaId, itemId, usuarioId, hecho }) {
  if (typeof hecho !== 'boolean') throw new ErrorApp('Indica si la subtarea está completada.', 400);

  return enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `UPDATE checklist_items SET hecho = $3
        WHERE id = $1 AND tarea_id = $2
        RETURNING id, texto, hecho, orden`,
      [itemId, tareaId, hecho],
    );
    if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    await registrarHistorial(
      tareaId,
      usuarioId,
      hecho ? 'checklist_completado' : 'checklist_reabierto',
      { texto: rows[0].texto },
      cliente,
    );
    return mapearItem(rows[0]);
  });
}

/**
 * Elimina una subtarea.
 * @param {{tareaId:number, itemId:number, usuarioId:number}} datos Datos de la subtarea.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 404 si la subtarea no es de esa tarjeta.
 */
export async function eliminarItem({ tareaId, itemId, usuarioId }) {
  await enTransaccion(async (cliente) => {
    const { rows } = await cliente.query(
      'DELETE FROM checklist_items WHERE id = $1 AND tarea_id = $2 RETURNING texto',
      [itemId, tareaId],
    );
    if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    await registrarHistorial(tareaId, usuarioId, 'checklist_eliminado', { texto: rows[0].texto }, cliente);
  });
}