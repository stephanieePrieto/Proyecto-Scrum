// Responsable: Alfonso - HU-26: consultas y reglas del flujo continuo (cambio de modo, resumen de migración y tiempos de flujo).
/**
 * @file flujo-continuo.service.js
 * @description Servicio de la HU-26 (Kanban continuo). Responsabilidades:
 *  1. Resumen previo a un cambio de modo: tareas abiertas por columna, sprint activo e historias en sprint.
 *  2. Cambiar el modo del proyecto (Scrum <-> continuo) sin tocar tareas, historias, historial ni sprints:
 *     solo actualiza proyectos.modo_flujo. Usa control de versión optimista (dos personas a la vez → la segunda
 *     recibe conflicto), queda en la bitácora y avisa a los tableros abiertos por Socket.io.
 *  3. Lead Time y Cycle Time de las tarjetas terminadas, calculados con flujo-continuo.calculo.js.
 *  4. Opciones del formulario "+ Tarea" del tablero en modo continuo (historias abiertas e integrantes).
 *
 * Los permisos los valida la ruta con requierePermiso; aquí solo viven las reglas del proyecto.
 *
 * @author Alfonso Mendoza Vasquez
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { MENSAJE_NO_ENCONTRADO, ROLES } from '../../utils/permisos.js';
import { registrarAuditoria, enTransaccion, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { ACCION_CAMBIO_COLUMNA } from '../burnup/burnup.registro.js';
import { MODOS, RESULTADOS_CAMBIO, calcularTiemposFlujo, evaluarCambioModo, normalizarDias } from './flujo-continuo.calculo.js';

/** Evento que reciben los tableros abiertos cuando cambia el modo del proyecto. */
export const EVENTO_MODO_CAMBIADO = 'proyecto:modo-cambiado';

/** Crea un ErrorApp con datos adicionales para la pantalla (motivo, conflicto, etc.). */
function error(estado, mensaje, detalles) {
  const fallo = new ErrorApp(mensaje, estado);
  if (detalles) fallo.detalles = detalles;
  return fallo;
}

/**
 * Lee lo mínimo del proyecto para decidir un cambio de modo.
 * @param {number} proyectoId
 * @returns {Promise<{id: number, nombre: string, modo_flujo: string, version: number, archivado: boolean}>}
 * @throws {ErrorApp} 404 si el proyecto no existe.
 */
async function leerProyecto(proyectoId) {
  const { rows } = await consulta(
    'SELECT id, nombre, modo_flujo, version, archivado FROM proyectos WHERE id = $1',
    [proyectoId],
  );
  if (rows.length === 0) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
  return rows[0];
}

/**
 * Sprint activo del proyecto, o null si no hay.
 * @param {number} proyectoId
 * @returns {Promise<{id: number, nombre: string, fecha_fin: string}|null>}
 */
async function leerSprintActivo(proyectoId) {
  const { rows } = await consulta(
    `SELECT id, nombre, fecha_fin::text AS fecha_fin
       FROM sprints
      WHERE proyecto_id = $1 AND estado = 'activo'
      ORDER BY id
      LIMIT 1`,
    [proyectoId],
  );
  return rows[0] || null;
}

/**
 * Resumen que el asistente muestra antes de cambiar de modo. Solo lee; no modifica nada.
 *
 * @param {number} proyectoId
 * @param {string} [destino] Modo al que se quiere pasar; si no se indica, el contrario al actual.
 * @returns {Promise<Object>} Modo actual y destino, versión, tareas abiertas por columna, sprint activo,
 *   historias en sprint y el resultado de la regla (permitido, bloqueado o sin cambio).
 * @throws {ErrorApp} 400 si el destino no es un modo válido.
 */
