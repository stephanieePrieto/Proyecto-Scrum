// Responsable: Alfonso - HU-20: reglas y SQL de adjuntos (archivos en disco, maximo 10 MB)
/**
 * @file adjuntos.service.js
 * @description Guarda, lista, descarga y elimina adjuntos. El archivo vive en `uploads/adjuntos/`
 *              (fuera de `public/`) con un nombre aleatorio; la tabla `adjuntos` guarda el nombre original.
 */
import { mkdirSync, promises as fsp } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO, ROLES } from '../../utils/permisos.js';
import { enTransaccion, registrarHistorial } from '../detalle-tarjeta/detalle-tarjeta.service.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

/** @constant {number} Peso maximo por archivo (igual al CHECK de la tabla `adjuntos`). */
export const LIMITE_BYTES = 10 * 1024 * 1024;

/** @constant {string} Carpeta de almacenamiento (raiz del proyecto / uploads / adjuntos). */
export const CARPETA_ADJUNTOS = path.resolve(
  fileURLToPath(new URL('../../../uploads/adjuntos', import.meta.url)),
);

mkdirSync(CARPETA_ADJUNTOS, { recursive: true });

/** Extensiones de ejecutables y scripts que no se aceptan. */
const EXTENSIONES_BLOQUEADAS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.sh', '.ps1', '.vbs', '.jar', '.app', '.dll', '.apk',
]);

/**
 * Corrige el nombre original: multer puede entregarlo como latin1 cuando venia en UTF-8.
 * Tambien elimina rutas y caracteres de control.
 * @param {string} original Nombre recibido.
 * @returns {string} Nombre legible y seguro (maximo 200 caracteres).
 */
