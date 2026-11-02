// Responsable: Diego - HU-10: reglas puras del Daily Scrum (validar, marcar "tarde", estado del integrante)
/**
 * Reglas del Daily Scrum que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (daily.test.js).
 */

/** Largo máximo de cada respuesta de la Daily. */
export const MAX_TEXTO = 2000;

/** Máximo de tareas del tablero que se pueden vincular a una Daily. */
export const MAX_TAREAS = 20;

/**
 * Hora local (HH:MM) después de la cual un registro se marca como "tarde" cuando el sprint
 * no tiene una Daily en el calendario (eventos_calendario, HU-15). Si existe el evento del día,
 * manda la hora en que termina.
 */
export const HORA_CORTE_DEFECTO = '10:00';

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Indicar si un texto "AAAA-MM-DD" es una fecha real (rechaza "2026-02-30").
 *
 * @param {string} texto
 * @returns {boolean}
 */
export function esFechaValida(texto) {
  if (typeof texto !== 'string' || !FORMATO_FECHA.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
}

/**
 * Validar y limpiar lo que captura la persona.
 * Obligatorios: qué hizo ayer y qué hará hoy. Los impedimentos son opcionales.
 * Las tareas vinculadas deben ser identificadores enteros positivos, sin repetir.
 *
 * @param {{ayer?: string, hoy?: string, impedimentos?: string, tareas?: number[]}} [datos]
 * @returns {{errores: Object<string,string>, valores: {ayer: string, hoy: string, impedimentos: string|null, tareas: number[]}}}
 *   `errores` es un objeto { campo: mensaje } (vacío si todo está bien).
 */
export function validarDaily(datos = {}) {
  const errores = {};
  const limpiar = (v) => (typeof v === 'string' ? v.trim() : '');

  const ayer = limpiar(datos.ayer);
  const hoy = limpiar(datos.hoy);
  const impedimentos = limpiar(datos.impedimentos);

  if (!ayer) errores.ayer = 'Cuenta qué hiciste ayer.';
  else if (ayer.length > MAX_TEXTO) errores.ayer = `Máximo ${MAX_TEXTO} caracteres.`;

  if (!hoy) errores.hoy = 'Cuenta qué harás hoy.';
  else if (hoy.length > MAX_TEXTO) errores.hoy = `Máximo ${MAX_TEXTO} caracteres.`;

  if (impedimentos.length > MAX_TEXTO) errores.impedimentos = `Máximo ${MAX_TEXTO} caracteres.`;

  let tareas = [];
  if (datos.tareas !== undefined && datos.tareas !== null) {
    if (!Array.isArray(datos.tareas)) {
      errores.tareas = 'La lista de tareas no es válida.';
    } else {
      const ids = datos.tareas.map(Number);
      if (ids.some((n) => !Number.isInteger(n) || n <= 0)) errores.tareas = 'Hay una tarea con un identificador no válido.';
      else if (new Set(ids).size > MAX_TAREAS) errores.tareas = `Puedes vincular máximo ${MAX_TAREAS} tareas.`;
      else tareas = [...new Set(ids)];
    }
  }

  return { errores, valores: { ayer, hoy, impedimentos: impedimentos || null, tareas } };
}

/**
 * Decidir si un registro nuevo es "tarde" (se guardó después de la reunión).
 *
 * @param {Object} p
 * @param {Date} p.ahora - Momento del guardado.
 * @param {Date|null} [p.terminaEn] - Fin de la Daily del calendario de ese día, si existe.
 * @param {string} p.horaLocal - Hora local de la persona, "HH:MM".
 * @param {string} [p.horaCorte=HORA_CORTE_DEFECTO] - Hora de corte si no hay evento en el calendario.
 * @returns {boolean}
 */
export function esTarde({ ahora, terminaEn = null, horaLocal, horaCorte = HORA_CORTE_DEFECTO }) {
  if (terminaEn) return ahora.getTime() > new Date(terminaEn).getTime();
  return horaLocal > horaCorte; // "HH:MM" con ceros a la izquierda se ordena como texto
}

/**
 * Calcular el estado de un integrante en la Daily de un día.
 * Quien ya registró se muestra "registrado" o "tarde"; si no registró y tiene una ausencia
 * ese día, "ausente" (sin penalización); en cualquier otro caso, "pendiente".
 *
 * @param {{daily: ({tardio: boolean}|null), ausente: boolean}} p
 * @returns {'registrado'|'tarde'|'ausente'|'pendiente'}
 */
export function estadoIntegrante({ daily, ausente }) {
  if (daily) return daily.tardio ? 'tarde' : 'registrado';
  return ausente ? 'ausente' : 'pendiente';
}

/**
 * Contar integrantes por estado para el resumen del Scrum Master.
 *
 * @param {Array<{estado: string}>} miembros
 * @returns {{registrado: number, tarde: number, ausente: number, pendiente: number}}
 */
export function resumenEstados(miembros) {
  const resumen = { registrado: 0, tarde: 0, ausente: 0, pendiente: 0 };
  for (const m of miembros) resumen[m.estado] += 1;
  return resumen;
}
