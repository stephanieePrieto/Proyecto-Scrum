// Responsable: Diego - HU-11: reglas puras de impedimentos (validar, vencimiento a los 3 días)
/**
 * Reglas de los impedimentos que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (impedimentos.test.js).
 */

/** Valores permitidos de severidad (coinciden con el CHECK de la tabla impedimentos). */
export const SEVERIDADES = Object.freeze(['baja', 'media', 'alta']);

/** Un impedimento abierto por MÁS de estos días se resalta en rojo. */
export const DIAS_PARA_ALERTA = 3;

/** Largo máximo del título. */
export const MAX_TITULO = 200;

const MS_HORA = 60 * 60 * 1000;
const MS_DIA = 24 * MS_HORA;

/**
 * Convertir un valor en un identificador entero positivo.
 *
 * @param {*} valor
 * @returns {number|null}
 */
export function aId(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Validar y limpiar lo que captura la persona al registrar un impedimento.
 * Obligatorios: título y responsable. La severidad es "media" si no se indica;
 * la tarea afectada es opcional.
 *
 * @param {{titulo?: string, severidad?: string, responsable_id?: number|string, tarea_id?: number|string|null}} [datos]
 * @returns {{errores: Object<string,string>, valores: {titulo: string, severidad: string, responsable_id: number|null, tarea_id: number|null}}}
 *   `errores` es un objeto { campo: mensaje } (vacío si todo está bien).
 */
export function validarImpedimento(datos = {}) {
  const errores = {};

  const titulo = typeof datos.titulo === 'string' ? datos.titulo.trim() : '';
  if (!titulo) errores.titulo = 'Escribe un título para el impedimento.';
  else if (titulo.length > MAX_TITULO) errores.titulo = `Máximo ${MAX_TITULO} caracteres.`;

  let severidad = 'media';
  if (datos.severidad !== undefined && datos.severidad !== null && datos.severidad !== '') {
    if (SEVERIDADES.includes(datos.severidad)) severidad = datos.severidad;
    else errores.severidad = 'Elige baja, media o alta.';
  }

  const responsableId = aId(datos.responsable_id);
  if (responsableId === null) errores.responsable_id = 'Elige quién se encargará de resolverlo.';

  let tareaId = null;
  if (datos.tarea_id !== undefined && datos.tarea_id !== null && datos.tarea_id !== '') {
    tareaId = aId(datos.tarea_id);
    if (tareaId === null) errores.tarea_id = 'La tarea elegida no es válida.';
  }

  return { errores, valores: { titulo, severidad, responsable_id: responsableId, tarea_id: tareaId } };
}

/**
 * Calcular cuántas horas lleva (o estuvo) abierto un impedimento, con un decimal.
 *
 * @param {Date|string} creadoEn
 * @param {Date|string|null} [resueltoEn] - Si ya se resolvió, se mide hasta ahí.
 * @param {Date} [ahora]
 * @returns {number}
 */
export function horasAbierto(creadoEn, resueltoEn = null, ahora = new Date()) {
  const fin = resueltoEn ? new Date(resueltoEn) : ahora;
  const horas = (fin.getTime() - new Date(creadoEn).getTime()) / MS_HORA;
  return Math.round(Math.max(0, horas) * 10) / 10;
}

/**
 * Indicar si un impedimento debe resaltarse en rojo: sigue abierto y lleva MÁS de 3 días.
 *
 * @param {{estado: string, creadoEn: Date|string}} p
 * @param {Date} [ahora]
 * @returns {boolean}
 */
export function estaVencido({ estado, creadoEn }, ahora = new Date()) {
  if (estado !== 'abierto') return false;
  return ahora.getTime() - new Date(creadoEn).getTime() > DIAS_PARA_ALERTA * MS_DIA;
}

/**
 * Mensaje para quien intenta resolver algo que otra persona ya resolvió.
 *
 * @param {string|null} nombre
 * @returns {string}
 */
export function mensajeYaResuelto(nombre) {
  return `Ya fue resuelto por ${nombre || 'otra persona'}.`;
}
