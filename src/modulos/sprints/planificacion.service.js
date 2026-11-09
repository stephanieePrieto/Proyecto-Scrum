// HU-07: comprometer historias en un sprint. Todas las comprobaciones son por proyecto.
import { pool } from '../../config/db.js';
import { obtenerRolProyecto, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { emitirAProyecto } from '../../sockets/emisor.js';

function fallo(codigo, mensaje) { throw new ErrorApp(mensaje, codigo); }
const idValido = valor => Number.isSafeInteger(Number(valor)) && Number(valor) > 0;

export async function comprometerHistoria(usuario, proyectoId, sprintId, historiaId, datos = {}) {
  if (![proyectoId, sprintId, historiaId, datos.version].every(idValido)) {
    fallo(400, 'Identificadores o versión de la historia no válidos. Actualiza la planificación.');
  }
  const proyecto = Number(proyectoId), sprint = Number(sprintId), historia = Number(historiaId);
  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    // Bloquear el sprint serializa compromisos simultáneos y evita exceder capacidad por carreras.
    const { rows: sprints } = await cliente.query(
      `SELECT s.id, s.proyecto_id, s.estado, s.capacidad_horas, p.archivado
       FROM sprints s JOIN proyectos p ON p.id = s.proyecto_id
       WHERE s.id = $1 AND s.proyecto_id = $2 FOR UPDATE OF s`, [sprint, proyecto]);
    if (!sprints.length) fallo(404, MENSAJE_NO_ENCONTRADO);
    if (sprints[0].archivado) fallo(409, 'No se puede planificar un proyecto archivado.');
    if (sprints[0].estado === 'cerrado') fallo(409, 'No se pueden agregar historias a un sprint cerrado.');

    const rol = await obtenerRolProyecto(usuario, proyecto, cliente);
    if (!rol) fallo(404, MENSAJE_NO_ENCONTRADO);
    if (!['scrum_master', 'product_owner'].includes(rol)) fallo(403, 'No tienes permiso para planificar este proyecto.');
    if (sprints[0].estado === 'activo' && datos.confirmarSprintIniciado !== true) {
      fallo(409, 'El sprint ya inició. Confirma que deseas cambiar su planificación.');
    }

    const { rows: historias } = await cliente.query(
      `SELECT id, proyecto_id, sprint_id, puntos, estado, propuesta, version
       FROM historias WHERE id = $1 FOR UPDATE`, [historia]);
    if (!historias.length || Number(historias[0].proyecto_id) !== proyecto) {
      fallo(404, MENSAJE_NO_ENCONTRADO);
    }
    const h = historias[0];
    if (h.sprint_id !== null || h.estado !== 'backlog') {
      const { rows: autor } = await cliente.query(
        `SELECT u.nombre FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
         WHERE b.proyecto_id = $1 AND b.objeto = 'historia' AND b.objeto_id = $2
           AND b.accion = 'historia_estado_cambiado'
           AND b.detalle->'despues'->>'sprint_id' = $3
         ORDER BY b.id DESC LIMIT 1`, [proyecto, historia, String(h.sprint_id)]);
      fallo(409, `Esta historia ya fue movida${autor[0]?.nombre ? ` por ${autor[0].nombre}` : ' por otro planificador'}. Actualiza la planificación.`);
    }
    if (Number(h.version) !== Number(datos.version)) fallo(409, 'La historia cambió. Actualiza la planificación.');
    if (h.propuesta) fallo(409, 'La propuesta debe aceptarse antes de planificarla.');
    if (h.puntos === null) fallo(400, 'Esta historia no tiene puntos estimados. Estímala antes de agregarla.');

    const { rows: [carga] } = await cliente.query(
      `SELECT COUNT(*)::int AS cantidad,
              COALESCE(SUM(t.horas_estimadas), 0)::numeric AS horas
       FROM tareas t WHERE t.historia_id = $1 AND t.proyecto_id = $2`, [historia, proyecto]);
    const { rows: [compromiso] } = await cliente.query(
      `SELECT COALESCE(SUM(t.horas_estimadas), 0)::numeric AS horas
       FROM tareas t JOIN historias h ON h.id = t.historia_id
       WHERE h.proyecto_id = $1 AND h.sprint_id = $2`, [proyecto, sprint]);
    const horasNuevas = Number(compromiso.horas) + Number(carga.horas);
    const capacidad = Number(sprints[0].capacidad_horas);
    const porcentaje = horasNuevas / capacidad * 100;
    const justificacion = typeof datos.justificacion === 'string' ? datos.justificacion.trim() : '';
    if (porcentaje > 100 && (rol !== 'scrum_master' || justificacion.length < 10)) {
      fallo(409, rol === 'scrum_master'
        ? 'La capacidad supera el 100 %. Escribe una justificación de al menos 10 caracteres.'
        : 'La capacidad supera el 100 %. Solo el Scrum Master puede justificar y confirmar este compromiso.');
    }
    if (justificacion.length > 1000) fallo(400, 'La justificación no puede superar 1000 caracteres.');

    await cliente.query(
      `UPDATE historias SET sprint_id = $1, estado = 'en_sprint', version = version + 1
       WHERE id = $2 AND proyecto_id = $3`, [sprint, historia, proyecto]);
    await cliente.query(
      `UPDATE tareas SET sprint_id = $1, actualizado_en = NOW()
       WHERE historia_id = $2 AND proyecto_id = $3`, [sprint, historia, proyecto]);
    await registrarAuditoria(cliente, {
      usuarioId: usuario.id, proyectoId: proyecto, accion: ACCIONES.HISTORIA_ESTADO_CAMBIADO,
      objeto: OBJETOS.HISTORIA, objetoId: historia,
      antes: { sprint_id: null, estado: 'backlog' },
      despues: { sprint_id: sprint, estado: 'en_sprint' },
      contexto: { justificacion: porcentaje > 100 ? justificacion : null, porcentaje_capacidad: porcentaje },
      emitirEvento: false,
    });
    await cliente.query('COMMIT');
    resultado = {
      mensaje: 'Historia agregada al sprint.', sprint_id: sprint, historia_id: historia,
      horas_comprometidas: horasNuevas, capacidad_horas: capacidad, porcentaje,
      aviso: Number(carga.cantidad) === 0 || Number(carga.horas) === 0
        ? 'La historia no tiene tareas u horas estimadas; no suma horas al medidor.' : null,
    };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
  emitirAProyecto(proyecto, 'story:updated', { id: historia, proyecto_id: proyecto, sprint_id: sprint });
  return resultado;
}


// HU-07 (complemento): devolver una historia al Product Backlog sin borrar sus tareas.
// Se comprueba el proyecto/sprint de origen, el rol y la versión dentro de la transacción.
export async function devolverHistoriaPlanificada(usuario, proyectoId, sprintId, historiaId, datos = {}) {
  if (![proyectoId, sprintId, historiaId, datos.version].every(idValido)) {
    fallo(400, 'Identificadores o versión no válidos. Actualiza la planificación.');
  }
  const proyecto = Number(proyectoId), sprint = Number(sprintId), historia = Number(historiaId);
  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    const { rows: sprints } = await cliente.query(
      `SELECT s.id, s.estado, p.archivado
       FROM sprints s JOIN proyectos p ON p.id = s.proyecto_id
       WHERE s.id = $1 AND s.proyecto_id = $2 FOR UPDATE OF s`, [sprint, proyecto]);
    if (!sprints.length) fallo(404, MENSAJE_NO_ENCONTRADO);
    if (sprints[0].archivado) fallo(409, 'No se puede planificar un proyecto archivado.');
    if (sprints[0].estado === 'cerrado') fallo(409, 'No se puede modificar un sprint cerrado.');

    const rol = await obtenerRolProyecto(usuario, proyecto, cliente);
    if (!rol) fallo(404, MENSAJE_NO_ENCONTRADO);
    if (!['scrum_master', 'product_owner'].includes(rol)) {
      fallo(403, 'No tienes permiso para planificar este proyecto.');
    }
    if (sprints[0].estado === 'activo' && datos.confirmarSprintIniciado !== true) {
      fallo(409, 'El sprint ya inició. Confirma que deseas cambiar su planificación.');
    }
    if (datos.confirmarDevolucion !== true) {
      fallo(400, 'Debes confirmar la devolución de la historia al Product Backlog.');
    }

    const { rows: historias } = await cliente.query(
      `SELECT id, proyecto_id, sprint_id, estado, version
       FROM historias WHERE id = $1 FOR UPDATE`, [historia]);
    if (!historias.length || Number(historias[0].proyecto_id) !== proyecto) {
      fallo(404, MENSAJE_NO_ENCONTRADO);
    }
    const h = historias[0];
    if (Number(h.sprint_id) !== sprint || h.estado !== 'en_sprint') {
      fallo(409, 'La historia ya no está planificada en este sprint. Actualiza la página.');
    }
    if (Number(h.version) !== Number(datos.version)) {
      fallo(409, 'La historia cambió mientras la planificabas. Actualiza la página.');
    }

    const { rows: [tareas] } = await cliente.query(
      `SELECT COUNT(*)::int AS cantidad FROM tareas
       WHERE historia_id = $1 AND proyecto_id = $2`, [historia, proyecto]);
    // No se eliminan tareas. Se desvinculan del sprint y de su columna del tablero.
    await cliente.query(
      `UPDATE historias SET sprint_id = NULL, estado = 'backlog', version = version + 1
       WHERE id = $1 AND proyecto_id = $2`, [historia, proyecto]);
    await cliente.query(
      `UPDATE tareas SET sprint_id = NULL, columna_id = NULL, actualizado_en = NOW()
       WHERE historia_id = $1 AND proyecto_id = $2`, [historia, proyecto]);
    await registrarAuditoria(cliente, {
      usuarioId: usuario.id, proyectoId: proyecto, accion: ACCIONES.HISTORIA_ESTADO_CAMBIADO,
      objeto: OBJETOS.HISTORIA, objetoId: historia,
      antes: { sprint_id: sprint, estado: h.estado },
      despues: { sprint_id: null, estado: 'backlog' },
      contexto: { tareas_conservadas: Number(tareas.cantidad) },
      emitirEvento: false,
    });
    await cliente.query('COMMIT');
    resultado = {
      mensaje: 'Historia devuelta al Product Backlog.', historia_id: historia,
      tareas_conservadas: Number(tareas.cantidad),
      aviso: Number(tareas.cantidad) > 0
        ? `Se conservaron ${tareas.cantidad} tarea(s) técnica(s), desvinculadas del sprint y del tablero.`
        : null,
    };
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
  emitirAProyecto(proyecto, 'story:updated', { id: historia, proyecto_id: proyecto, sprint_id: null });
  return resultado;
}
