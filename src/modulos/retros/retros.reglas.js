// Responsable: Diego - HU-13, HU-14: reglas puras de la retrospectiva (validar ítems y acciones, votos, vencimientos, avisos de edición)
/**
 * Reglas de la retrospectiva que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (retros.test.js).
 */
import { esFechaValida } from '../daily/daily.reglas.js';

/** Columnas de notas de la retro (la tercera, "Acciones", vive en su propia tabla). */
export const COLUMNAS_ITEM = ['bien', 'mejorar'];

/** Solo se vota en "Qué mejorar": lo que salió bien ya pasó y no hay nada que priorizar. */
export const COLUMNA_VOTABLE = 'mejorar';

/** Votos que dispone cada integrante en una retro. */
export const MAX_VOTOS = 5;

export const MAX_TEXTO_ITEM = 500;
export const MAX_TEXTO_ACCION = 300;

/** Segundos que dura el aviso "X la está editando" si quien edita no lo renueva. */
export const SEGUNDOS_EDICION = 20;

const MS_DIA = 24 * 60 * 60 * 1000;

/**
 * Recortar un texto recibido; cualquier otro tipo cuenta como vacío.
 *
 * @param {*} valor
 * @returns {string}
 */
const limpiar = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Validar el texto de un ítem o de una acción: obligatorio y con largo máximo.
 *
 * @param {*} texto
 * @param {number} maximo
 * @param {string} mensajeVacio
 * @returns {{texto: string, error: (string|null)}}
 */
export function validarTexto(texto, maximo, mensajeVacio) {
  const limpio = limpiar(texto);
  if (!limpio) return { texto: limpio, error: mensajeVacio };
  if (limpio.length > maximo) return { texto: limpio, error: `Máximo ${maximo} caracteres.` };
  return { texto: limpio, error: null };
}

/**
 * Validar un ítem nuevo de la retro: columna válida y texto no vacío.
 *
 * @param {{columna?: string, texto?: string, anonimo?: boolean}} [datos]
 * @returns {{errores: Object<string,string>, valores: {columna: string, texto: string, anonimo: boolean}}}
 */
export function validarItem(datos = {}) {
  const errores = {};
  if (!COLUMNAS_ITEM.includes(datos.columna)) errores.columna = 'Elige "Qué salió bien" o "Qué mejorar".';
  const { texto, error } = validarTexto(datos.texto, MAX_TEXTO_ITEM, 'Escribe el ítem antes de publicarlo.');
  if (error) errores.texto = error;
  return { errores, valores: { columna: datos.columna, texto, anonimo: datos.anonimo === true } };
}

/**
 * Validar una acción de mejora: texto, responsable y una fecha límite que no esté en el pasado.
 *
 * @param {{texto?: string, responsable_id?: number|string, fecha_limite?: string}} [datos]
 * @param {string} hoy - "AAAA-MM-DD" en la zona de la persona.
 * @returns {{errores: Object<string,string>, valores: {texto: string, responsable_id: (number|null), fecha_limite: (string|null)}}}
 */
export function validarAccion(datos = {}, hoy) {
  const errores = {};
  const { texto, error } = validarTexto(datos.texto, MAX_TEXTO_ACCION, 'Describe la acción de mejora.');
  if (error) errores.texto = error;

  const responsable = Number(datos.responsable_id);
  const responsableValido = datos.responsable_id !== '' && datos.responsable_id != null && Number.isInteger(responsable) && responsable > 0;
  if (!responsableValido) errores.responsable_id = 'Elige quién será el responsable.';

  const fecha = limpiar(datos.fecha_limite);
  if (!fecha) errores.fecha_limite = 'Indica la fecha límite.';
  else if (!esFechaValida(fecha)) errores.fecha_limite = 'La fecha límite no es válida.';
  else if (fecha < hoy) errores.fecha_limite = 'La fecha límite no puede ser anterior a hoy.';

  return {
    errores,
    valores: { texto, responsable_id: responsableValido ? responsable : null, fecha_limite: fecha && !errores.fecha_limite ? fecha : null },
  };
}

/**
 * Votos que le quedan a una persona.
 *
 * @param {number} usados
 * @returns {number}
 */
export const votosRestantes = (usados) => Math.max(0, MAX_VOTOS - usados);

/**
 * Acciones que impiden cerrar la retro: las que no tienen responsable o fecha límite.
 *
 * @param {Array<{responsable_id: (number|null), fecha_limite: (string|null)}>} acciones
 * @returns {Array} Las acciones incompletas.
 */
export const accionesIncompletas = (acciones) => acciones.filter((a) => !a.responsable_id || !a.fecha_limite);

/**
 * Indicar si una acción pendiente ya pasó su fecha límite (se escala al Scrum Master).
 *
 * @param {{fecha_limite: (string|null), completada: boolean}} accion
 * @param {string} hoy - "AAAA-MM-DD".
 * @returns {boolean}
 */
export const estaVencida = ({ fecha_limite: fecha, completada }, hoy) => !completada && Boolean(fecha) && fecha < hoy;

/**
 * Días naturales que lleva vencida una acción (0 si no lo está).
 *
 * @param {string|null} fecha - Fecha límite "AAAA-MM-DD".
 * @param {string} hoy - "AAAA-MM-DD".
 * @returns {number}
 */
export function diasDeRetraso(fecha, hoy) {
  if (!fecha || fecha >= hoy) return 0;
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / MS_DIA);
}

/**
 * Decidir si alguien más tiene la nota en edición. El aviso caduca solo si quien edita deja de renovarlo.
 *
 * @param {{usuarioId: number, hasta: number}|undefined} bloqueo - Aviso guardado para la nota.
 * @param {number} usuarioId - Quien quiere editar o consultar.
 * @param {number} [ahora=Date.now()] - Milisegundos.
 * @returns {boolean} true si otra persona la está editando ahora mismo.
 */
export const editaOtraPersona = (bloqueo, usuarioId, ahora = Date.now()) =>
  Boolean(bloqueo) && bloqueo.usuarioId !== usuarioId && bloqueo.hasta > ahora;
