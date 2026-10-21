/**
 * Centralizar las reglas que convierten un valor en un tono de semáforo.
 * Devolver siempre uno de: 'exito' | 'advertencia' | 'peligro' | 'info' | 'neutro'.
 * Modificar los umbrales aquí para cambiar los colores en todo el dashboard.
 */

/**
 * Determinar el tono del avance global.
 * Asignar éxito desde 70 %, advertencia desde 40 % y peligro por debajo.
 *
 * @param {number} porcentaje - Avance de 0 a 100.
 * @returns {string} Tono.
 */
export function tonoAvance(porcentaje) {
  if (porcentaje >= 70) return 'exito';
  if (porcentaje >= 40) return 'advertencia';
  return 'peligro';
}

/**
 * Determinar el tono de los impedimentos abiertos.
 * Asignar peligro si hay críticos o más de 2, advertencia si hay alguno y éxito si no hay.
 *
 * @param {number} total - Impedimentos abiertos.
 * @param {number} criticos - Impedimentos abiertos marcados como críticos.
 * @returns {string} Tono.
 */
export function tonoImpedimentos(total, criticos) {
  if (criticos > 0 || total > 2) return 'peligro';
  if (total > 0) return 'advertencia';
  return 'exito';
}

/**
 * Determinar el tono de la desviación acumulada (horas reales − estimadas).
 * Asignar éxito si no excede lo estimado, advertencia si excede hasta un 10 %
 * y peligro si excede más.
 *
 * @param {number} desviacion - Horas reales menos horas estimadas.
 * @param {number} estimado - Horas estimadas totales.
 * @returns {string} Tono.
 */
export function tonoDesviacion(desviacion, estimado) {
  if (desviacion <= 0) return 'exito';
  const porcentaje = estimado ? (desviacion / estimado) * 100 : 100;
  return porcentaje <= 10 ? 'advertencia' : 'peligro';
}
