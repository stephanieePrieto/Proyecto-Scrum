/**
 * @file releases.reglas.js
 * @description Reglas de los releases que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (releases.test.js).
 *
 * @author Diego Rafael Jiménez Trujano
 */
import { esFechaValida } from '../daily/daily.reglas.js';

/** Largo máximo del nombre de un release. */
export const MAX_NOMBRE = 100;

/** Largo máximo de la descripción de un release. */
export const MAX_DESCRIPCION = 1000;

/** Sprints que se pueden asignar de una vez al crear un release. */
export const MAX_SPRINTS = 50;

/**
 * Recortar un texto recibido; cualquier otro tipo cuenta como vacío.
 *
 * @param {*} valor
 * @returns {string}
 */
const limpiar = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Validar y limpiar los datos de un release. Obligatorio: el nombre. La descripción y la fecha objetivo son opcionales.
 *
 * @param {{nombre?: string, descripcion?: string, fecha_objetivo?: string}} [datos]
 * @returns {{errores: Object<string,string>, valores: {nombre: string, descripcion: (string|null), fecha_objetivo: (string|null)}}}
 *   `errores` es un objeto { campo: mensaje } (vacío si todo está bien).
 */
export function validarRelease(datos = {}) {
  const errores = {};

  const nombre = limpiar(datos?.nombre);
  if (!nombre) errores.nombre = 'Escribe un nombre para el release.';
  else if (nombre.length > MAX_NOMBRE) errores.nombre = `Máximo ${MAX_NOMBRE} caracteres.`;

  const descripcion = limpiar(datos?.descripcion);
  if (descripcion.length > MAX_DESCRIPCION) errores.descripcion = `Máximo ${MAX_DESCRIPCION} caracteres.`;

  const fecha = limpiar(datos?.fecha_objetivo);
  if (fecha && !esFechaValida(fecha)) errores.fecha_objetivo = 'La fecha objetivo no es válida.';

  return { errores, valores: { nombre, descripcion: descripcion || null, fecha_objetivo: fecha || null } };
}

/**
 * Leer la lista de sprints que se asignan al crear un release (opcional).
 *
 * @param {*} lista
 * @returns {{error: (string|null), ids: number[]}}
 */
export function leerSprints(lista) {
  if (lista === undefined || lista === null) return { error: null, ids: [] };
  if (!Array.isArray(lista) || lista.length > MAX_SPRINTS) return { error: 'La lista de sprints no es válida.', ids: [] };
  const ids = [];
  for (const valor of lista) {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) return { error: 'La lista de sprints no es válida.', ids: [] };
    if (!ids.includes(id)) ids.push(id);
  }
  return { error: null, ids };
}

/**
 * Calcular el avance de un release a partir de sus sprints.
 *  - Porcentaje = puntos terminados / puntos de todas las historias de sus sprints (redondeado).
 *  - Una historia cuenta como terminada con la misma regla que al cerrar el sprint (aceptada en la Review con sus
 *    criterios y su Definition of Done completos); el servicio ya entrega `puntosTerminados` por sprint.
 *  - Sin puntos todavía, el avance se mide por sprints cerrados.
 *
 * @param {Array<{estado: string, puntos: number, puntosTerminados: number}>} sprints
 * @returns {{puntos: number, terminados: number, porcentaje: number, sprintsTotal: number, sprintsCerrados: number}}
 */
export function calcularProgreso(sprints = []) {
  let puntos = 0;
  let terminados = 0;
  let sprintsCerrados = 0;
  for (const s of sprints) {
    puntos += Number(s.puntos) || 0;
    terminados += Number(s.puntosTerminados) || 0;
    if (s.estado === 'cerrado') sprintsCerrados += 1;
  }
  const sprintsTotal = sprints.length;
  let porcentaje = 0;
  if (puntos > 0) porcentaje = Math.round((terminados / puntos) * 100);
  else if (sprintsTotal > 0) porcentaje = Math.round((sprintsCerrados / sprintsTotal) * 100);
  return { puntos, terminados, porcentaje: Math.min(100, Math.max(0, porcentaje)), sprintsTotal, sprintsCerrados };
}

/**
 * Mensaje para quien intenta asignar a un release un sprint que ya pertenece a otro.
 *
 * @param {string} sprint - Nombre del sprint.
 * @param {string|null} release - Nombre del release al que ya pertenece.
 * @returns {string}
 */
export function mensajeSprintEnOtroRelease(sprint, release) {
  return `El sprint «${sprint}» ya pertenece al release «${release || 'otro release'}». Un sprint solo puede estar en un release: quítalo de ese release antes de asignarlo a otro.`;
}

/**
 * Mensaje para quien intenta eliminar un sprint que pertenece a un release.
 *
 * @param {string} sprint - Nombre del sprint.
 * @param {string|null} release - Nombre del release.
 * @returns {string}
 */
export function mensajeSprintAgrupado(sprint, release) {
  return `No se puede eliminar el sprint «${sprint}» porque pertenece al release «${release || 'un release'}». Quítalo del release antes de eliminarlo.`;
}