export async function obtenerResumenMigracion(proyectoId, destino) {
  const proyecto = await leerProyecto(proyectoId);
  const modoDestino = destino || (proyecto.modo_flujo === MODOS.CONTINUO ? MODOS.SCRUM : MODOS.CONTINUO);

  const [sprintActivo, porColumna, sinColumna, historias, sprints] = await Promise.all([
    leerSprintActivo(proyectoId),
    consulta(
      `SELECT c.id, c.nombre, c.orden, COUNT(t.id)::int AS tareas
         FROM columnas_tablero c
         LEFT JOIN tareas t ON t.columna_id = c.id AND t.proyecto_id = c.proyecto_id
        WHERE c.proyecto_id = $1 AND c.es_final = FALSE
        GROUP BY c.id, c.nombre, c.orden
        ORDER BY c.orden`,
      [proyectoId],
    ),
    consulta('SELECT COUNT(*)::int AS total FROM tareas WHERE proyecto_id = $1 AND columna_id IS NULL', [proyectoId]),
    consulta(
      `SELECT COUNT(*)::int AS total
         FROM historias h
         JOIN sprints s ON s.id = h.sprint_id
        WHERE h.proyecto_id = $1 AND s.estado IN ('planificado', 'activo')`,
      [proyectoId],
    ),
    consulta(
      `SELECT COUNT(*) FILTER (WHERE estado = 'planificado')::int AS planificados,
              COUNT(*) FILTER (WHERE estado = 'cerrado')::int AS cerrados
         FROM sprints
        WHERE proyecto_id = $1`,
      [proyectoId],
    ),
  ]);

  // Se evalúa como si ya estuviera confirmado: el asistente solo necesita saber si puede ofrecer el cambio
  const evaluacion = evaluarCambioModo({
    modoActual: proyecto.modo_flujo,
    destino: modoDestino,
    sprintActivo: Boolean(sprintActivo),
    confirmar: true,
  });
  if (evaluacion.resultado === RESULTADOS_CAMBIO.INVALIDO) throw error(400, evaluacion.mensaje, { motivo: evaluacion.motivo });

  const tareasPorColumna = porColumna.rows.map((c) => ({ columnaId: c.id, nombre: c.nombre, tareas: c.tareas }));

  return {
    proyectoId: proyecto.id,
    nombre: proyecto.nombre,
    modoActual: proyecto.modo_flujo,
    destino: modoDestino,
    version: proyecto.version,
    archivado: proyecto.archivado,
    tareasAbiertas: tareasPorColumna.reduce((suma, c) => suma + c.tareas, 0),
    tareasPorColumna,
    tareasSinColumna: sinColumna.rows[0].total,
    sprintActivo: sprintActivo ? { id: sprintActivo.id, nombre: sprintActivo.nombre, fechaFin: sprintActivo.fecha_fin } : null,
    historiasEnSprint: historias.rows[0].total,
    sprintsPlanificados: sprints.rows[0].planificados,
    sprintsCerrados: sprints.rows[0].cerrados,
    resultado: evaluacion.resultado,
    motivo: evaluacion.motivo,
    mensaje: evaluacion.mensaje,
  };
}

/**
 * Cambia el modo de trabajo del proyecto. Solo actualiza proyectos.modo_flujo y la versión:
 * no borra ni modifica tareas, historias, historial ni sprints.
 *
 * @param {number} proyectoId
 * @param {{modo: string, version: number, confirmar: boolean}} datos Modo destino, versión que la persona vio
 *   y confirmación explícita.
 * @param {{id: number, nombre?: string}} usuario Persona que hace el cambio (queda en la bitácora).
 * @returns {Promise<{cambio: boolean, proyectoId: number, modo: string, version: number}>}
 *   `cambio` es false si el proyecto ya estaba en ese modo.
 * @throws {ErrorApp} 400 si el modo no es válido o falta la versión o la confirmación;
 *   409 si hay un sprint activo, el proyecto está archivado u otra persona lo modificó antes.
 */
