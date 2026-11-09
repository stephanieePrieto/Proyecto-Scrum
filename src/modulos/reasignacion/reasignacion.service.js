// Responsable: Alfonso - HU-21: reglas, SQL y avisos por socket (reasignar una tarea al soltarla en el carril de otra persona)
/**
 * @file reasignacion.service.js
 * @description Cambia el responsable de una tarea cuando un integrante la arrastra al carril de otra persona
 *              en el tablero agrupado por persona (HU-21, criterio 4). Es la única acción de la HU que modifica
 *              datos; filtrar y agrupar solo cambian la vista.
 *
 *   1. Valida los identificadores y que la tarea pertenezca al proyecto autorizado por la ruta.
 *   2. No permite reasignar en proyectos archivados ni en sprints cerrados.
 *   3. La persona destino debe ser integrante activo del proyecto (mismo criterio que HU-08).
 *   4. Si el cliente envía el responsable que veía, se comprueba que nadie lo cambió mientras tanto (409).
 *   5. Guarda el cambio y la auditoría en una transacción; después notifica a la persona y avisa por socket.
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { registrarAuditoria, enTransaccion, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { notificarAsignacion } from '../notificaciones/notificaciones.service.js';

/** Evento que escucha el tablero (reconexion.js) para reflejar cambios de otras personas en vivo. */
export const EVENTO_TABLERO = 'tablero:tarjeta_movida';

/**
 * Convierte un valor a entero positivo; devuelve null si no lo es.
 * @param {*} valor
 * @returns {number|null}
 */
function leerEntero(valor) {
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean') return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 && numero <= 2147483647 ? numero : null;
}

/**
 * Reasigna una tarea del tablero a otra persona del proyecto.
 *
 * @param {Object} params
 * @param {number} params.proyectoId - Proyecto ya autorizado por requierePermiso('tarea.gestionar').
 * @param {number|string} params.tareaId - Tarea a reasignar.
 * @param {*} params.responsableId - Persona que recibe la tarea.
 * @param {*} [params.responsableAnteriorId] - Responsable que veía el cliente (null = sin asignar). Si no se envía,
 *                                              no se comprueba el conflicto.
 * @param {{id: number}} params.usuario - Persona que hace la reasignación.
 * @returns {Promise<{id: number, columna_id: number|null, responsable_id: number, responsable: string, version: number}>}
 * @throws {ErrorApp} 400 datos inválidos, 404 tarea inexistente, 409 proyecto archivado, sprint cerrado,
 *                    misma persona o el responsable cambió mientras tanto.
 */
export async function reasignarTarea({ proyectoId, tareaId, responsableId, responsableAnteriorId, usuario }) {
  const id = leerEntero(tareaId);
  const destino = leerEntero(responsableId);
  if (!id) throw new ErrorApp('Selecciona una tarea válida.', 400);
  if (!destino) throw new ErrorApp('Selecciona a la persona que recibirá la tarea.', 400);

  const comprobarAnterior = responsableAnteriorId !== undefined;
  const anterior = responsableAnteriorId === null || responsableAnteriorId === '' ? null : leerEntero(responsableAnteriorId);
  if (comprobarAnterior && responsableAnteriorId !== null && responsableAnteriorId !== '' && anterior === null) {
    throw new ErrorApp('El responsable anterior no es válido.', 400);
  }

  const { rows: tareas } = await consulta(
    `SELECT t.id, p.archivado, s.estado AS estado_sprint
       FROM tareas t
       JOIN proyectos p ON p.id = t.proyecto_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
      WHERE t.id = $1 AND t.proyecto_id = $2`,
    [id, proyectoId],
  );
  if (!tareas.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  if (tareas[0].archivado) throw new ErrorApp('El proyecto está archivado; no se pueden reasignar sus tareas.', 409);
  if (tareas[0].estado_sprint === 'cerrado') throw new ErrorApp('No se pueden reasignar tareas de un sprint cerrado.', 409);

  // Mismo criterio que HU-08 (tareas.service.js): integrante activo del proyecto y de su equipo
  const { rows: personas } = await consulta(
    `SELECT u.nombre
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND mp.usuario_id = $2 AND u.activo = TRUE`,
    [proyectoId, destino],
  );
  if (!personas.length) throw new ErrorApp('La persona elegida no es un integrante activo del proyecto.', 400);
  const nombreDestino = personas[0].nombre;

  const actualizada = await enTransaccion(async (cliente) => {
    const { rows: bloqueadas } = await cliente.query(
      'SELECT responsable_id FROM tareas WHERE id = $1 AND proyecto_id = $2 FOR UPDATE',
      [id, proyectoId],
    );
    if (!bloqueadas.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    const actual = bloqueadas[0].responsable_id;

    if (comprobarAnterior && actual !== anterior) {
      throw new ErrorApp('Alguien cambió el responsable de esta tarea mientras tanto. Recarga el tablero e intenta de nuevo.', 409);
    }
    if (actual === destino) throw new ErrorApp('La tarea ya está asignada a esa persona.', 409);

    const { rows } = await cliente.query(
      `UPDATE tareas
          SET responsable_id = $1, version = version + 1, actualizado_en = NOW()
        WHERE id = $2 AND proyecto_id = $3
        RETURNING id, columna_id, responsable_id, version`,
      [destino, id, proyectoId],
    );

    await registrarAuditoria(cliente, {
      usuarioId: usuario.id,
      proyectoId,
      accion: ACCIONES.TAREA_MODIFICADA,
      objeto: OBJETOS.TAREA,
      objetoId: id,
      antes: { responsable_id: actual },
      despues: { responsable_id: destino },
    });

    return rows[0];
  });

  // Después del COMMIT: avisar a la persona (si falla, notificarAsignacion solo lo registra en consola)
  await notificarAsignacion({ tareaId: id, responsableId: destino, asignadorId: usuario.id });

  const { rows: actor } = await consulta('SELECT nombre FROM usuarios WHERE id = $1', [usuario.id]);
  emitirAProyecto(proyectoId, EVENTO_TABLERO, {
    tipo: 'reasignacion',
    proyectoId: Number(proyectoId),
    tareaId: id,
    columnaId: actualizada.columna_id,
    responsableId: destino,
    responsable: nombreDestino,
    usuarioNombre: actor[0]?.nombre || 'Un compañero',
  });

  return { ...actualizada, responsable: nombreDestino };
}
