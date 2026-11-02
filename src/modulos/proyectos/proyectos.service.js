/**
 * @file proyectos.service.js
 * @description Reglas de negocio: crear, editar, archivar y consultar proyectos.
 * Usa las tablas reales de database/schema.sql: proyectos, equipos, miembros_equipo, sprints, usuarios.
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { consulta as query, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import crypto from 'crypto';
import { enviarCorreo } from '../../utils/correo.js';
import { env } from '../../config/env.js';

// ---------- Utilidades internas ----------

function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

function generarToken() {
  const tokenPlano = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
  return { tokenPlano, tokenHash };
}

/**
 * Verifica si un usuario tiene rol de Scrum Master en un proyecto específico.
 */
export async function puedeGestionar(proyectoId, usuario) {
  if (!usuario?.id) return false;
  const { rows } = await query(
    "SELECT 1 FROM miembros_proyecto WHERE proyecto_id = $1 AND usuario_id = $2 AND rol = 'scrum_master'",
    [proyectoId, usuario.id]
  );
  return rows.length > 0;
}

async function exigirGestion(proyectoId, usuario) {
  if (!(await puedeGestionar(proyectoId, usuario))) {
    lanzar(403, 'Solo el Scrum Master del proyecto puede realizar esta acción.');
  }
}

async function exigirMiembroEquipo(equipoId, usuario) {
  const { rows } = await query(
    'SELECT 1 FROM miembros_equipo WHERE equipo_id = $1 AND usuario_id = $2',
    [equipoId, usuario.id]
  );
  if (rows.length === 0) {
    lanzar(403, 'Debes pertenecer al equipo para realizar esta acción.');
  }
}

export const DOD_BASE = [
  'Código revisado por al menos un compañero',
  'Pruebas aprobadas',
  'Documentación actualizada',
  'Despliegue validado',
].map((linea) => `- ${linea}`).join('\n');

const COLUMNAS = `p.id, p.equipo_id, e.nombre AS equipo_nombre, p.nombre, p.vision,
  p.fecha_inicio::text AS fecha_inicio, p.fecha_fin::text AS fecha_fin,
  p.definition_of_done, p.archivado, p.version, p.creado_por, p.creado_en,
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
    miembros: esCreacion && Array.isArray(datos.miembros) ? datos.miembros : []
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
  const { rows } = await query(
    `SELECT ${COLUMNAS},
       EXISTS (
         SELECT 1
         FROM miembros_proyecto mp
         WHERE mp.proyecto_id = p.id
           AND mp.usuario_id = $2
           AND mp.rol = 'scrum_master'
       ) AS puede_gestionar
     ${DESDE}
     WHERE p.archivado = $1
       AND p.equipo_id IN (
         SELECT equipo_id
         FROM miembros_equipo
         WHERE usuario_id = $2
       )
     ORDER BY p.creado_en DESC`,
    [archivados, usuario.id],
  );
  return rows;
}

export async function obtener(id, usuario) {
  if (!id || id === 'null' || id === 'undefined') {
    return null; 
  }

  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE p.id = $1`, [id]);
  const proyecto = rows[0];
  if (!proyecto) return null; 

  const miembro = await query(
    'SELECT 1 FROM miembros_equipo WHERE equipo_id = $1 AND usuario_id = $2',
    [proyecto.equipo_id, usuario.id],
  );
  if (!miembro.rows.length) return null; 

  return proyecto;
}

export async function equiposDisponibles(usuario) {
  const { rows } = await query(
    `SELECT e.id, e.nombre 
     FROM equipos e
     JOIN miembros_equipo me ON e.id = me.equipo_id
     WHERE me.usuario_id = $1
     ORDER BY e.nombre`,
    [usuario.id]
  );
  return rows;
}

