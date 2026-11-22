// Responsable: Alfonso - HU-26: lógica pura del flujo continuo (Lead Time, Cycle Time y regla de cambio de modo).
/**
 * @file flujo-continuo.calculo.js
 * @description Lógica pura de la HU-26, sin base de datos ni Express, para poder probarla sola.
 *
 *  1. Tiempos de flujo de las tarjetas terminadas:
 *     - Lead Time  = de la creación de la tarjeta a su última llegada a una columna final.
 *     - Cycle Time = de la primera salida de la primera columna (por orden) a esa misma llegada.
 *     Solo cuentan las tarjetas que hoy están en una columna final. Las que no tienen historial de
 *     movimientos o dan una duración nula o negativa se excluyen y se cuentan aparte: nunca son un error.
 *  2. Regla que decide si un cambio de modo (Scrum <-> continuo) está permitido, bloqueado o necesita confirmar.
 *
 * Las duraciones se devuelven en horas con dos decimales; la pantalla decide si las muestra en horas o días.
 *
 * @author Alfonso Mendoza Vasquez
 */

/** Modos de trabajo de un proyecto (proyectos.modo_flujo). */
export const MODOS = Object.freeze({ SCRUM: 'scrum', CONTINUO: 'continuo' });

/** Periodo por defecto y límites del filtro de las métricas de flujo, en días. */
export const DIAS_POR_DEFECTO = 30;
export const DIAS_MAXIMO = 365;

/** Motivos por los que una tarjeta terminada no entra en el cálculo. */
export const EXCLUSIONES = Object.freeze({
  SIN_HISTORIAL: 'sin_historial',
  DURACION_INVALIDA: 'duracion_invalida',
});

/** Resultados posibles de evaluarCambioModo. */
export const RESULTADOS_CAMBIO = Object.freeze({
  INVALIDO: 'invalido',
  SIN_CAMBIO: 'sin_cambio',
  BLOQUEADO: 'bloqueado',
  REQUIERE_CONFIRMACION: 'requiere_confirmacion',
  PERMITIDO: 'permitido',
});

