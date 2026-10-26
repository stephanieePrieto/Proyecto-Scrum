// Responsable: Jetz - HU-01: reglas, SQL y avisos por socket (proyectos y Definition of Done)
/**
 * HU-01 · Gestionar proyectos (Jetz)
 * Reglas de negocio: crear, editar, archivar y consultar proyectos.
 *
 * Usa las tablas reales de database/schema.sql: proyectos, equipos, miembros_equipo, sprints, usuarios.
 * SUPUESTOS sobre el código BASE (solo los puntos marcados con [AJUSTAR]):
 *  - db.js exporta { query(texto, params) } y devuelve el resultado de pg (.rows).
 *  - ErrorApp se construye como new ErrorApp(mensaje, estadoHttp).
 *  - autenticar.js deja el id del usuario en req.user.id.
 */
import { consulta as query } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';



// ---------- Utilidades internas ----------

function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

async function esAdmin(usuario) {
  if (!usuario?.id) return false;
  const { rows } = await query('SELECT es_admin FROM usuarios WHERE id = $1 AND activo = TRUE', [usuario.id]);
  return rows[0]?.es_admin === true;
}

async function exigirAdmin(usuario) {
  if (!(await esAdmin(usuario))) lanzar(403, 'Solo un administrador puede realizar esta acción.');
}

export const DOD_BASE = [
  'Código revisado por al menos un compañero',
  'Pruebas aprobadas',
  'Documentación actualizada',
  'Despliegue validado',
].map((linea) => `- ${linea}`).join('\n');

const COLUMNAS = `p.id, p.equipo_id, e.nombre AS equipo_nombre, p.nombre, p.vision,
  p.fecha_inicio::text AS fecha_inicio, p.fecha_fin::text AS fecha_fin,
  p.definition_of_done, p.archivado, p.version, p.creado_en,
  EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = p.id AND s.estado = 'activo') AS sprint_activo`;

const DESDE = 'FROM proyectos p JOIN equipos e ON e.id = p.equipo_id';

function fechaValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

function validarDatos(datos = {}, { esCreacion }) {
  const campos = {};
  const nombre = String(datos.nombre ?? '').trim();
  const vision = String(datos.vision ?? '').trim();
  const dod = String(datos.definition_of_done ?? '').trim();
  const { fecha_inicio, fecha_fin } = datos;

  if (!nombre) campos.nombre = 'Escribe el nombre del proyecto.';
  else if (nombre.length > 120) campos.nombre = 'El nombre no puede superar 120 caracteres.';

  if (!vision) campos.vision = 'Describe la visión del proyecto.';

  if (!fechaValida(fecha_inicio)) campos.fecha_inicio = 'Elige una fecha de inicio válida.';
  if (!fechaValida(fecha_fin)) campos.fecha_fin = 'Elige una fecha de fin válida.';
  if (!campos.fecha_inicio && !campos.fecha_fin && fecha_fin < fecha_inicio) {
    campos.fecha_fin = 'La fecha de fin no puede ser anterior a la de inicio.';
  }

  if (esCreacion && !Number.isInteger(Number(datos.equipo_id))) {
    campos.equipo_id = 'Selecciona el equipo del proyecto.';
  }

  if (Object.keys(campos).length) lanzar(400, 'Revisa los campos marcados.', { campos });

  return {
    nombre, vision, fecha_inicio, fecha_fin,
    definition_of_done: dod || DOD_BASE,
    equipo_id: esCreacion ? Number(datos.equipo_id) : undefined,
  };
}

const ERROR_NOMBRE = { campos: { nombre: 'Ya existe un proyecto con ese nombre en este equipo.' } };

async function existeNombre(equipoId, nombre, ignorarId = null) {
  const { rows } = await query(
    'SELECT 1 FROM proyectos WHERE equipo_id = $1 AND lower(nombre) = lower($2) AND ($3::int IS NULL OR id <> $3) LIMIT 1',
    [equipoId, nombre, ignorarId],
  );
  return rows.length > 0;
}

function traducirDuplicado(error) {
  if (error?.code === '23505') lanzar(409, 'Ya existe un proyecto con ese nombre en el equipo.', ERROR_NOMBRE);
  if (error?.code === '23514') lanzar(400, 'Revisa las fechas del proyecto.', { campos: { fecha_fin: 'La fecha de fin no puede ser anterior a la de inicio.' } });
  throw error;
}