export async function crear(datos, usuario) {
  const limpio = validarDatos(datos, { esCreacion: true });

  await exigirMiembroEquipo(limpio.equipo_id, usuario);

  if (await existeNombre(limpio.equipo_id, limpio.nombre)) {
    lanzar(409, 'Ya existe un proyecto con ese nombre en el equipo.', ERROR_NOMBRE);
  }

  let proyectoId;
  let invitadosData = [];
  
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
      `INSERT INTO proyectos (equipo_id, nombre, vision, fecha_inicio, fecha_fin, definition_of_done, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [limpio.equipo_id, limpio.nombre, limpio.vision, limpio.fecha_inicio, limpio.fecha_fin, limpio.definition_of_done, usuario.id],
    );
    proyectoId = rows[0].id;

    // Aseguramos que quien crea se añada como gestor
    await cliente.query(
      `INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol) VALUES ($1, $2, 'scrum_master') ON CONFLICT DO NOTHING`,
      [proyectoId, usuario.id]
    );

    // Recopilar invitaciones
    for (const m of limpio.miembros) {
      if (m.usuario_id === usuario.id || !['scrum_master', 'product_owner', 'developer'].includes(m.rol)) continue;
      
      const { rows: uRows } = await cliente.query('SELECT id, correo, nombre FROM usuarios WHERE id = $1', [m.usuario_id]);
      if (!uRows.length) continue;

      const { tokenPlano, tokenHash } = generarToken();
      const expiraEn = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const { rows: invRows } = await cliente.query(`
        INSERT INTO invitaciones (correo, equipo_id, proyecto_id, rol, token_hash, expira_en, invitado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [uRows[0].correo, limpio.equipo_id, proyectoId, m.rol, tokenHash, expiraEn, usuario.id]);

      invitadosData.push({
          invitacionId: invRows[0].id,
          usuarioId: uRows[0].id,
          correo: uRows[0].correo,
          nombre: uRows[0].nombre,
          rol: m.rol,
          tokenPlano
      });
    }

    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    cliente.release();
    return traducirDuplicado(error);
  }
  
  cliente.release();

  // Ejecutar envíos y notificaciones fuera de la transacción
  if (invitadosData.length > 0) {
      const { notificar, TIPOS } = await import('../notificaciones/notificaciones.service.js');
      for (const inv of invitadosData) {
          const enlace = `${env.APP_URL}/pages/aceptar-invitacion.html?token=${inv.tokenPlano}`;
          
          // 1. Notificación in-app
          try {
              await notificar({
                  usuarioId: inv.usuarioId,
                  tipo: TIPOS.ASIGNACION,
                  titulo: 'Invitación a proyecto',
                  mensaje: `Has sido invitado al proyecto "${limpio.nombre}" con el rol de ${inv.rol}. Revisa tu correo o haz clic aquí para aceptar.`,
                  enlace: `/pages/aceptar-invitacion.html?token=${inv.tokenPlano}`
              });
          } catch (e) {
              console.error('[proyectos] Falló notificar in-app:', e);
          }

          // 2. Correo electrónico
          try {
              await enviarCorreo({
                  para: inv.correo,
                  asunto: `Invitación al proyecto ${limpio.nombre}`,
                  texto: `Hola ${inv.nombre},\n\nHas sido invitado al proyecto "${limpio.nombre}" con el rol de ${inv.rol}.\n\nPara aceptar o rechazar la invitación, ingresa aquí: ${enlace}`
              });
          } catch (e) {
              await query(`UPDATE invitaciones SET estado = 'fallida' WHERE id = $1`, [inv.invitacionId]);
          }
      }
  }

  return obtener(proyectoId, usuario);
}

export async function actualizar(id, datos, usuario) {
  await exigirGestion(id, usuario);

  const limpio = validarDatos(datos, { esCreacion: false });
  const versionCliente = Number(datos.version);
  if (!Number.isInteger(versionCliente)) lanzar(400, 'Falta la versión del proyecto.', { campos: {} });

  const actual = await obtener(id, usuario);
  if (!actual) lanzar(404, 'Proyecto no encontrado.');
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
  await exigirGestion(id, usuario);
  const proyectoActual = await obtener(id, usuario);
  if (!proyectoActual) lanzar(404, 'Proyecto no encontrado.');

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
    if (proyecto?.archivado) return proyecto;
    lanzar(409, 'El proyecto tiene un sprint activo. Cierra el sprint antes de archivarlo.', { motivo: 'sprint_activo' });
  }
  return obtener(id, usuario);
}