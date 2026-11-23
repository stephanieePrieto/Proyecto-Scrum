/**
 * @file ciclo-sprint.reglas.js
 * @description Reglas del ciclo del sprint que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (ciclo-sprint.test.js).
 * 
 * @author Diego Rafael Jiménez Trujano
 */
import { separarCriterios, dodDeHistoria, MAX_DOD } from '../reviews/reviews.reglas.js';

/** Historias que se pueden actualizar de una sola vez al guardar la DoD del sprint. */
export const MAX_HISTORIAS_DOD = 200;

/** Estados de una historia que cuentan como terminada para la velocity (si además pasó la verificación). */
export const ESTADOS_TERMINADA = Object.freeze(['hecho', 'aceptada']);

/** Texto para cada cosa que le puede faltar verificar a una historia en la Review. */
export const MOTIVOS_SIN_VERIFICAR = Object.freeze({
  criterios: 'Sus criterios de aceptación no se cumplieron en la Review.',
  dod: 'Su Definition of Done no se cumplió en la Review.',
});

/**
 * indicar qué le falta verificar en la Review a una historia para contar como terminada al cerrar el sprint.
 * El Product Owner (o su delegado) debió aceptarla con todos sus criterios de aceptación y todos los puntos de su
 * Definition of Done (la del sprint o la del proyecto, más la propia). Si no tiene criterios ni DoD, no hay nada que verificar.
 * Una decisión tomada antes de que existiera la DoD (dod_cumplidos NULL) no cuenta como verificada.
 *
 * @param {{criterios?: (string|null), decision?: (string|null), criterios_cumplidos?: (number|null),
 *   dod_proyecto?: (string|null), dod_sprint?: (string|null), dod_historia?: (string|null), dod_cumplidos?: (number|null)}} historia
 *   `decision`, `criterios_cumplidos` y `dod_cumplidos` son los de la Review de ese sprint (null si no se ha decidido).
 * @returns {Array<keyof MOTIVOS_SIN_VERIFICAR>} Lo que falta; vacío si está verificada.
 */
export function faltaVerificar({
  criterios = null, decision = null, criterios_cumplidos: cumplidos = null,
  dod_proyecto: dodProyecto = null, dod_sprint: dodSprint = null, dod_historia: dodHistoria = null, dod_cumplidos: dodCumplidos = null,
} = {}) {
  const faltan = [];
  const aceptada = decision === 'aceptada';
  const totalCriterios = separarCriterios(criterios).length;
  if (totalCriterios > 0 && !(aceptada && Number(cumplidos) >= totalCriterios)) faltan.push('criterios');
  const totalDod = dodDeHistoria({ dodProyecto, dodSprint, dodHistoria }).length;
  if (totalDod > 0 && !(aceptada && dodCumplidos !== null && Number(dodCumplidos) >= totalDod)) faltan.push('dod');
  return faltan;
}

/**
 * Limpiar el texto de una Definition of Done: vacío se guarda como NULL.
 *
 * @param {*} valor
 * @returns {{texto: (string|null), error: (string|null)}}
 */
function limpiarDod(valor) {
  if (valor === null || valor === undefined) return { texto: null, error: null };
  if (typeof valor !== 'string') return { texto: null, error: 'Escribe la Definition of Done como texto, un punto por línea.' };
  const texto = valor.replace(/\r\n/g, '\n').trim();
  if (texto.length > MAX_DOD) return { texto: null, error: `Máximo ${MAX_DOD} caracteres.` };
  return { texto: texto || null, error: null };
}

/**
 * validar lo que el Scrum Master guarda como Definition of Done del sprint y de sus historias.
 * La del sprint vacía significa "usar la del proyecto"; la de una historia vacía significa "sin puntos extra".
 *
 * @param {{definition_of_done?: (string|null), historias?: Array<{id: number, definition_of_done?: (string|null)}>}} [datos]
 * @returns {{errores: Object<string,string>, valores: {sprint: (string|null), historias: Array<{id: number, texto: (string|null)}>}}}
 *   Los errores de una historia usan la clave `historia-<id>`.
 */
export function validarDod(datos = {}) {
  const errores = {};
  const sprint = limpiarDod(datos?.definition_of_done);
  if (sprint.error) errores.definition_of_done = sprint.error;

  const historias = [];
  const lista = datos?.historias ?? [];
  if (!Array.isArray(lista)) errores.historias = 'La lista de historias no es válida.';
  else if (lista.length > MAX_HISTORIAS_DOD) errores.historias = `Máximo ${MAX_HISTORIAS_DOD} historias a la vez.`;
  else {
    const vistas = new Set();
    for (const item of lista) {
      const id = Number(item?.id);
      if (!Number.isInteger(id) || id <= 0 || vistas.has(id)) {
        errores.historias = 'La lista de historias no es válida.';
        break;
      }
      vistas.add(id);
      const { texto, error } = limpiarDod(item.definition_of_done);
      if (error) errores[`historia-${id}`] = error;
      historias.push({ id, texto });
    }
  }
  return { errores, valores: { sprint: sprint.texto, historias } };
}

