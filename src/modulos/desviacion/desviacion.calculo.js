// Responsable: Alfonso - HU-28: cálculo puro de la desviación de horas (sin base de datos ni Express)
/**
 * @file desviacion.calculo.js
 * @description Funciones puras de la HU-28 (RF-29). No consultan la base de datos, por eso se prueban aisladas
 *              con `node --test src/modulos/desviacion/desviacion.test.js`.
 *
 *   Desviación (h) = reales − estimadas
 *   Desviación (%) = (reales − estimadas) / estimadas × 100
 *
 * Toda la aritmética se hace en centésimas de hora (enteros) para evitar artefactos de coma flotante
 * como 0.1 + 0.2 = 0.30000000000000004. Las horas y el porcentaje se devuelven con máximo 2 decimales.
 */

/** Hasta este porcentaje (incluido) la desviación es aceptable: verde. */
export const UMBRAL_OK = 10;

/** Hasta este porcentaje (incluido) la desviación es de cuidado: ámbar. Arriba de él: rojo. */
export const UMBRAL_ALERTA = 25;

/** Estados posibles de una desviación, en el orden de prioridad con que se deciden. */
export const ESTADOS = Object.freeze({
  SIN_REGISTRO: 'sin-registro', // aún no hay horas reales
  NA: 'na',                     // no hay horas estimadas: el % no se puede calcular
  AHORRO: 'ahorro',             // reales < estimadas
  OK: 'ok',                     // sobrecosto ≤ UMBRAL_OK
  ALERTA: 'alerta',             // sobrecosto ≤ UMBRAL_ALERTA
  CRITICO: 'critico',           // sobrecosto > UMBRAL_ALERTA
});

/**
 * Redondea al entero más cercano alejándose de cero en los empates (−2.5 → −3), para que
 * un ahorro y un sobrecosto del mismo tamaño se redondeen igual.
 * @param {number} valor Número a redondear.
 * @returns {number} Entero.
 */
const redondear = (valor) => Math.sign(valor) * Math.round(Math.abs(valor)) || 0;

/**
 * Convierte horas (número o texto de PostgreSQL) a centésimas enteras.
 * Vacío, null, negativo o no numérico cuenta como 0.
 * @param {number|string|null|undefined} horas Horas sin confiar.
 * @returns {number} Centésimas de hora (≥ 0).
 */
export function aCentesimas(horas) {
  const numero = Number(horas);
  if (horas === null || horas === undefined || horas === '' || !Number.isFinite(numero) || numero <= 0) return 0;
  return redondear(numero * 100);
}

/**
 * Calcula la desviación a partir de centésimas ya enteras.
 * @param {number} estimadas Centésimas estimadas.
 * @param {number} reales Centésimas reales.
 * @returns {{horasEstimadas:number, horasReales:number, desviacionHoras:number|null,
 *            desviacionPorcentaje:number|null, estado:string}}
 */
function desviacionDeCentesimas(estimadas, reales) {
  const base = { horasEstimadas: estimadas / 100, horasReales: reales / 100 };

  if (reales <= 0) {
    return { ...base, desviacionHoras: null, desviacionPorcentaje: null, estado: ESTADOS.SIN_REGISTRO };
  }

  const diferencia = reales - estimadas;
  const desviacionHoras = diferencia / 100;

  if (estimadas <= 0) {
    return { ...base, desviacionHoras, desviacionPorcentaje: null, estado: ESTADOS.NA };
  }

  // Porcentaje en centésimas de punto (18,75 % → 1875): el semáforo compara el mismo valor que se muestra
  const porcentajeCentesimas = redondear((diferencia * 10000) / estimadas);
  const desviacionPorcentaje = porcentajeCentesimas / 100;

  let estado;
  if (diferencia < 0) estado = ESTADOS.AHORRO;
  else if (porcentajeCentesimas <= UMBRAL_OK * 100) estado = ESTADOS.OK;
  else if (porcentajeCentesimas <= UMBRAL_ALERTA * 100) estado = ESTADOS.ALERTA;
  else estado = ESTADOS.CRITICO;

  return { ...base, desviacionHoras, desviacionPorcentaje, estado };
}

/**
 * Calcula la desviación de horas de una tarea (o de cualquier par estimado/real).
 * Prioridad: "Sin registro" → "N/A" → ahorro → semáforo 10 / 25.
 * Nunca devuelve NaN, Infinity ni undefined.
 *
 * @param {number|string|null} horasEstimadas Horas estimadas (null o vacío = 0).
 * @param {number|string|null} horasReales Horas reales registradas (null o vacío = 0).
 * @returns {{horasEstimadas:number, horasReales:number, desviacionHoras:number|null,
 *            desviacionPorcentaje:number|null, estado:string}}
 */
export function calcularDesviacion(horasEstimadas, horasReales) {
  return desviacionDeCentesimas(aCentesimas(horasEstimadas), aCentesimas(horasReales));
}

/**
 * Agrega la desviación de varias tareas (historia, persona o sprint).
 *
 * Decisión de agregación: solo se suman las tareas que ya tienen al menos un registro de horas.
 * Si se sumara el estimado de tareas que nadie ha trabajado, el total aparentaría un ahorro falso.
 * Las tareas excluidas se informan en `tareasSinRegistro` para que la interfaz lo avise.
 *
 * @param {Array<{horasEstimadas:number|string|null, horasReales:number|string|null}>} tareas Tareas del grupo.
 * @returns {{horasEstimadas:number, horasReales:number, desviacionHoras:number|null,
 *            desviacionPorcentaje:number|null, estado:string, totalTareas:number,
 *            tareasConsideradas:number, tareasSinRegistro:number}}
 */
export function agregarDesviacion(tareas = []) {
  let estimadas = 0;
  let reales = 0;
  let tareasConsideradas = 0;

  for (const tarea of tareas) {
    const real = aCentesimas(tarea.horasReales);
    if (real <= 0) continue;
    estimadas += aCentesimas(tarea.horasEstimadas);
    reales += real;
    tareasConsideradas += 1;
  }

  return {
    ...desviacionDeCentesimas(estimadas, reales),
    totalTareas: tareas.length,
    tareasConsideradas,
    tareasSinRegistro: tareas.length - tareasConsideradas,
  };
}

/** Grupo de orden: primero lo que tiene porcentaje, luego "N/A" y al final "Sin registro". */
const GRUPO_ORDEN = { [ESTADOS.NA]: 1, [ESTADOS.SIN_REGISTRO]: 2 };

/**
 * Ordena elementos por lo más preocupante primero: mayor desviación positiva arriba, los ahorros
 * debajo de los sobrecostos, luego "N/A" (por horas de más) y al final "Sin registro". Empates por nombre.
 * No modifica el arreglo original.
 *
 * @template {{nombre:string, estado:string, desviacionHoras:number|null, desviacionPorcentaje:number|null}} T
 * @param {T[]} elementos Elementos con su desviación.
 * @returns {T[]} Copia ordenada.
 */
export function ordenarPorDesviacion(elementos) {
  return [...elementos].sort((a, b) => {
    const grupo = (GRUPO_ORDEN[a.estado] ?? 0) - (GRUPO_ORDEN[b.estado] ?? 0);
    if (grupo !== 0) return grupo;
    const porcentaje = (b.desviacionPorcentaje ?? 0) - (a.desviacionPorcentaje ?? 0);
    if (porcentaje !== 0) return porcentaje;
    const horas = (b.desviacionHoras ?? 0) - (a.desviacionHoras ?? 0);
    if (horas !== 0) return horas;
    return String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es');
  });
}