const MS_POR_HORA = 60 * 60 * 1000;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** Redondea a dos decimales sin arrastrar errores de punto flotante. */
function redondear(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Convierte una fecha (Date, ISO o milisegundos) a milisegundos; null si no es válida. */
function aMilisegundos(fecha) {
  if (fecha === null || fecha === undefined || fecha === '') return null;
  const ms = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Convierte un identificador a número; null si viene vacío. */
function aId(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Normaliza el periodo pedido: entero entre 1 y DIAS_MAXIMO; cualquier otro valor usa el periodo por defecto.
 * @param {*} valor Valor recibido en la consulta (?dias=).
 * @returns {number} Días del periodo.
 */
export function normalizarDias(valor) {
  const dias = Number(valor);
  if (!Number.isInteger(dias) || dias < 1) return DIAS_POR_DEFECTO;
  return Math.min(dias, DIAS_MAXIMO);
}

/**
 * Promedio de una lista de números. Lista vacía → null.
 * @param {number[]} valores
 * @returns {number|null}
 */
export function promedio(valores = []) {
  if (valores.length === 0) return null;
  return redondear(valores.reduce((suma, v) => suma + v, 0) / valores.length);
}

/**
 * Mediana de una lista de números (con cantidad par, el promedio de los dos centrales). Lista vacía → null.
 * @param {number[]} valores
 * @returns {number|null}
 */
export function mediana(valores = []) {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return redondear(orden.length % 2 === 1 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2);
}

/**
 * Tiempos de una tarjeta terminada a partir de sus cambios de columna.
 *
 * @param {{id: number, creadoEn: Date|string}} tarea Tarjeta que hoy está en una columna final.
 * @param {Array<{fecha: Date|string, anteriorId: number|null, nuevaId: number|null}>} eventos Cambios de columna de la tarjeta.
 * @param {{primeraColumnaId: number|null, finales: Set<number>, modo?: string}} columnas Primera columna por orden,
 *   columnas finales y modo del proyecto. En modo continuo, un evento con `anterior = null` cuenta como salida de
 *   la primera columna: el tablero continuo muestra ahí las tarjetas sin columna (por ejemplo, las que volvieron
 *   al backlog al cerrar un sprint). Si ese evento las deja en la misma primera columna, no es salida.
 * @returns {{exclusion: string|null, llegada: number|null, leadHoras: number|null, cycleHoras: number|null}}
 *   `llegada` va en milisegundos. `cycleHoras` es null si no hay una salida registrada de la primera columna
 *   o si su duración no es positiva; la tarjeta sigue contando para el Lead Time.
 */
export function calcularTiemposTarjeta(tarea, eventos = [], { primeraColumnaId = null, finales = new Set(), modo = MODOS.SCRUM } = {}) {
  const ordenados = eventos
    .map((e) => ({ ms: aMilisegundos(e.fecha), anteriorId: aId(e.anteriorId), nuevaId: aId(e.nuevaId) }))
    .filter((e) => e.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  // Última llegada a una columna final: si la tarjeta se reabrió y se volvió a cerrar, cuenta el cierre definitivo
  let llegada = null;
  for (const evento of ordenados) {
    if (evento.nuevaId !== null && finales.has(evento.nuevaId)) llegada = evento.ms;
  }
  if (llegada === null) {
    return { exclusion: EXCLUSIONES.SIN_HISTORIAL, llegada: null, leadHoras: null, cycleHoras: null };
  }

  const creado = aMilisegundos(tarea?.creadoEn);
  if (creado === null || llegada <= creado) {
    return { exclusion: EXCLUSIONES.DURACION_INVALIDA, llegada, leadHoras: null, cycleHoras: null };
  }

  // Primera salida de la primera columna: ahí empezó el trabajo
  const esSalida = (e) => {
    if (primeraColumnaId === null || e.ms > llegada) return false;
    if (e.anteriorId === primeraColumnaId) return true;
    return modo === MODOS.CONTINUO && e.anteriorId === null && e.nuevaId !== primeraColumnaId;
  };
  const salida = ordenados.find(esSalida);
  const cycleMs = salida ? llegada - salida.ms : null;

  return {
    exclusion: null,
    llegada,
    leadHoras: redondear((llegada - creado) / MS_POR_HORA),
    cycleHoras: cycleMs !== null && cycleMs > 0 ? redondear(cycleMs / MS_POR_HORA) : null,
  };
}

/**
 * Lead Time y Cycle Time de las tarjetas terminadas dentro de un periodo.
 *
 * @param {Object} datos
 * @param {Array<{id: number, titulo?: string, creadoEn: Date|string, columnaActualId: number|null}>} datos.tareas Tarjetas del proyecto.
 * @param {Array<{tareaId: number, fecha: Date|string, anteriorId: number|null, nuevaId: number|null}>} datos.eventos
 *   Cambios de columna (historial_tareas con accion 'columna_cambiada').
 * @param {Array<{id: number, orden: number, esFinal: boolean}>} datos.columnas Columnas del tablero.
 * @param {number} [datos.dias] Días del periodo (por defecto 30).
 * @param {Date|string} [datos.ahora] Fin del periodo (por defecto, este momento).
 * @param {string} [datos.modo] Modo del proyecto ('scrum' por defecto); ver calcularTiemposTarjeta.
 * @returns {{vacio: boolean, dias: number, desde: string, hasta: string,
 *   lead: {cantidad: number, promedio: number|null, mediana: number|null},
 *   cycle: {cantidad: number, promedio: number|null, mediana: number|null},
 *   tarjetas: Array<Object>, excluidas: {sinHistorial: number, duracionInvalida: number, sinCycle: number}}}
 */
export function calcularTiemposFlujo({ tareas = [], eventos = [], columnas = [], dias, ahora, modo = MODOS.SCRUM } = {}) {
  const periodo = normalizarDias(dias);
  const hasta = aMilisegundos(ahora) ?? Date.now();
  const desde = hasta - periodo * MS_POR_DIA;

  const ordenadas = [...columnas].sort((a, b) => a.orden - b.orden);
  const finales = new Set(ordenadas.filter((c) => c.esFinal).map((c) => aId(c.id)));
  const primeraColumnaId = ordenadas.length > 0 ? aId(ordenadas[0].id) : null;

  const porTarea = new Map();
  for (const evento of eventos) {
    const tareaId = aId(evento.tareaId);
    if (!porTarea.has(tareaId)) porTarea.set(tareaId, []);
    porTarea.get(tareaId).push(evento);
  }

  const tarjetas = [];
  const excluidas = { sinHistorial: 0, duracionInvalida: 0, sinCycle: 0 };

  for (const tarea of tareas) {
    // Solo las tarjetas que hoy están terminadas
    if (!finales.has(aId(tarea.columnaActualId))) continue;

    const tiempos = calcularTiemposTarjeta(tarea, porTarea.get(aId(tarea.id)) || [], { primeraColumnaId, finales, modo });

    if (tiempos.exclusion === EXCLUSIONES.SIN_HISTORIAL) {
      excluidas.sinHistorial += 1;
      continue;
    }
    // Fuera del periodo: no es una exclusión, simplemente no corresponde a este filtro
    if (tiempos.llegada < desde || tiempos.llegada > hasta) continue;
    if (tiempos.exclusion === EXCLUSIONES.DURACION_INVALIDA) {
      excluidas.duracionInvalida += 1;
      continue;
    }
    if (tiempos.cycleHoras === null) excluidas.sinCycle += 1;

    tarjetas.push({
      tareaId: tarea.id,
      titulo: tarea.titulo ?? '',
      numeroHu: tarea.numeroHu ?? null,
      responsable: tarea.responsable ?? null,
      terminadaEn: new Date(tiempos.llegada).toISOString(),
      leadHoras: tiempos.leadHoras,
      cycleHoras: tiempos.cycleHoras,
    });
  }

  // Las más recientes primero
  tarjetas.sort((a, b) => b.terminadaEn.localeCompare(a.terminadaEn));

  const leads = tarjetas.map((t) => t.leadHoras);
  const cycles = tarjetas.map((t) => t.cycleHoras).filter((v) => v !== null);

  return {
    vacio: tarjetas.length === 0,
    dias: periodo,
    desde: new Date(desde).toISOString(),
    hasta: new Date(hasta).toISOString(),
    lead: { cantidad: leads.length, promedio: promedio(leads), mediana: mediana(leads) },
    cycle: { cantidad: cycles.length, promedio: promedio(cycles), mediana: mediana(cycles) },
    tarjetas,
    excluidas,
  };
}

/**
 * Decide qué hacer con una petición de cambio de modo. No consulta nada: recibe los hechos ya leídos.
 *
 * Reglas, en este orden:
 *  1. Destino desconocido → inválido.
 *  2. El proyecto ya está en ese modo → sin cambio (no se toca nada).
 *  3. Pasar a continuo con un sprint activo → bloqueado: hay que cerrar el sprint primero
 *     (mismo criterio que archivar un proyecto con sprint activo).
 *  4. Falta la confirmación explícita → requiere confirmación.
 *  5. En cualquier otro caso → permitido.
 *
 * @param {Object} hechos
 * @param {string} hechos.modoActual Modo actual del proyecto.
 * @param {string} hechos.destino Modo solicitado.
 * @param {boolean} [hechos.sprintActivo=false] Si el proyecto tiene un sprint activo.
 * @param {boolean} [hechos.confirmar=false] Si la persona confirmó de forma explícita (debe ser exactamente true).
 * @returns {{resultado: string, motivo: string|null, mensaje: string}}
 */
export function evaluarCambioModo({ modoActual, destino, sprintActivo = false, confirmar = false } = {}) {
  if (!Object.values(MODOS).includes(destino)) {
    return {
      resultado: RESULTADOS_CAMBIO.INVALIDO,
      motivo: 'modo_invalido',
      mensaje: 'El modo de trabajo debe ser "scrum" o "continuo".',
    };
  }
  if (modoActual === destino) {
    return {
      resultado: RESULTADOS_CAMBIO.SIN_CAMBIO,
      motivo: 'mismo_modo',
      mensaje: 'El proyecto ya trabaja en ese modo.',
    };
  }
  if (destino === MODOS.CONTINUO && sprintActivo) {
    return {
      resultado: RESULTADOS_CAMBIO.BLOQUEADO,
      motivo: 'sprint_activo',
      mensaje: 'El proyecto tiene un sprint activo. Cierra el sprint antes de pasar a flujo continuo.',
    };
  }
  if (confirmar !== true) {
    return {
      resultado: RESULTADOS_CAMBIO.REQUIERE_CONFIRMACION,
      motivo: 'falta_confirmacion',
      mensaje: 'Confirma el cambio de modo para continuar.',
    };
  }
  return { resultado: RESULTADOS_CAMBIO.PERMITIDO, motivo: null, mensaje: 'El cambio de modo está permitido.' };
}