export function limpiarNombre(original) {
  let nombre = String(original ?? '');
  const redecodificado = Buffer.from(nombre, 'latin1').toString('utf8');
  if (!redecodificado.includes('\uFFFD') && !/[^\u0000-\u00FF]/.test(nombre)) nombre = redecodificado;
  nombre = path.basename(nombre.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return nombre.slice(0, 200) || 'archivo';
}

/**
 * Indica si la extension del archivo esta bloqueada.
 * @param {string} nombre Nombre del archivo.
 * @returns {boolean}
 */
export function esExtensionBloqueada(nombre) {
  return EXTENSIONES_BLOQUEADAS.has(path.extname(String(nombre)).toLowerCase());
}

/**
 * Genera el nombre con el que se guarda el archivo en disco (aleatorio, conserva la extension).
 * @param {string} original Nombre original.
 * @returns {string}
 */
export function nombreGuardado(original) {
  const extension = path.extname(limpiarNombre(original)).toLowerCase();
  return `${randomUUID()}${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''}`;
}

/**
 * Borra un archivo de la carpeta de adjuntos sin lanzar error si ya no existe.
 * @param {string} nombre Nombre guardado en disco.
 * @returns {Promise<void>}
 */
async function borrarArchivo(nombre) {
  if (!nombre) return;
  await fsp.unlink(path.join(CARPETA_ADJUNTOS, path.basename(nombre))).catch(() => {});
}

/**
 * Convierte una fila SQL al formato del frontend.
 * @param {Object} fila Fila con datos del autor.
 * @param {number} usuarioId Persona que consulta.
 * @param {string|null} rol Rol de esa persona en el proyecto.
 */
function mapearAdjunto(fila, usuarioId, rol) {
  return {
    id: fila.id,
    tareaId: fila.tarea_id,
    nombre: fila.nombre_original,
    mime: fila.mime ?? null,
    tamano: fila.tamano_bytes,
    creadoEn: fila.creado_en,
    autor: { id: fila.autor_id ?? null, nombre: fila.autor_nombre ?? 'Usuario eliminado' },
    puedeEliminar: fila.autor_id === Number(usuarioId) || rol === ROLES.SCRUM_MASTER,
  };
}

/**
 * Lista los adjuntos de una tarjeta (mas nuevos primero).
 * @param {{tareaId:number, usuarioId:number, rol:string|null}} datos Contexto de la consulta.
 * @returns {Promise<Object[]>}
 */
export async function listarAdjuntos({ tareaId, usuarioId, rol }) {
  const { rows } = await consulta(
    `SELECT a.id, a.tarea_id, a.nombre_original, a.mime, a.tamano_bytes, a.creado_en,
            u.id AS autor_id, u.nombre AS autor_nombre
       FROM adjuntos a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.tarea_id = $1
      ORDER BY a.creado_en DESC, a.id DESC`,
    [tareaId],
  );
  return rows.map((f) => mapearAdjunto(f, usuarioId, rol));
}

/**
 * Registra en la base de datos un archivo que multer ya guardo en disco.
 * Si algo falla, borra el archivo para no dejar basura.
 * @param {{tareaId:number, proyectoId:number, usuarioId:number, rol:string|null, archivo:Object}} datos Datos de la subida.
 * @returns {Promise<Object>} Adjunto creado.
 * @throws {ErrorApp} 400 sin archivo o vacio; 413 si supera 10 MB; 415 si el tipo no esta permitido.
 */
export async function guardarAdjunto({ tareaId, proyectoId, usuarioId, rol, archivo }) {
  if (!archivo) throw new ErrorApp('Selecciona un archivo para adjuntar.', 400);

  let fila;
  try {
    if (!archivo.size || archivo.size <= 0) throw new ErrorApp('El archivo está vacío.', 400);
    if (archivo.size > LIMITE_BYTES) throw new ErrorApp('El archivo supera el límite de 10 MB.', 413);
    const nombre = limpiarNombre(archivo.originalname);
    if (esExtensionBloqueada(nombre)) {
      throw new ErrorApp('Este tipo de archivo no está permitido (por ejemplo, ejecutables).', 415);
    }

    fila = await enTransaccion(async (cliente) => {
      const { rows } = await cliente.query(
        `INSERT INTO adjuntos (tarea_id, usuario_id, nombre_original, nombre_guardado, mime, tamano_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, tarea_id, nombre_original, mime, tamano_bytes, creado_en, usuario_id AS autor_id`,
        [tareaId, usuarioId, nombre, archivo.filename, archivo.mimetype || null, archivo.size],
      );
      const { rows: autores } = await cliente.query('SELECT nombre FROM usuarios WHERE id = $1', [usuarioId]);
      await registrarHistorial(tareaId, usuarioId, 'adjunto_agregado', { nombre }, cliente);
      return { ...rows[0], autor_nombre: autores[0]?.nombre };
    });
  } catch (error) {
    await borrarArchivo(archivo.filename);
    throw error;
  }

  const adjunto = mapearAdjunto(fila, usuarioId, rol);
  emitirAProyecto(proyectoId, 'adjunto:nuevo', { tareaId, adjunto: { ...adjunto, puedeEliminar: false } });
  return adjunto;
}

/**
 * Obtiene los datos necesarios para descargar un adjunto.
 * @param {number} id Adjunto.
 * @returns {Promise<{ruta:string, nombre:string}>} Ruta absoluta en disco y nombre original.
 * @throws {ErrorApp} 404 si no existe.
 */
export async function obtenerParaDescarga(id) {
  const { rows } = await consulta(
    'SELECT nombre_original, nombre_guardado FROM adjuntos WHERE id = $1',
    [id],
  );
  if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  return {
    ruta: path.join(CARPETA_ADJUNTOS, path.basename(rows[0].nombre_guardado)),
    nombre: rows[0].nombre_original,
  };
}

/**
 * Elimina un adjunto. Solo puede quien lo subio o el Scrum Master del proyecto.
 * @param {{id:number, usuarioId:number, rol:string|null}} datos Contexto.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 404 si no existe; 403 si no tiene permiso para eliminarlo.
 */
export async function eliminarAdjunto({ id, usuarioId, rol }) {
  const { rows } = await consulta(
    `SELECT a.id, a.tarea_id, a.usuario_id, a.nombre_original, a.nombre_guardado, t.proyecto_id
       FROM adjuntos a
       JOIN tareas t ON t.id = a.tarea_id
      WHERE a.id = $1`,
    [id],
  );
  if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

  const adjunto = rows[0];
  const esAutor = adjunto.usuario_id === Number(usuarioId);
  if (!esAutor && rol !== ROLES.SCRUM_MASTER) {
    throw new ErrorApp('Solo quien subió el archivo o el Scrum Master puede eliminarlo.', 403);
  }

  await enTransaccion(async (cliente) => {
    await cliente.query('DELETE FROM adjuntos WHERE id = $1', [id]);
    await registrarHistorial(adjunto.tarea_id, usuarioId, 'adjunto_eliminado', { nombre: adjunto.nombre_original }, cliente);
  });

  await borrarArchivo(adjunto.nombre_guardado);
  emitirAProyecto(adjunto.proyecto_id, 'adjunto:eliminado', { tareaId: adjunto.tarea_id, adjuntoId: id });
}