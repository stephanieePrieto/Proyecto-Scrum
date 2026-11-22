/**
 * @file burnup.registro.js
 * @description Registrar cada cambio de columna de una tarjeta en historial_tareas. Es la fuente histórica del CFD.
 *
 * Reutiliza registrarHistorial de detalle-tarjeta.service.js (mismo INSERT), solo fija la acción
 * 'columna_cambiada' y el detalle { anterior, nueva } que lee burnup.service.js.
 *
 * Hay que invocarlo, dentro de la misma transacción, desde (1) tablero.service.js > moverTarjeta
 * y (2) ciclo-sprint.service.js > cerrar, cuando las tarjetas vuelven al backlog. Sin esas llamadas
 * el CFD solo tendrá datos desde el momento en que se activen.
 */

/** Valor de historial_tareas.accion que identifica un cambio de columna. */
export const ACCION_CAMBIO_COLUMNA = 'columna_cambiada';

import { registrarHistorial } from '../detalle-tarjeta/detalle-tarjeta.service.js';

/**
 * Guardar un cambio de columna. Usar el mismo cliente de la transacción que mueve la tarjeta.
 *
 * @param {import('pg').PoolClient} cliente Cliente de la transacción.
 * @param {{tareaId: number, usuarioId?: number|null, anteriorId?: number|null, nuevaId?: number|null}} cambio
 * @returns {Promise<void>}
 */
export async function registrarCambioColumna(cliente, { tareaId, usuarioId = null, anteriorId = null, nuevaId = null }) {
  await registrarHistorial(
    tareaId,
    usuarioId,
    ACCION_CAMBIO_COLUMNA,
    { anterior: anteriorId, nueva: nuevaId },
    cliente,
  );
}
