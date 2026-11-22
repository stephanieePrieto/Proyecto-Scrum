/**
 * @file semaforo.js
 * @description Centralizar las reglas que convierten un valor en un tono de semáforo.
 * Devolver siempre uno de: 'exito' | 'advertencia' | 'peligro' | 'info' | 'neutro'.
 * Modificar los umbrales aquí para cambiar los colores en todo el dashboard.
 * 
 * @author Stephanie Elizdeth Hernández Prieto
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
 * Límites del semáforo de desviación de horas (HU-28), ambos incluidos: verde hasta 10 %, ámbar hasta 25 %.
 * Deben valer lo mismo que UMBRAL_OK y UMBRAL_ALERTA de src/modulos/desviacion/desviacion.calculo.js (el servidor
 * no puede importar este archivo); desviacion.test.js falla si dejan de coincidir.
 */
export const DESVIACION_UMBRAL_OK = 10;
export const DESVIACION_UMBRAL_ALERTA = 25;

/**
 * Convertir horas a centésimas enteras, igual que el servidor: vacío, negativo o no numérico cuenta como 0.
 * Trabajar con enteros evita que 11 − 10 o 10 × 1.1 den 1.0000000000000009 y cambien de tono en el límite.
 *
 * @param {number|string|null|undefined} horas - Horas sin confiar.
 * @returns {number} Centésimas de hora (≥ 0).
 */
function aCentesimas(horas) {
  const numero = Number(horas);
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 100) : 0;
}

/**
 * Determinar el tono de la desviación de horas con la misma regla que el servidor (HU-28), por prioridad:
 * sin horas reales o sin horas estimadas → neutro (el % no se puede calcular ni dividir entre cero);
 * reales menores a estimadas (ahorro) → info; hasta 10 % → éxito; hasta 25 % → advertencia; más → peligro.
 *
 * @param {number} desviacion - Horas reales menos horas estimadas. Solo se usa si no se indican las reales.
 * @param {number} estimado - Horas estimadas totales.
 * @param {number} [real] - Horas reales totales. Indicarlas distingue "sin registro" de un ahorro del 100 %.
 * @returns {string} Tono.
 */
export function tonoDesviacion(desviacion, estimado, real) {
  const estimadas = aCentesimas(estimado);
  const reales = aCentesimas(real ?? Number(estimado) + Number(desviacion));
  if (reales <= 0 || estimadas <= 0) return 'neutro';

  const diferencia = reales - estimadas;
  if (diferencia < 0) return 'info';

  const porcentaje = Math.round((diferencia * 10000) / estimadas);
  if (porcentaje <= DESVIACION_UMBRAL_OK * 100) return 'exito';
  if (porcentaje <= DESVIACION_UMBRAL_ALERTA * 100) return 'advertencia';
  return 'peligro';
}