/**
 * Indicar si una historia cuenta como terminada al cerrar: está en "hecho" o "aceptada" y no le falta verificar nada.
 *
 * @param {{estado: string}} historia - Ver faltaVerificar() para el resto de los campos.
 * @returns {boolean}
 */
export function estaTerminada(historia) {
  return ESTADOS_TERMINADA.includes(historia.estado) && faltaVerificar(historia).length === 0;
}

/** Decisiones posibles sobre las historias no terminadas al cerrar. */
export const DESTINOS = Object.freeze(['backlog', 'siguiente']);

/** Decisiones posibles sobre las historias con tarjetas "En revisión". */
export const DECISIONES_REVISION = Object.freeze(['hecho', 'pendiente']);

/**
 * Listar qué le falta a un sprint para poder iniciarse.
 *
 * @param {Object} p
 * @param {string|null} p.objetivo - Objetivo del sprint.
 * @param {number|string|null} p.capacidad - Capacidad en horas.
 * @param {number} p.totalHistorias - Historias asignadas al sprint.
 * @param {boolean} p.tieneScrumMaster - El proyecto tiene un Scrum Master activo.
 * @param {boolean} p.tieneProductOwner - El proyecto tiene un Product Owner activo.
 * @returns {{campos: Object<string,string>, faltantes: string[]}} `campos` por campo del formulario y
 *   `faltantes` como lista de frases para mostrar; ambos vacíos si todo está listo.
 */
export function faltantesParaIniciar({ objetivo, capacidad, totalHistorias, tieneScrumMaster, tieneProductOwner }) {
  const campos = {};
  const faltantes = [];

  if (!objetivo || !String(objetivo).trim()) {
    campos.objetivo = 'Escribe el objetivo del sprint.';
    faltantes.push('El sprint no tiene objetivo.');
  }
  const horas = Number(capacidad);
  if (!Number.isFinite(horas) || horas <= 0) {
    campos.capacidad_horas = 'Indica una capacidad mayor a 0 horas.';
    faltantes.push('Falta confirmar la capacidad del sprint.');
  }
  if (!totalHistorias) faltantes.push('El sprint no tiene historias asignadas.');
  if (!tieneScrumMaster) faltantes.push('El proyecto no tiene un Scrum Master asignado.');
  if (!tieneProductOwner) faltantes.push('El proyecto no tiene un Product Owner asignado.');

  return { campos, faltantes };
}

/**
 * Calcular el resumen de cierre de un sprint a partir de sus historias.
 * Velocity = suma de puntos de las historias terminadas (hecho o aceptada, y verificadas: ver estaTerminada()).
 * No terminadas = el resto (en_sprint, rechazada o sin verificar en la Review).
 *
 * @param {Array<{estado: string, puntos: number|null}>} historias
 * @returns {{total: number, terminadas: number, noTerminadas: number, puntosTotales: number, velocity: number}}
 */
export function calcularResumen(historias) {
  let terminadas = 0;
  let puntosTotales = 0;
  let velocity = 0;
  for (const h of historias) {
    const puntos = Number(h.puntos) || 0;
    puntosTotales += puntos;
    if (estaTerminada(h)) {
      terminadas += 1;
      velocity += puntos;
    }
  }
  return { total: historias.length, terminadas, noTerminadas: historias.length - terminadas, puntosTotales, velocity };
}

/**
 * Validar las decisiones que la persona toma al cerrar el sprint.
 *
 * @param {Object} p
 * @param {string} [p.destino] - 'backlog' o 'siguiente'.
 * @param {string} [p.revision] - 'hecho' o 'pendiente'.
 * @param {number} p.noTerminadas - Historias que no se terminaron.
 * @param {number} p.enRevision - Historias con tarjetas en "En revisión".
 * @returns {Object<string,string>} { campo: mensaje }; vacío si todo es válido.
 */
export function validarCierre({ destino, revision, noTerminadas, enRevision }) {
  const errores = {};
  if (enRevision > 0 && !DECISIONES_REVISION.includes(revision)) {
    errores.revision = 'Hay tarjetas en revisión: decide si esas historias se dan por terminadas o siguen pendientes.';
  }
  if (noTerminadas > 0 && !DESTINOS.includes(destino)) {
    errores.destino = 'Elige si las historias no terminadas vuelven al backlog o pasan al siguiente sprint.';
  }
  return errores;
}