export async function cambiarModo(proyectoId, datos = {}, usuario) {
  const destino = String(datos.modo ?? '').trim().toLowerCase();
  const proyecto = await leerProyecto(proyectoId);
  const sprintActivo = await leerSprintActivo(proyectoId);

  const evaluacion = evaluarCambioModo({
    modoActual: proyecto.modo_flujo,
    destino,
    sprintActivo: Boolean(sprintActivo),
    confirmar: datos.confirmar,
  });

  if (evaluacion.resultado === RESULTADOS_CAMBIO.INVALIDO) throw error(400, evaluacion.mensaje, { motivo: evaluacion.motivo });
  if (evaluacion.resultado === RESULTADOS_CAMBIO.SIN_CAMBIO) {
    return { cambio: false, proyectoId: proyecto.id, modo: proyecto.modo_flujo, version: proyecto.version };
  }
  if (proyecto.archivado) throw error(409, 'El proyecto está archivado y no se puede cambiar su modo de trabajo.', { motivo: 'archivado' });
  if (evaluacion.resultado === RESULTADOS_CAMBIO.BLOQUEADO) {
    throw error(409, evaluacion.mensaje, {
      motivo: evaluacion.motivo,
      sprint: { id: sprintActivo.id, nombre: sprintActivo.nombre },
    });
  }
  if (evaluacion.resultado === RESULTADOS_CAMBIO.REQUIERE_CONFIRMACION) {
    throw error(400, evaluacion.mensaje, { motivo: evaluacion.motivo });
  }

  const versionCliente = Number(datos.version);
  if (!Number.isInteger(versionCliente)) throw error(400, 'Falta la versión del proyecto.', { motivo: 'falta_version' });

  const actualizado = await enTransaccion(
    async (cliente) => {
      // La versión y el sprint activo se vuelven a comprobar dentro del UPDATE: si alguien cambió el proyecto
      // o inició un sprint entre la lectura y este punto, no se actualiza ninguna fila.
      const { rows } = await cliente.query(
        `UPDATE proyectos
            SET modo_flujo = $1, version = version + 1
          WHERE id = $2 AND version = $3 AND archivado = FALSE
            AND ($1 <> 'continuo'
                 OR NOT EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = $2 AND s.estado = 'activo'))
          RETURNING id, modo_flujo, version`,
        [destino, proyectoId, versionCliente],
      );
      if (rows.length === 0) return null;

      await registrarAuditoria(cliente, {
        usuarioId: usuario?.id ?? null,
        proyectoId: rows[0].id,
        accion: ACCIONES.PROYECTO_MODIFICADO,
        objeto: OBJETOS.PROYECTO,
        objetoId: rows[0].id,
        antes: { modo_flujo: proyecto.modo_flujo },
        despues: { modo_flujo: rows[0].modo_flujo },
      });
      return rows[0];
    },
    async (fila) => {
      // Después del COMMIT: los tableros abiertos se recargan con el modo nuevo
      if (!fila) return;
      // El cambio ya está guardado: si falla el aviso, no debe convertirse en un error para quien lo hizo
      let usuarioNombre = 'Un compañero';
      try {
        const { rows } = await consulta('SELECT nombre FROM usuarios WHERE id = $1', [usuario?.id ?? null]);
        if (rows[0]?.nombre) usuarioNombre = rows[0].nombre;
      } catch { /* se usa el nombre genérico */ }
      emitirAProyecto(Number(fila.id), EVENTO_MODO_CAMBIADO, {
        proyectoId: Number(fila.id),
        modo: fila.modo_flujo,
        version: fila.version,
        usuarioNombre,
      });
    },
  );

  if (!actualizado) {
    // No se actualizó nada: se averigua por qué para dar un mensaje útil
    const ahora = await leerProyecto(proyectoId);
    if (ahora.archivado) throw error(409, 'El proyecto está archivado y no se puede cambiar su modo de trabajo.', { motivo: 'archivado' });
    if (ahora.version !== versionCliente) {
      throw error(409, 'Otra persona modificó el proyecto antes que tú. Revisa el modo actual y vuelve a intentarlo.', {
        conflicto: true,
        motivo: 'conflicto_version',
        actual: { modo: ahora.modo_flujo, version: ahora.version },
      });
    }
    throw error(409, 'El proyecto tiene un sprint activo. Cierra el sprint antes de pasar a flujo continuo.', { motivo: 'sprint_activo' });
  }

  return { cambio: true, proyectoId: actualizado.id, modo: actualizado.modo_flujo, version: actualizado.version };
}

