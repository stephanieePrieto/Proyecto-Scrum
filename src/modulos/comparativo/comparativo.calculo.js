/**
 * @file comparativo.calculo.js
 * @description Funciones puras del comparativo entre equipos (HU-2). Reciben las métricas ya calculadas de cada
 * equipo y devuelven valores normalizados en porcentaje, para comparar equipos con ciclos de distinta duración.
 * No consultan la base de datos: se prueban aisladas en comparativo.test.js.
 */

/** Sprints cerrados mínimos para que un equipo entre en la comparación. Con menos, el criterio 2 marca "datos insuficientes". */
export const SPRINTS_MINIMOS = 1;

/** Equipos mínimos con datos para que la comparación tenga sentido (criterio 1). */
export const EQUIPOS_MINIMOS = 2;

/** Redondea a un decimal. */
const aUnDecimal = (valor) => Math.round(Number(valor) * 10) / 10;

/** Valor válido (número finito), no null ni texto vacío. */
const esValido = (valor) => valor !== null && valor !== undefined && Number.isFinite(valor);

/**
 * Promedio de los valores válidos. Devuelve null si no hay ninguno, para no comparar contra un cero inventado.
 *
 * @param {Array<number|null>} valores
 * @returns {number|null}
 */
function promedio(valores) {
  const validos = valores.filter(esValido);
  if (validos.length === 0) return null;
  return aUnDecimal(validos.reduce((acum, v) => acum + v, 0) / validos.length);
}

/**
 * Diferencia entre un equipo y la referencia. Devuelve null si falta alguno de los dos valores.
 *
 * @param {number|null} valor
 * @param {number|null} referencia
 * @returns {number|null}
 */
function diferencia(valor, referencia) {
  if (!esValido(valor) || !esValido(referencia)) return null;
  return aUnDecimal(valor - referencia);
}

/**
 * Elige un proyecto por equipo. Un equipo puede tener varios proyectos; se toma el de id más alto, que es el más
 * reciente. Así cada equipo aparece una sola vez en la comparación.
 *
 * @param {Array<{proyectoId: number, equipoId: number}>} filas Proyectos del usuario, en cualquier orden.
 * @returns {Array<{proyectoId: number, equipoId: number}>} Una fila por equipo.
 */
export function elegirProyectoPorEquipo(filas) {
  const elegido = new Map();
  for (const fila of filas) {
    const actual = elegido.get(fila.equipoId);
    if (!actual || fila.proyectoId > actual.proyectoId) elegido.set(fila.equipoId, fila);
  }
  return [...elegido.values()];
}

/**
 * Normaliza las métricas de los equipos para compararlas.
 *
 * Reglas:
 *   - Velocity normalizada: porcentaje respecto del equipo con mayor velocity (ese equipo marca 100 %).
 *     Así un equipo con sprints de 1 semana y otro de 3 se pueden poner en la misma escala.
 *   - Avance y desviación ya vienen en porcentaje; se comparan tal cual.
 *   - Diferencia: cada equipo frente al promedio de los equipos con datos. La velocity se da en puntos
 *     y el avance y la desviación en puntos porcentuales.
 *   - Un equipo con menos sprints cerrados que SPRINTS_MINIMOS queda como "datos_insuficientes" y no
 *     entra en el promedio ni en el máximo.
 *
 * @param {Array<{equipo: string, equipoId: number, proyectoId: number, proyecto: string,
 *   sprintsCerrados: number, velocity: number|null, avancePct: number|null, desviacionPct: number|null}>} equipos
 * @returns {{comparable: boolean, minimoEquipos: number, referencia: Object, equipos: Array<Object>}}
 *   `comparable` es true cuando hay al menos EQUIPOS_MINIMOS equipos con datos.
 */
export function normalizarComparativo(equipos) {
  const conDatos = equipos.filter((e) => e.sprintsCerrados >= SPRINTS_MINIMOS);
  const maximaVelocity = Math.max(0, ...conDatos.map((e) => Number(e.velocity) || 0));

  const referencia = {
    velocity: promedio(conDatos.map((e) => e.velocity)),
    avancePct: promedio(conDatos.map((e) => e.avancePct)),
    desviacionPct: promedio(conDatos.map((e) => e.desviacionPct)),
  };

  const filas = equipos
    .map((e) => {
      if (e.sprintsCerrados < SPRINTS_MINIMOS) {
        return { ...e, estado: 'datos_insuficientes', velocityPct: null, diferencia: null };
      }
      const velocity = Number(e.velocity) || 0;
      return {
        ...e,
        estado: 'ok',
        velocityPct: maximaVelocity > 0 ? aUnDecimal((velocity / maximaVelocity) * 100) : 0,
        diferencia: {
          velocity: esValido(velocity) && esValido(referencia.velocity) ? aUnDecimal(velocity - referencia.velocity) : null,
          avancePp: diferencia(e.avancePct, referencia.avancePct),
          desviacionPp: diferencia(e.desviacionPct, referencia.desviacionPct),
        },
      };
    })
    .sort((a, b) => a.equipo.localeCompare(b.equipo, 'es'));

  return {
    comparable: conDatos.length >= EQUIPOS_MINIMOS,
    minimoEquipos: EQUIPOS_MINIMOS,
    referencia,
    equipos: filas,
  };
}
