// Responsable: Diego - HU-09: reglas puras de iniciar y cerrar un sprint (faltantes, resumen, velocity, decisiones)
/**
 * Reglas del ciclo del sprint que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (ciclo-sprint.test.js).
 */

/** Estados de una historia que cuentan como terminada para la velocity. */
export const ESTADOS_TERMINADA = Object.freeze(['hecho', 'aceptada']);

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
 * Velocity = suma de puntos de las historias terminadas (hecho o aceptada).
 * No terminadas = el resto (en_sprint o rechazada).
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
    if (ESTADOS_TERMINADA.includes(h.estado)) {
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