/**
 * Lead Time y Cycle Time de las tarjetas terminadas en los últimos N días.
 * Las tarjetas sin historial de movimientos se excluyen y se cuentan en `excluidas`; no provocan error.
 *
 * @param {number} proyectoId
 * @param {number|string} [dias] Periodo en días (por defecto 30, máximo 365).
 * @returns {Promise<Object>} Resultado de calcularTiemposFlujo más el modo actual del proyecto.
 */
export async function obtenerTiempos(proyectoId, dias) {
  const proyecto = await leerProyecto(proyectoId);

  const [columnas, tareas, eventos] = await Promise.all([
    consulta(
      'SELECT id, nombre, orden, es_final AS "esFinal" FROM columnas_tablero WHERE proyecto_id = $1 ORDER BY orden',
      [proyectoId],
    ),
    // Solo las tarjetas que hoy están en una columna final
    consulta(
      `SELECT t.id, t.titulo, t.creado_en AS "creadoEn", t.columna_id AS "columnaActualId",
              h.numero_hu AS "numeroHu", u.nombre AS responsable
         FROM tareas t
         JOIN columnas_tablero c ON c.id = t.columna_id AND c.es_final = TRUE
         JOIN historias h ON h.id = t.historia_id
         LEFT JOIN usuarios u ON u.id = t.responsable_id
        WHERE t.proyecto_id = $1`,
      [proyectoId],
    ),
    consulta(
      `SELECT h.tarea_id AS "tareaId", h.creado_en AS fecha,
              (h.detalle->>'anterior')::int AS "anteriorId",
              (h.detalle->>'nueva')::int AS "nuevaId"
         FROM historial_tareas h
         JOIN tareas t ON t.id = h.tarea_id
         JOIN columnas_tablero c ON c.id = t.columna_id AND c.es_final = TRUE
        WHERE t.proyecto_id = $1 AND h.accion = $2
        ORDER BY h.creado_en, h.id`,
      [proyectoId, ACCION_CAMBIO_COLUMNA],
    ),
  ]);

  const resultado = calcularTiemposFlujo({
    tareas: tareas.rows,
    eventos: eventos.rows,
    columnas: columnas.rows,
    dias: normalizarDias(dias),
    modo: proyecto.modo_flujo,
  });

  return { proyectoId: proyecto.id, modo: proyecto.modo_flujo, ...resultado };
}

/**
 * Datos del formulario "+ Tarea" del tablero en modo continuo: historias a las que se puede colgar una tarea
 * y personas que pueden ser responsables. Usa las mismas reglas que valida tareas.service.js al crear.
 *
 * @param {number} proyectoId
 * @param {string|null} rol Rol de la persona en el proyecto (req.rolProyecto).
 * @returns {Promise<{modo: string, puedeCrear: boolean, historias: Array<Object>, integrantes: Array<Object>}>}
 */
export async function obtenerOpcionesTarea(proyectoId, rol) {
  const proyecto = await leerProyecto(proyectoId);

  const [historias, integrantes] = await Promise.all([
    consulta(
      `SELECT h.id, h.numero_hu AS "numeroHu", h.titulo, h.sprint_id AS "sprintId"
         FROM historias h
         LEFT JOIN sprints s ON s.id = h.sprint_id
        WHERE h.proyecto_id = $1
          AND h.estado NOT IN ('aceptada', 'rechazada')
          AND (h.sprint_id IS NULL OR s.estado IN ('planificado', 'activo'))
        ORDER BY h.numero_hu`,
      [proyectoId],
    ),
    consulta(
      `SELECT u.id, u.nombre, mp.rol
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND u.activo = TRUE
        ORDER BY u.nombre`,
      [proyectoId],
    ),
  ]);

  return {
    modo: proyecto.modo_flujo,
    // tareas.service.js solo deja crear tareas al Scrum Master; aquí se adelanta para no mostrar un formulario inútil
    puedeCrear: proyecto.modo_flujo === MODOS.CONTINUO && !proyecto.archivado && rol === ROLES.SCRUM_MASTER,
    historias: historias.rows,
    integrantes: integrantes.rows,
  };
}
