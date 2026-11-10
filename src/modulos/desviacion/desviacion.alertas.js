/**
 * @file desviacion.alertas.js
 * @description HU-33: regla del umbral de desviación y emisión de la alerta al Scrum Master.
 * No requiere tablas nuevas: el estado se calcula en vivo y la unicidad se verifica en notificaciones.
 * @author Dana Carmona Santamaria
 */
import { consulta } from '../../config/db.js';
import { notificar, TIPOS } from '../notificaciones/notificaciones.service.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { calcularDesviacion } from './desviacion.calculo.js';

/**
 * Evaluar si una tarea supera el umbral de desviación (±%).
 * Reutiliza calcularDesviacion (HU-28) para que el porcentaje sea exactamente el que se muestra en pantalla.
 * El sobrecosto siempre cuenta; el ahorro solo cuando la tarea ya está terminada.
 * Sin horas reales o sin estimación (porcentaje null) nunca hay alerta.
 *
 * @param {{estimadas: number, reales: number, umbral: number, terminada: boolean}} datos
 * @returns {{porcentaje: number, supera: boolean}} Desviación en % y si supera el umbral.
 */
export function evaluarUmbral({ estimadas, reales, umbral, terminada }) {
  const { desviacionPorcentaje } = calcularDesviacion(estimadas, reales);
  if (desviacionPorcentaje === null) return { porcentaje: 0, supera: false };
  const supera = desviacionPorcentaje > umbral || (Boolean(terminada) && desviacionPorcentaje < -umbral);
  return { porcentaje: desviacionPorcentaje, supera };
}

/**
 * Evaluar una tarea y, si supera el umbral, avisar a los Scrum Master del proyecto UNA sola vez.
 * Se llama cada vez que cambian las horas reales de la tarea.
 *
 * @param {number} proyectoId Identificador del proyecto.
 * @param {number} tareaId Identificador de la tarea.
 * @returns {Promise<void>}
 */
export async function evaluarDesviacionTarea(proyectoId, tareaId) {
  const { rows: [t] } = await consulta(
    `SELECT t.titulo, t.horas_estimadas::float AS estimadas, p.umbral_desviacion AS umbral,
            COALESCE(c.es_final, FALSE) AS terminada,
            COALESCE((SELECT SUM(horas) FROM registros_horas WHERE tarea_id = t.id), 0)::float AS reales
       FROM tareas t
       JOIN proyectos p ON p.id = t.proyecto_id
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE t.id = $1 AND t.proyecto_id = $2`,
    [tareaId, proyectoId],
  );
  if (!t) return;

  const { porcentaje, supera } = evaluarUmbral(t);
  if (!supera) return;

  // Aviso en tiempo real para refrescar el tablero (no es la notificación)
  emitirAProyecto(proyectoId, 'desviacion:alerta', { tareaId, porcentaje });

  const { rows: sms } = await consulta(
    "SELECT usuario_id FROM miembros_proyecto WHERE proyecto_id = $1 AND rol = 'scrum_master'",
    [proyectoId],
  );
  const signo = porcentaje > 0 ? '+' : '';
  for (const { usuario_id: usuarioId } of sms) {
    // Una sola alerta por tarea: si ya se notificó, no se repite aunque el valor oscile
    const { rows: previas } = await consulta(
      'SELECT 1 FROM notificaciones WHERE usuario_id = $1 AND tipo = $2 AND referencia_id = $3 LIMIT 1',
      [usuarioId, TIPOS.DESVIACION, tareaId],
    );
    if (previas.length) continue;
    await notificar({
      usuarioId, tipo: TIPOS.DESVIACION, titulo: 'Alerta por desviación',
      mensaje: `«${t.titulo}» lleva ${signo}${porcentaje}% de desviación (umbral ±${t.umbral}%).`,
      referenciaId: tareaId, enlace: `/pages/tablero.html?tarea=${tareaId}`,
    });
  }
}