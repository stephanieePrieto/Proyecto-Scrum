/**
 * @file burnup.calculo.js
 * @description Funciones puras del Burnup y del Flujo Acumulado (CFD) de la HU-1.
 * No consultan la base de datos: reciben datos ya leídos y devuelven la serie lista para graficar.
 * Por eso se prueban aisladas en burnup.test.js.
 *
 * Unidades: el Burnup trabaja en horas estimadas (igual que el Burndown y el avance de HU-31).
 * El CFD cuenta tarjetas por columna del tablero.
 */

/** Redondea a un decimal. Convierte con Number() porque pg devuelve NUMERIC como texto. */
const aUnDecimal = (valor) => Math.round(Number(valor || 0) * 10) / 10;

/**
 * Serie del Burnup: alcance total frente al trabajo completado acumulado.
 *
 * El alcance es la suma de horas estimadas de TODAS las tareas del proyecto, incluidas las del backlog.
 * Así el trabajo pendiente nunca desaparece de la gráfica. Lo completado se acumula sprint por sprint,
 * en orden cronológico. Las tareas hechas que no pertenecen a ningún sprint se suman en un último punto,
 * para que la última cifra sea el total real completado.
 *
 * @param {number} alcanceTotal Horas estimadas de todas las tareas del proyecto.
 * @param {Array<{nombre: string, completadoHoras: number}>} sprints Sprints en orden cronológico.
 * @param {number} [completadoSinSprint=0] Horas hechas de tareas que no están en ningún sprint.
 * @returns {{alcanceTotal: number, puntos: Array<{nombre: string, completado: number, alcance: number}>}}
 */
export function calcularBurnup(alcanceTotal, sprints = [], completadoSinSprint = 0) {
  const alcance = aUnDecimal(alcanceTotal);
  const puntos = [{ nombre: 'Inicio', completado: 0, alcance }];

  let acumulado = 0;
  for (const sprint of sprints) {
    acumulado += Number(sprint.completadoHoras) || 0;
    puntos.push({ nombre: sprint.nombre, completado: aUnDecimal(acumulado), alcance });
  }

  // Punto final: solo se agrega si hay trabajo hecho fuera de los sprints o si aún no hay sprints
  if (sprints.length === 0 || completadoSinSprint > 0) {
    const completadoFinal = acumulado + (Number(completadoSinSprint) || 0);
    puntos.push({ nombre: 'Actual', completado: aUnDecimal(completadoFinal), alcance });
  }

  return { alcanceTotal: alcance, puntos };
}

/**
 * Suma días a una fecha en formato YYYY-MM-DD. Trabaja en UTC para no depender de la zona horaria del servidor.
 *
 * @param {string} fecha Fecha inicial, por ejemplo '2026-11-01'.
 * @param {number} dias Días a sumar (puede ser negativo).
 * @returns {string} Nueva fecha en formato YYYY-MM-DD.
 */
export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Columna en la que estaba una tarjeta en un día concreto.
 * Regla: se toma el último cambio registrado hasta ese día. Si todavía no había ningún cambio, la tarjeta
 * seguía en la columna que tenía antes del primer cambio. Si nunca cambió de columna, se usa su columna actual.
 *
 * @param {{columnaActualId: number|null}} tarjeta Tarjeta con su columna actual.
 * @param {Array<{fecha: string, anteriorId: number|null, nuevaId: number|null}>} eventos Cambios de la tarjeta,
 *   ordenados del más antiguo al más reciente.
 * @param {string} fecha Día en formato YYYY-MM-DD.
 * @returns {number|null} Identificador de la columna, o null si la tarjeta no estaba en ninguna.
 */
export function columnaEnDia(tarjeta, eventos, fecha) {
  const hastaEseDia = eventos.filter((e) => e.fecha <= fecha);
  if (hastaEseDia.length > 0) return hastaEseDia[hastaEseDia.length - 1].nuevaId ?? null;
  if (eventos.length > 0) return eventos[0].anteriorId ?? null;
  return tarjeta.columnaActualId ?? null;
}

/**
 * Flujo acumulado: para cada día, desde la primera tarjeta hasta `hoy`, cuántas tarjetas hay en cada columna.
 * Una tarjeta cuenta desde el día en que se creó. En la gráfica se leen las bandas apiladas: si una banda
 * se engrosa con el tiempo, hay acumulación en esa columna.
 *
 * @param {Object} datos
 * @param {Array<{id: number, creado: string, columnaActualId: number|null}>} datos.tareas
 *   `creado` es la fecha de creación en YYYY-MM-DD.
 * @param {Array<{tareaId: number, fecha: string, anteriorId: number|null, nuevaId: number|null}>} datos.eventos
 *   Cambios de columna registrados en historial_tareas.
 * @param {Array<{id: number, nombre: string, orden: number, esFinal: boolean}>} datos.columnas
 * @param {string} datos.hoy Fecha límite en formato YYYY-MM-DD.
 * @returns {{vacio: boolean, columnas: Array<Object>, dias: Array<{fecha: string, conteos: Object<string, number>}>}}
 *   En `conteos` la clave es el id de la columna; las tarjetas sin columna van en la clave 'sinColumna'.
 */
export function calcularCfd({ tareas = [], eventos = [], columnas = [], hoy }) {
  const ordenadas = [...columnas].sort((a, b) => a.orden - b.orden);
  if (tareas.length === 0) return { vacio: true, columnas: ordenadas, dias: [] };

  // Cambios agrupados por tarjeta y ordenados del más antiguo al más reciente
  const porTarjeta = new Map();
  for (const e of [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (!porTarjeta.has(e.tareaId)) porTarjeta.set(e.tareaId, []);
    porTarjeta.get(e.tareaId).push(e);
  }

  const inicio = tareas.reduce((min, t) => (t.creado < min ? t.creado : min), tareas[0].creado);
  const dias = [];

  for (let dia = inicio; dia <= hoy; dia = sumarDias(dia, 1)) {
    const conteos = Object.fromEntries(ordenadas.map((c) => [c.id, 0]));
    conteos.sinColumna = 0;

    for (const t of tareas) {
      if (t.creado > dia) continue; // todavía no existía ese día
      const columna = columnaEnDia(t, porTarjeta.get(t.id) || [], dia);
      const clave = columna ?? 'sinColumna';
      conteos[clave] = (conteos[clave] ?? 0) + 1;
    }
    dias.push({ fecha: dia, conteos });
  }

  return { vacio: false, columnas: ordenadas, dias };
}
