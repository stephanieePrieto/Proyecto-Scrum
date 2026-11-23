/**
 * @file reviews.reglas.js
 * @description Reglas de la Sprint Review que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (reviews.test.js).
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import { esFechaValida } from '../daily/daily.reglas.js';

/** Decisiones posibles del Product Owner sobre una historia. */
export const DECISIONES = Object.freeze(['aceptada', 'rechazada']);

export const MAX_COMENTARIO = 500;
export const MAX_MOTIVO = 200;

/** Largo máximo del texto de una Definition of Done (de sprint o de historia). */
export const MAX_DOD = 2000;

/** Días máximos que puede durar una delegación temporal. */
export const MAX_DIAS_DELEGACION = 30;

/** Estados de la historia que ya cuentan como terminada antes de la decisión del PO. */
const ESTADOS_TERMINADA = ['hecho', 'aceptada'];

/**
 * Recortar un texto recibido; cualquier otro tipo cuenta como vacío.
 *
 * @param {*} valor
 * @returns {string}
 */
const limpiar = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Separar el texto de criterios de aceptación de una historia en una lista.
 * Un criterio por línea; si varios "Dado que..." vienen seguidos en la misma línea, también se separan.
 *
 * @param {string|null} texto
 * @returns {string[]}
 */
export function separarCriterios(texto) {
  if (typeof texto !== 'string') return [];
  return texto
    .split(/\r?\n|(?<=[.;])\s+(?=Dado que\b)/i)
    .map((criterio) => criterio.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Separar el texto de una Definition of Done en puntos: uno por línea (se quitan viñetas y líneas vacías).
 *
 * @param {string|null} texto
 * @returns {string[]}
 */
export function separarPuntosDod(texto) {
  if (typeof texto !== 'string') return [];
  return texto
    .split(/\r?\n/)
    .map((punto) => punto.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * armar la Definition of Done que aplica a una historia: la del sprint (si el sprint no tiene, la del proyecto)
 * más los puntos propios de la historia. Un punto repetido (sin importar mayúsculas) solo aparece una vez.
 *
 * @param {{dodProyecto?: (string|null), dodSprint?: (string|null), dodHistoria?: (string|null)}} [p]
 * @returns {string[]}
 */
export function dodDeHistoria({ dodProyecto = null, dodSprint = null, dodHistoria = null } = {}) {
  const delSprint = separarPuntosDod(dodSprint);
  const base = delSprint.length ? delSprint : separarPuntosDod(dodProyecto);
  const vistos = new Set();
  return [...base, ...separarPuntosDod(dodHistoria)].filter((punto) => {
    const clave = punto.toLocaleLowerCase('es');
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

/**
 * Leer una cantidad de puntos cumplidos (criterios o DoD) recibida en la petición.
 *
 * @param {*} valor - Valor sin confiar; si no viene, cuenta como 0.
 * @param {number} total - Puntos que hay.
 * @returns {{valor: number, valido: boolean}}
 */
function leerCumplidos(valor, total) {
  if (valor === undefined || valor === null) return { valor: 0, valido: true };
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > total) return { valor: 0, valido: false };
  return { valor: n, valido: true };
}

/**
 * Indicar si una historia ya está terminada y por eso se puede revisar: tiene una decisión, está en "hecho"
 * o "aceptada", o todas sus tarjetas están en la columna final del tablero.
 *
 * @param {{estado: string, tareas: number, tareasHechas: number, decision?: (string|null)}} historia
 * @returns {boolean}
 */
export function esHistoriaTerminada({ estado, tareas, tareasHechas, decision = null }) {
  if (decision) return true;
  if (ESTADOS_TERMINADA.includes(estado)) return true;
  return estado === 'en_sprint' && tareas > 0 && tareas === tareasHechas;
}

/**
 * Validar la decisión del Product Owner sobre una historia.
 *  - Rechazar exige un comentario; aceptar lo deja opcional.
 *  - si se acepta con criterios incompletos (por ejemplo 3 de 4) se marca `incompletos` y el servicio lo
 *    rechaza siempre: ya no existe la opción de confirmar y aceptarla de todas formas.
 *  - lo mismo con los puntos de la Definition of Done (`dodIncompleta`).
 *  - Si no se indica cuántos criterios o puntos de la DoD se cumplen, no se da ninguno por cumplido.
 *
 * @param {{decision?: string, comentario?: string, criterios_cumplidos?: number, dod_cumplidos?: number, cambiar?: boolean}} [datos]
 * @param {number} [totalCriterios=0] - Criterios de aceptación que tiene la historia.
 * @param {number} [totalDod=0] - Puntos de la DoD que aplican a la historia (ver dodDeHistoria()).
 * @returns {{errores: Object<string,string>, incompletos: boolean, dodIncompleta: boolean,
 *   valores: {decision: string, comentario: (string|null), criteriosCumplidos: number, criteriosTotal: number,
 *     dodCumplidos: number, dodTotal: number, cambiar: boolean}}}
 */
export function validarDecision(datos = {}, totalCriterios = 0, totalDod = 0) {
  const errores = {};
  const decision = datos.decision;
  if (!DECISIONES.includes(decision)) errores.decision = 'Elige aceptar o rechazar la historia.';

  const comentario = limpiar(datos.comentario);
  if (comentario.length > MAX_COMENTARIO) errores.comentario = `Máximo ${MAX_COMENTARIO} caracteres.`;
  else if (decision === 'rechazada' && !comentario) errores.comentario = 'Explica por qué la rechazas: el comentario es obligatorio.';

  const total = Math.max(0, Number(totalCriterios) || 0);
  const criterios = leerCumplidos(datos.criterios_cumplidos, total);
  if (!criterios.valido) errores.criterios_cumplidos = 'La cantidad de criterios cumplidos no es válida.';

  const totalPuntosDod = Math.max(0, Number(totalDod) || 0);
  const dod = leerCumplidos(datos.dod_cumplidos, totalPuntosDod);
  if (!dod.valido) errores.dod_cumplidos = 'La cantidad de puntos cumplidos de la Definition of Done no es válida.';

  return {
    errores,
    incompletos: decision === 'aceptada' && total > 0 && criterios.valor < total,
    dodIncompleta: decision === 'aceptada' && totalPuntosDod > 0 && dod.valor < totalPuntosDod,
    valores: {
      decision,
      comentario: comentario || null,
      criteriosCumplidos: criterios.valor,
      criteriosTotal: total,
      dodCumplidos: dod.valor,
      dodTotal: totalPuntosDod,
      cambiar: datos.cambiar === true,
    },
  };
}

/**
 * Sumar días a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @param {number} dias
 * @returns {string}
 */
export function sumarDias(fecha, dias) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Validar los datos de una delegación temporal: quién decide, hasta qué día (inclusive) y por qué.
 * La fecha no puede estar en el pasado ni pasar de MAX_DIAS_DELEGACION días desde hoy.
 *
 * @param {{delegado_id?: number, hasta?: string, motivo?: string}} [datos]
 * @param {string} hoy - "AAAA-MM-DD" de quien delega.
 * @returns {{errores: Object<string,string>, valores: {delegadoId: number, hasta: string, motivo: (string|null)}}}
 */
export function validarDelegacion(datos = {}, hoy) {
  const errores = {};
  const delegadoId = Number(datos.delegado_id);
  if (!Number.isInteger(delegadoId) || delegadoId <= 0) errores.delegado_id = 'Elige a la persona que decidirá en lugar del Product Owner.';

  const hasta = limpiar(datos.hasta);
  if (!esFechaValida(hasta)) errores.hasta = 'Indica hasta qué día dura la delegación.';
  else if (hasta < hoy) errores.hasta = 'La fecha no puede ser anterior a hoy.';
  else if (hasta > sumarDias(hoy, MAX_DIAS_DELEGACION)) errores.hasta = `Una delegación dura máximo ${MAX_DIAS_DELEGACION} días.`;

  const motivo = limpiar(datos.motivo);
  if (motivo.length > MAX_MOTIVO) errores.motivo = `Máximo ${MAX_MOTIVO} caracteres.`;

  return { errores, valores: { delegadoId, hasta, motivo: motivo || null } };
}

/**
 * Resumir las decisiones de la review: cuántas historias y puntos hay aceptados, rechazados y por revisar.
 * La velocity del sprint es la suma de los puntos ACEPTADOS (las rechazadas y las no revisadas no suman).
 *
 * @param {Array<{puntos: (number|null), terminada: boolean, decision: (string|null)}>} historias
 * @returns {{aceptadas: number, rechazadas: number, porRevisar: number, velocity: number, puntosRechazados: number, puntosPorRevisar: number}}
 */
export function resumirReview(historias) {
  const resumen = { aceptadas: 0, rechazadas: 0, porRevisar: 0, velocity: 0, puntosRechazados: 0, puntosPorRevisar: 0 };
  for (const h of historias) {
    const puntos = Number(h.puntos) || 0;
    if (h.decision === 'aceptada') {
      resumen.aceptadas += 1;
      resumen.velocity += puntos;
    } else if (h.decision === 'rechazada') {
      resumen.rechazadas += 1;
      resumen.puntosRechazados += puntos;
    } else if (h.terminada) {
      resumen.porRevisar += 1;
      resumen.puntosPorRevisar += puntos;
    }
  }
  return resumen;
}
