// HU-04: épicas ligadas al proyecto, con permisos comprobados en servidor.
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { tienePermiso, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

const aId = (valor) => {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

async function comprobarProyecto(usuario, proyectoId, escritura = false) {
  const id = aId(proyectoId);
  if (!id) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  const { rows } = await consulta('SELECT id, archivado FROM proyectos WHERE id = $1', [id]);
  if (!rows[0] || !(await tienePermiso(usuario, 'proyecto.ver', id))) {
    throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  }
  if (escritura) {
    if (!(await tienePermiso(usuario, 'historia.gestionar', id))) {
      throw new ErrorApp('No tienes permiso para gestionar épicas en este proyecto.', 403);
    }
    if (rows[0].archivado) throw new ErrorApp('El proyecto está archivado.', 409);
  }
  return id;
}

function validarDatos(datos = {}) {
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  const color = typeof datos.color === 'string' ? datos.color.trim() : '#4F46E5';
  if (!nombre || nombre.length > 80) throw new ErrorApp('El nombre de la épica debe tener entre 1 y 80 caracteres.', 400);
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new ErrorApp('Selecciona un color válido para la épica.', 400);
  return { nombre, color };
}

function gestionarErrorUnico(error) {
  if (error?.code === '23505') throw new ErrorApp('Ya existe una épica con ese nombre en el proyecto.', 409);
  throw error;
}

export async function listar(usuario, proyectoId) {
  const id = await comprobarProyecto(usuario, proyectoId);
  const { rows } = await consulta('SELECT id, nombre, color FROM epicas WHERE proyecto_id = $1 ORDER BY nombre, id', [id]);
  return rows;
}

export async function crear(usuario, proyectoId, datos) {
  const id = await comprobarProyecto(usuario, proyectoId, true);
  const { nombre, color } = validarDatos(datos);
  try {
    const { rows } = await consulta(
      'INSERT INTO epicas (proyecto_id, nombre, color) VALUES ($1, $2, $3) RETURNING id, nombre, color',
      [id, nombre, color],
    );
    emitirAProyecto(id, 'story:updated', { proyecto_id: id, epica_id: rows[0].id });
    return rows[0];
  } catch (error) { gestionarErrorUnico(error); }
}

export async function actualizar(usuario, proyectoId, epicaId, datos) {
  const id = await comprobarProyecto(usuario, proyectoId, true);
  const epicId = aId(epicaId);
  if (!epicId) throw new ErrorApp('Épica no encontrada en este proyecto.', 404);
  const { nombre, color } = validarDatos(datos);
  try {
    const { rows } = await consulta(
      'UPDATE epicas SET nombre = $1, color = $2 WHERE id = $3 AND proyecto_id = $4 RETURNING id, nombre, color',
      [nombre, color, epicId, id],
    );
    if (!rows[0]) throw new ErrorApp('Épica no encontrada en este proyecto.', 404);
    emitirAProyecto(id, 'story:updated', { proyecto_id: id, epica_id: epicId });
    return rows[0];
  } catch (error) { gestionarErrorUnico(error); }
}

/** Eliminar una épica sin borrar historias. Reasignación atómica dentro del mismo proyecto. */
export async function eliminar(usuario, proyectoId, epicaId, datos = {}) {
  const id = await comprobarProyecto(usuario, proyectoId, true);
  const epicId = aId(epicaId);
  if (!epicId) throw new ErrorApp('Épica no encontrada en este proyecto.', 404);
  const destinoRaw = datos?.destino_epica_id;
  const destinoId = destinoRaw == null || destinoRaw === '' ? null : aId(destinoRaw);
  if (destinoRaw != null && destinoRaw !== '' && !destinoId) {
    throw new ErrorApp('La épica de destino no es válida.', 400);
  }
  if (destinoId === epicId) throw new ErrorApp('Selecciona otra épica de destino.', 400);

  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    // El mismo candado de proyecto que utiliza el Backlog para sus escrituras.
    await cliente.query('SELECT id FROM proyectos WHERE id = $1 FOR UPDATE', [id]);
    const { rows: origen } = await cliente.query(
      'SELECT id FROM epicas WHERE id = $1 AND proyecto_id = $2 FOR UPDATE', [epicId, id],
    );
    if (!origen.length) throw new ErrorApp('Épica no encontrada en este proyecto.', 404);
    if (destinoId) {
      const { rows: destino } = await cliente.query(
        'SELECT id FROM epicas WHERE id = $1 AND proyecto_id = $2 FOR UPDATE', [destinoId, id],
      );
      if (!destino.length) throw new ErrorApp('La épica de destino no pertenece a este proyecto.', 400);
    }
    const actualizadas = await cliente.query(
      'UPDATE historias SET epica_id = $1, version = version + 1 WHERE proyecto_id = $2 AND epica_id = $3',
      [destinoId, id, epicId],
    );
    await cliente.query('DELETE FROM epicas WHERE id = $1 AND proyecto_id = $2', [epicId, id]);
    await cliente.query('COMMIT');
    resultado = { eliminada: true, historias_reasignadas: actualizadas.rowCount };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
  emitirAProyecto(id, 'story:updated', { proyecto_id: id, epica_id: epicId });
  return resultado;
}