export async function listar(usuario, { archivados = false } = {}) {
  const params = [archivados];
  let filtroEquipo = '';
  if (!(await esAdmin(usuario))) {
    params.push(usuario.id);
    filtroEquipo = 'AND p.equipo_id IN (SELECT equipo_id FROM miembros_equipo WHERE usuario_id = $2)';
  }
  const { rows } = await query(
    `SELECT ${COLUMNAS} ${DESDE} WHERE p.archivado = $1 ${filtroEquipo} ORDER BY p.creado_en DESC`,
    params,
  );
  return rows;
}

export async function obtener(id, usuario) {
  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE p.id = $1`, [id]);
  const proyecto = rows[0];
  if (!proyecto) lanzar(404, 'Proyecto no encontrado.');

  if (!(await esAdmin(usuario))) {
    const miembro = await query(
      'SELECT 1 FROM miembros_equipo WHERE equipo_id = $1 AND usuario_id = $2',
      [proyecto.equipo_id, usuario.id],
    );
    if (!miembro.rows.length) lanzar(404, 'Proyecto no encontrado.');
  }
  return proyecto;
}

export async function equiposDisponibles(usuario) {
  await exigirAdmin(usuario);
  const { rows } = await query('SELECT id, nombre FROM equipos ORDER BY nombre');
  return rows;
}

export async function crear(datos, usuario) {
  await exigirAdmin(usuario);
  const limpio = validarDatos(datos, { esCreacion: true });

  const equipo = await query('SELECT 1 FROM equipos WHERE id = $1', [limpio.equipo_id]);
  if (!equipo.rows.length) lanzar(400, 'Revisa los campos marcados.', { campos: { equipo_id: 'El equipo seleccionado no existe.' } });

  if (await existeNombre(limpio.equipo_id, limpio.nombre)) {
    lanzar(409, 'Ya existe un proyecto con ese nombre en el equipo.', ERROR_NOMBRE);
  }

  try {
    const { rows } = await query(
      `INSERT INTO proyectos (equipo_id, nombre, vision, fecha_inicio, fecha_fin, definition_of_done)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [limpio.equipo_id, limpio.nombre, limpio.vision, limpio.fecha_inicio, limpio.fecha_fin, limpio.definition_of_done],
    );
    return obtener(rows[0].id, usuario);
  } catch (error) {
    return traducirDuplicado(error);
  }
}

export async function actualizar(id, datos, usuario) {
  await exigirAdmin(usuario);
  const limpio = validarDatos(datos, { esCreacion: false });
  const versionCliente = Number(datos.version);
  if (!Number.isInteger(versionCliente)) lanzar(400, 'Falta la versión del proyecto.', { campos: {} });

  const actual = await obtener(id, usuario);
  if (actual.archivado) lanzar(409, 'El proyecto está archivado y no se puede editar.');

  if (await existeNombre(actual.equipo_id, limpio.nombre, id)) {
    lanzar(409, 'Ya existe un proyecto con ese nombre en el equipo.', ERROR_NOMBRE);
  }

  try {
    const { rows } = await query(
      `UPDATE proyectos
          SET nombre = $1, vision = $2, fecha_inicio = $3, fecha_fin = $4,
              definition_of_done = $5, version = version + 1
        WHERE id = $6 AND version = $7 AND archivado = FALSE
        RETURNING id`,
      [limpio.nombre, limpio.vision, limpio.fecha_inicio, limpio.fecha_fin,
        limpio.definition_of_done, id, versionCliente],
    );

    if (!rows.length) {
      const masNueva = await obtener(id, usuario);
      lanzar(409, 'Hay una versión más nueva de este proyecto.', { conflicto: true, actual: masNueva });
    }
    return obtener(id, usuario);
  } catch (error) {
    return traducirDuplicado(error);
  }
}

export async function archivar(id, usuario) {
  await exigirAdmin(usuario);
  await obtener(id, usuario);

  const { rows } = await query(
    `UPDATE proyectos
        SET archivado = TRUE, version = version + 1
      WHERE id = $1 AND archivado = FALSE
        AND NOT EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = $1 AND s.estado = 'activo')
      RETURNING id`,
    [id],
  );

  if (!rows.length) {
    const proyecto = await obtener(id, usuario);
    if (proyecto.archivado) return proyecto;
    lanzar(409, 'El proyecto tiene un sprint activo. Cierra el sprint antes de archivarlo.', { motivo: 'sprint_activo' });
  }
  return obtener(id, usuario);
}

export { esAdmin };