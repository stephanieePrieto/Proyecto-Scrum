// Responsable: Jetz - HU-06, HU-07: reglas, SQL y avisos por socket (crear y planificar sprints)

import { consulta, pool } from '../../config/db.js';
import { tienePermiso } from '../../utils/permisos.js';
import { registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';

/**
 * @file sprints.service.js
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */

// HU-06: Consultar los sprints existentes de un proyecto
export async function obtenerSprintsProyecto(proyectoId) {

  const resultado = await consulta(
    `SELECT id, proyecto_id, nombre, objetivo,
            fecha_inicio, fecha_fin, capacidad_horas, estado
     FROM sprints
     WHERE proyecto_id = $1
     ORDER BY fecha_inicio ASC`,
    [proyectoId]
  );

  return resultado.rows;
}


// Comprobar si las fechas coinciden con otro sprint del equipo
export async function verificarSolapamiento(equipoId, fechaInicio, fechaFin) {

  const resultado = await consulta(
    `SELECT s.id, s.nombre, s.fecha_inicio, s.fecha_fin
     FROM sprints s
     JOIN proyectos p ON p.id = s.proyecto_id
     WHERE p.equipo_id = $1
       AND s.fecha_inicio <= $3
       AND s.fecha_fin >= $2
     LIMIT 1`,
    [equipoId, fechaInicio, fechaFin]
  );

  // Si encontramos un sprint, significa que las fechas se cruzan
  return resultado.rows.length > 0;
}


// Guardar un nuevo sprint en PostgreSQL
export async function guardarSprint(datos) {

  const resultado = await consulta(
    `INSERT INTO sprints (
       proyecto_id,
       nombre,
       objetivo,
       fecha_inicio,
       fecha_fin,
       capacidad_horas,
       estado
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'planificado')
     RETURNING *`,
    [
      datos.proyectoId,
      datos.nombre,
      datos.objetivo,
      datos.fechaInicio,
      datos.fechaFin,
      datos.capacidadHoras
    ]
  );

  // Devolver el sprint que se acaba de crear
  return resultado.rows[0];
}


// Validar los datos antes de crear un sprint
export function validarDatosSprint(datos) {

  // El nombre es obligatorio
  if (typeof datos.nombre !== 'string' || !datos.nombre.trim()) {
    return 'El nombre del sprint es obligatorio';
  }

  // El objetivo es obligatorio
  if (typeof datos.objetivo !== 'string' || !datos.objetivo.trim()) {
    return 'El objetivo del sprint es obligatorio';
  }

  // Las fechas son obligatorias
  if (!datos.fechaInicio || !datos.fechaFin) {
    return 'Debes seleccionar las fechas del sprint';
  }

  // Comprobar que las fechas sean reales
  if (!esFechaValida(datos.fechaInicio) ||
    !esFechaValida(datos.fechaFin)) {
    return 'Las fechas del sprint no son válidas';
  }

  // La fecha final debe ser posterior a la inicial
  if (datos.fechaFin <= datos.fechaInicio) {
    return 'La fecha final debe ser posterior a la inicial';
  }

  // Si todo es correcto, no hay errores
  return null;
}


//Comprobar que una fecha exista y tenga formato YYYY-MM-DD
function esFechaValida(fecha) {
  if (typeof fecha !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return false;
  }

  const fechaConvertida = new Date(`${fecha}T00:00:00Z`);

  return !Number.isNaN(fechaConvertida.getTime()) &&
    fechaConvertida.toISOString().slice(0, 10) === fecha;
}


// Verificar si el usuario es Scrum Master del proyecto
export async function esScrumMaster(proyectoId, usuarioId) {

  // true si el usuario tiene el rol Scrum Master y sigue en el equipo del proyecto
  return tienePermiso({ id: usuarioId }, 'sprint.gestionar', proyectoId);
}

// Obtener el equipo asociado a un proyecto
export async function obtenerEquipoProyecto(proyectoId) {
  const resultado = await consulta(
    `SELECT equipo_id
     FROM proyectos
     WHERE id = $1`,
    [proyectoId]
  );

  // Si el proyecto no existe, devolver null
  if (resultado.rows.length === 0) {
    return null;
  }

  return resultado.rows[0].equipo_id;
}

// Obtener las fechas permitidas para los sprints del proyecto
export async function obtenerFechasProyecto(proyectoId) {
  const resultado = await consulta(
    `SELECT
       TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
       TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
     FROM proyectos
     WHERE id = $1`,
    [proyectoId]
  );

  // Si no existe el proyecto, devolver null
  if (resultado.rows.length === 0) {
    return null;
  }

  return resultado.rows[0];
}

// Guardar un sprint evitando conflictos de fechas
export async function crearSprintSeguro(datos, equipoId, usuarioId) {
  const cliente = await pool.connect();
  try {
    // Iniciar la transacción
    await cliente.query('BEGIN');
    //  Comprobar nuevamente los permisos
    // antes de guardar el sprint
    const permisos = await cliente.query(
      `SELECT 1
       FROM miembros_proyecto mp
       WHERE mp.proyecto_id = $1
         AND mp.usuario_id = $2
         AND mp.rol = 'scrum_master'
         AND EXISTS (
           SELECT 1 FROM proyectos p
           JOIN miembros_equipo me ON me.equipo_id = p.equipo_id
           WHERE p.id = mp.proyecto_id AND me.usuario_id = mp.usuario_id
         )
       FOR UPDATE OF mp`,
      [datos.proyectoId, usuarioId]
    );

    if (permisos.rows.length === 0) {
      await cliente.query('ROLLBACK');

      return {
        conflicto: false,
        permisoDenegado: true,
        sprint: null
      };
    }

    // Bloquear creaciones simultáneas para este equipo
    await cliente.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [6006, equipoId]
    );

    // Verificar y bloquear el proyecto durante el guardado


    const proyecto = await cliente.query(
      `SELECT
        equipo_id,
        fecha_inicio::text AS fecha_inicio,
        fecha_fin::text AS fecha_fin
    FROM proyectos
    WHERE id = $1
    FOR UPDATE`,
      [datos.proyectoId]
    );


    // Comprobar que el proyecto siga existiendo
    // y pertenezca al equipo esperado
    if (
      proyecto.rows.length === 0 ||
      Number(proyecto.rows[0].equipo_id) !== Number(equipoId)
    ) {
      await cliente.query('ROLLBACK');

      return {
        conflicto: false,
        proyectoInvalido: true,
        sprint: null
      };
    }


    // Comprobar nuevamente las fechas del proyecto
    const fechasProyecto = proyecto.rows[0];

    if (
      datos.fechaInicio < fechasProyecto.fecha_inicio ||
      datos.fechaFin > fechasProyecto.fecha_fin
    ) {
      await cliente.query('ROLLBACK');

      return {
        conflicto: false,
        fechasInvalidas: true,
        sprint: null
      };
    }



    // Comprobar nuevamente los solapamientos
    const conflictos = await cliente.query(
      `SELECT s.id
       FROM sprints s
       INNER JOIN proyectos p ON p.id = s.proyecto_id
       WHERE p.equipo_id = $1
         AND s.fecha_inicio <= $3
         AND s.fecha_fin >= $2
       LIMIT 1`,
      [equipoId, datos.fechaInicio, datos.fechaFin]
    );

    if (conflictos.rows.length > 0) {
      await cliente.query('ROLLBACK');

      return {
        conflicto: true,
        sprint: null
      };
    }

    // Guardar el nuevo sprint
    const resultado = await cliente.query(
      `INSERT INTO sprints (
         proyecto_id,
         nombre,
         objetivo,
         fecha_inicio,
         fecha_fin,
         capacidad_horas,
         estado
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'planificado')
       RETURNING *`,
      [
        datos.proyectoId,
        datos.nombre.trim(),
        datos.objetivo.trim(),
        datos.fechaInicio,
        datos.fechaFin,
        datos.capacidadHoras
      ]
    );

    await registrarAuditoria(cliente, {
      usuarioId,
      proyectoId: datos.proyectoId,
      accion: ACCIONES.SPRINT_CREADO,
      objeto: OBJETOS.SPRINT,
      objetoId: resultado.rows[0].id,
      despues: {
        nombre: datos.nombre.trim(),
        objetivo: datos.objetivo.trim(),
        fecha_inicio: datos.fechaInicio,
        fecha_fin: datos.fechaFin,
        capacidad_horas: datos.capacidadHoras
      }
    });

    // Confirmar los cambios
    await cliente.query('COMMIT');

    return {
      conflicto: false,
      sprint: resultado.rows[0]
    };

  } catch (error) {
    // Deshacer los cambios si ocurre un error
    await cliente.query('ROLLBACK');
    throw error;

  } finally {
    // Liberar la conexión
    cliente.release();
  }
}

export async function perteneceAlProyecto(proyectoId, usuarioId) {
  return tienePermiso({ id: usuarioId }, 'proyecto.ver', proyectoId);
}