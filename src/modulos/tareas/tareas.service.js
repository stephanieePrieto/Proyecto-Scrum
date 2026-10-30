// Responsable: Jetz - HU-08: reglas, SQL y avisos por socket (tareas de una historia)

import { consulta as query } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

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
  const { rows: permisos } = await query(
    `SELECT 1 FROM miembros_proyecto
     WHERE proyecto_id = $1
       AND usuario_id = $2
       AND rol = 'scrum_master'`,
    [historia.proyecto_id, usuario.id]
  );

  if (!permisos.length) {
    throw new ErrorApp(
      'Solo el Scrum Master puede crear tareas durante la planificación.',
      403
    );
  }

  // El responsable debe ser un developer activo del proyecto.
  const { rows: responsables } = await query(
    `SELECT 1
     FROM miembros_proyecto mp
     JOIN usuarios u ON u.id = mp.usuario_id
     WHERE mp.proyecto_id = $1
       AND mp.usuario_id = $2
       AND mp.rol = 'developer'
       AND u.activo = TRUE`,
    [historia.proyecto_id, responsableId]
  );

  if (!responsables.length) {
    throw new ErrorApp(
      'El responsable debe ser un developer activo del proyecto.',
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
  const { rows: permisos } = await query(
    `SELECT 1
     FROM miembros_proyecto
     WHERE proyecto_id = $1
       AND usuario_id = $2`,
    [historia.proyecto_id, usuario.id]
  );

  if (!permisos.length) {
    throw new ErrorApp(
      'No tienes permiso para consultar las tareas de esta historia.',
      403
    );
  }

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
