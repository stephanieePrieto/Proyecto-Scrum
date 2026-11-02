// Responsable: Jetz - HU-08: reglas, SQL y avisos por socket (tareas de una historia)

/**
 * @file tareas.service.js
 * @description Reglas y consultas de las tareas técnicas de una historia: crear, listar, editar y eliminar.
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */

import { consulta as query } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { notificarAsignacion } from '../notificaciones/notificaciones.service.js';
import { exigirPermiso, ROLES, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';

// HU-08: Crear una tarea técnica para una historia del Sprint.
export async function crear(datos = {}, usuario) {
  const historiaId = Number(datos.historia_id);
  const responsableId = Number(datos.responsable_id);
  const titulo = String(datos.titulo ?? '').trim();
  const descripcion = String(datos.descripcion ?? '').trim();
  const horas = Number(datos.horas_estimadas);

  // Validar los campos del formulario.
  if (!Number.isInteger(historiaId) || historiaId <= 0) {
    throw new ErrorApp('Selecciona una historia válida.', 400);
  }

  if (!titulo) {
    throw new ErrorApp('Escribe el título de la tarea.', 400);
  }


  if (!Number.isFinite(horas) || horas <= 0 ||
    horas > 99999.9 || Math.round(horas * 10) !== horas * 10) {
    throw new ErrorApp(
      'Las horas estimadas deben ser positivas y tener máximo un decimal.',
      400
    );
  }

  if (!Number.isInteger(responsableId) || responsableId <= 0) {
    throw new ErrorApp('Selecciona un responsable válido.', 400);
  }

  // Quien no tiene vínculo con el proyecto recibe el mismo 404 que si la historia no existiera
  const { rows: ubicacion } = await query('SELECT proyecto_id FROM historias WHERE id = $1', [historiaId]);
  if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  const rolActor = await exigirPermiso(usuario, 'proyecto.ver', ubicacion[0].proyecto_id);

  // Obtener la historia y comprobar su Sprint.
  const { rows: historias } = await query(
    `SELECT h.id, h.proyecto_id, h.sprint_id, s.estado
     FROM historias h
     JOIN sprints s ON s.id = h.sprint_id
       AND s.proyecto_id = h.proyecto_id
     JOIN proyectos p ON p.id = h.proyecto_id
     WHERE h.id = $1 AND p.archivado = FALSE`,
    [historiaId]
  );

  const historia = historias[0];

  if (!historia) {
    throw new ErrorApp(
      'La historia no pertenece a un Sprint válido de un proyecto activo.',
      404
    );
  }

  if (historia.estado !== 'planificado' &&
    historia.estado !== 'activo') {
    throw new ErrorApp(
      'No se pueden agregar tareas a un Sprint cerrado.',
      409
    );
  }

  // Solo un Scrum Master del proyecto puede planificar tareas.
  if (rolActor !== ROLES.SCRUM_MASTER) {
    throw new ErrorApp(
      'Solo el Scrum Master puede crear tareas durante la planificación.',
      403
    );
  }


  // HU-08: Permitir cualquier rol activo del proyecto.
  // TODO: Revisar los permisos definitivos con Stephy.
  const { rows: responsables } = await query(
    `SELECT 1
     FROM miembros_proyecto mp
     JOIN usuarios u ON u.id = mp.usuario_id
     JOIN proyectos p ON p.id = mp.proyecto_id
     JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
     WHERE mp.proyecto_id = $1
       AND mp.usuario_id = $2
       AND u.activo = TRUE`,
    [historia.proyecto_id, responsableId]
  );

  if (!responsables.length) {
    throw new ErrorApp(
      'El responsable debe ser un integrante activo del proyecto.',
      400
    );
  }


  // Guardar la tarea técnica.
  const { rows } = await query(
    `INSERT INTO tareas (
       historia_id,
       proyecto_id,
       sprint_id,
       titulo,
       descripcion,
       responsable_id,
       horas_estimadas
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      historia.id,
      historia.proyecto_id,
      historia.sprint_id,
      titulo,
      descripcion,
      responsableId,
      horas
    ]
  );

  // HU-24: avisar al responsable. No se espera ni puede hacer fallar la creación de la tarea.
  notificarAsignacion({
    tareaId: rows[0].id,
    responsableId,
    asignadorId: usuario.id,
  });

  return rows[0];
}

/**
 * HU-08: Listar las tareas técnicas de una historia.
 */
export async function listarPorHistoria(historiaId, usuario) {
  const id = Number(historiaId);

  // Validar el identificador de la historia.
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorApp('Selecciona una historia válida.', 400);
  }

  // Quien no tiene vínculo con el proyecto recibe el mismo 404 que si la historia no existiera
  const { rows: ubicacion } = await query('SELECT proyecto_id FROM historias WHERE id = $1', [id]);
  if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  await exigirPermiso(usuario, 'proyecto.ver', ubicacion[0].proyecto_id);

  // Comprobar que la historia existe y pertenece
  // a un proyecto activo.
  const { rows: historias } = await query(
    `SELECT h.id, h.proyecto_id
     FROM historias h
     JOIN proyectos p ON p.id = h.proyecto_id
     WHERE h.id = $1
       AND p.archivado = FALSE`,
    [id]
  );

  const historia = historias[0];

  if (!historia) {
    throw new ErrorApp('No se encontró la historia.', 404);
  }

  // Verificar que el usuario pertenece al proyecto.
  // Ya se comprobó arriba con exigirPermiso: sin vínculo vigente responde 404.

  // Consultar las tareas y el nombre del responsable.
  const { rows: tareas } = await query(
    `SELECT
       t.id,
       t.historia_id,
       t.titulo,
       t.descripcion,
       t.responsable_id,
       u.nombre AS responsable_nombre,
       t.horas_estimadas,
       t.sprint_id
     FROM tareas t
     LEFT JOIN usuarios u ON u.id = t.responsable_id
     WHERE t.historia_id = $1
       AND t.proyecto_id = $2
     ORDER BY t.id ASC`,
    [id, historia.proyecto_id]
  );

  return tareas;
}

/**
 * HU-08: Editar una tarea técnica existente.
 */
export async function editar(tareaId, datos = {}, usuario) {
  const id = Number(tareaId);
  const titulo = String(datos.titulo ?? '').trim();
  const descripcion = String(datos.descripcion ?? '').trim();
  const responsableId = Number(datos.responsable_id);
  const horasTexto = datos.horas_estimadas;
  const horas = Number(horasTexto);

  // Validar los datos recibidos.
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorApp('Selecciona una tarea válida.', 400);
  }

  if (!titulo) {
    throw new ErrorApp('Escribe el título de la tarea.', 400);
  }

  if (
    horasTexto === '' ||
    horasTexto === null ||
    horasTexto === undefined ||
    !Number.isFinite(horas) ||
    horas <= 0 ||
    horas > 99999.9 ||
    Math.abs(horas * 10 - Math.round(horas * 10)) > 1e-8
  ) {
    throw new ErrorApp(
      'Las horas deben ser positivas y tener máximo un decimal.',
      400
    );
  }

  if (!Number.isInteger(responsableId) || responsableId <= 0) {
    throw new ErrorApp('Selecciona un responsable válido.', 400);
  }

  // Quien no tiene vínculo con el proyecto recibe el mismo 404 que si la tarea no existiera
  const { rows: ubicacion } = await query('SELECT proyecto_id FROM tareas WHERE id = $1', [id]);
  if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  const rolActor = await exigirPermiso(usuario, 'proyecto.ver', ubicacion[0].proyecto_id);

  // Buscar la tarea y comprobar que pertenece a un Sprint válido.
  const { rows: tareas } = await query(
    `SELECT t.id, t.proyecto_id, s.estado
     FROM tareas t
     JOIN historias h ON h.id = t.historia_id
       AND h.proyecto_id = t.proyecto_id
       AND h.sprint_id = t.sprint_id
     JOIN sprints s ON s.id = t.sprint_id
       AND s.proyecto_id = t.proyecto_id
     JOIN proyectos p ON p.id = t.proyecto_id
     WHERE t.id = $1
       AND p.archivado = FALSE`,
    [id]
  );

  const tarea = tareas[0];

  if (!tarea) {
    throw new ErrorApp('No se encontró la tarea técnica.', 404);
  }

  if (tarea.estado !== 'planificado' && tarea.estado !== 'activo') {
    throw new ErrorApp(
      'No se pueden editar tareas de un Sprint cerrado.',
      409
    );
  }

  // Comprobar que el usuario puede planificar tareas.
  if (rolActor !== ROLES.SCRUM_MASTER) {
    throw new ErrorApp(
      'No tienes permiso para editar tareas de este proyecto.',
      403
    );
  }


  // HU-08: Permitir cualquier rol activo del proyecto.
  // TODO: Revisar los permisos definitivos con Stephy.
  const { rows: responsables } = await query(
    `SELECT 1
     FROM miembros_proyecto mp
     JOIN usuarios u ON u.id = mp.usuario_id
     JOIN proyectos p ON p.id = mp.proyecto_id
     JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
     WHERE mp.proyecto_id = $1
       AND mp.usuario_id = $2
       AND u.activo = TRUE`,
    [tarea.proyecto_id, responsableId]
  );

  if (!responsables.length) {
    throw new ErrorApp(
      'El responsable debe ser un integrante activo del proyecto.',
      400
    );
  }

  if (!responsables.length) {
    throw new ErrorApp(
      'El responsable debe ser un integrante activo del proyecto.',
      400
    );
  }

  // Actualizar la tarea sin modificar su historia ni su Sprint.
  const { rows } = await query(
    `UPDATE tareas
     SET titulo = $1,
         descripcion = $2,
         responsable_id = $3,
         horas_estimadas = $4
     WHERE id = $5
       AND proyecto_id = $6
     RETURNING *`,
    [
      titulo,
      descripcion,
      responsableId,
      horas,
      id,
      tarea.proyecto_id
    ]
  );

  return rows[0];
}

/**
 * HU-08: Eliminar una tarea técnica.
 * No permite eliminar tareas con horas de trabajo registradas.
 */
export async function eliminar(tareaId, usuario) {
  const id = Number(tareaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorApp('Selecciona una tarea válida.', 400);
  }

  // Quien no tiene vínculo con el proyecto recibe el mismo 404 que si la tarea no existiera
  const { rows: ubicacion } = await query('SELECT proyecto_id FROM tareas WHERE id = $1', [id]);
  if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  const rolActor = await exigirPermiso(usuario, 'proyecto.ver', ubicacion[0].proyecto_id);

  // Buscar la tarea y comprobar que su proyecto está activo.
  const { rows: tareas } = await query(
    `SELECT t.id, t.proyecto_id, s.estado
     FROM tareas t
     JOIN sprints s ON s.id = t.sprint_id
       AND s.proyecto_id = t.proyecto_id
     JOIN proyectos p ON p.id = t.proyecto_id
     WHERE t.id = $1
       AND p.archivado = FALSE`,
    [id]
  );

  const tarea = tareas[0];

  if (!tarea) {
    throw new ErrorApp('No se encontró la tarea técnica.', 404);
  }

  // No permitir cambios en Sprints cerrados.
  if (tarea.estado !== 'planificado' && tarea.estado !== 'activo') {
    throw new ErrorApp(
      'No se pueden eliminar tareas de un Sprint cerrado.',
      409
    );
  }

  // Verificar permisos del Scrum Master.
  if (rolActor !== ROLES.SCRUM_MASTER) {
    throw new ErrorApp(
      'No tienes permiso para eliminar tareas de este proyecto.',
      403
    );
  }

  // Evitar borrar tareas con horas reales registradas.
  const { rows: registros } = await query(
    `SELECT 1
     FROM registros_horas
     WHERE tarea_id = $1
     LIMIT 1`,
    [id]
  );

  if (registros.length) {
    throw new ErrorApp(
      'No puedes eliminar esta tarea porque ya tiene horas de trabajo registradas.',
      409
    );
  }

  // Eliminar solamente la tarea indicada.
  const { rows } = await query(
    `DELETE FROM tareas
     WHERE id = $1
       AND proyecto_id = $2
       AND NOT EXISTS (
         SELECT 1
         FROM registros_horas
         WHERE tarea_id = $1
       )
     RETURNING id`,
    [id, tarea.proyecto_id]
  );

  if (!rows.length) {
    throw new ErrorApp(
      'No se pudo eliminar la tarea. Verifica que no tenga horas registradas.',
      409
    );
  }

  return {
    mensaje: 'Tarea técnica eliminada correctamente.',
    id: rows[0].id
  };
}