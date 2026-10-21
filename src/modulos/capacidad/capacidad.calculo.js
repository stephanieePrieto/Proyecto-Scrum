/**
 * Reunir las funciones puras de capacidad: validar lo que captura el integrante,
 * fusionar ausencias y calcular las horas disponibles dentro de un sprint.
 * No consultar la base de datos ni Express, por eso se pueden probar de forma aislada.
 *
 * Las fechas viajan como texto "AAAA-MM-DD" y se calculan en UTC para evitar
 * desfases por zona horaria.
 */

const MAX_HORAS_POR_DIA = 24;
const TIPOS_AUSENCIA = ['ausencia', 'vacaciones'];
const DIAS_LABORABLES = [1, 2, 3, 4, 5]; // Lunes a viernes (0 = domingo)
const MS_DIA = 24 * 60 * 60 * 1000;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convertir un texto "AAAA-MM-DD" en milisegundos UTC.
 * Rechazar fechas inexistentes como "2026-02-30".
 *
 * @param {string} valor - Fecha en texto.
 * @returns {number|null} Milisegundos UTC, o null si la fecha no es válida.
 */
function leerDia(valor) {
  if (typeof valor !== 'string' || !FORMATO_FECHA.test(valor)) return null;
  const [anio, mes, dia] = valor.split('-').map(Number);
  const ms = Date.UTC(anio, mes - 1, dia);
  const fecha = new Date(ms);
  const existe = fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
  return existe ? ms : null;
}

/**
 * Convertir milisegundos UTC en un texto "AAAA-MM-DD".
 *
 * @param {number} ms - Milisegundos UTC.
 * @returns {string}
 */
function formatearDia(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Redondear a 2 decimales.
 *
 * @param {number} n
 * @returns {number}
 */
const redondear = (n) => Math.round(n * 100) / 100;

/**
 * Validar los datos que captura el integrante.
 * Devolver una lista de { campo, mensaje }; una lista vacía significa datos válidos.
 * Los campos de las ausencias se nombran "ausencias[0].fechaFin", "ausencias[1].tipo", etc.
 *
 * @param {Object} datos
 * @param {number|string} datos.horasPorDia - Horas disponibles por día (0 a 24).
 * @param {Array<{tipo?: string, fechaInicio: string, fechaFin: string}>} [datos.ausencias]
 * @param {string} [datos.notas] - Texto libre, hasta 500 caracteres.
 * @returns {Array<{campo: string, mensaje: string}>}
 */
function validarCapacidad({ horasPorDia, ausencias = [], notas } = {}) {
  const errores = [];

  const horas = typeof horasPorDia === 'string' && horasPorDia.trim() !== '' ? Number(horasPorDia) : horasPorDia;
  if (typeof horas !== 'number' || !Number.isFinite(horas)) {
    errores.push({ campo: 'horasPorDia', mensaje: 'Escribe las horas que trabajas por día.' });
  } else if (horas < 0 || horas > MAX_HORAS_POR_DIA) {
    errores.push({ campo: 'horasPorDia', mensaje: 'Las horas por día deben estar entre 0 y 24.' });
  }

  if (!Array.isArray(ausencias)) {
    errores.push({ campo: 'ausencias', mensaje: 'La lista de ausencias no es válida.' });
  } else {
    ausencias.forEach((a, i) => {
      const inicio = leerDia(a?.fechaInicio);
      const fin = leerDia(a?.fechaFin);
      if (inicio === null) errores.push({ campo: `ausencias[${i}].fechaInicio`, mensaje: 'Elige una fecha de inicio válida.' });
      if (fin === null) errores.push({ campo: `ausencias[${i}].fechaFin`, mensaje: 'Elige una fecha de fin válida.' });
      if (inicio !== null && fin !== null && fin < inicio) {
        errores.push({ campo: `ausencias[${i}].fechaFin`, mensaje: 'La fecha de fin no puede ser anterior a la de inicio.' });
      }
      if (a?.tipo !== undefined && !TIPOS_AUSENCIA.includes(a.tipo)) {
        errores.push({ campo: `ausencias[${i}].tipo`, mensaje: 'El tipo debe ser ausencia o vacaciones.' });
      }
    });
  }

  if (notas != null && String(notas).length > 500) {
    errores.push({ campo: 'notas', mensaje: 'Las notas admiten hasta 500 caracteres.' });
  }
  return errores;
}

/**
 * Fusionar las ausencias que se traslapan (comparten al menos un día).
 * Si se fusionan una ausencia y unas vacaciones, conservar el tipo del rango que empieza primero.
 * Dos rangos contiguos sin días en común (14–15 y 16–17) no se fusionan.
 * Asumir ausencias ya validadas.
 *
 * @param {Array<{tipo?: string, fechaInicio: string, fechaFin: string}>} ausencias
 * @returns {{ausencias: Array, fusionadas: number}} Lista ordenada y cantidad de fusiones realizadas.
 */
function fusionarAusencias(ausencias = []) {
  const ordenadas = ausencias
    .map((a) => ({ tipo: a.tipo ?? 'ausencia', inicio: leerDia(a.fechaInicio), fin: leerDia(a.fechaFin) }))
    .sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);

  const resultado = [];
  let fusionadas = 0;
  for (const actual of ordenadas) {
    const ultima = resultado[resultado.length - 1];
    if (ultima && actual.inicio <= ultima.fin) {
      ultima.fin = Math.max(ultima.fin, actual.fin);
      fusionadas += 1;
    } else {
      resultado.push({ ...actual });
    }
  }
  return {
    ausencias: resultado.map((a) => ({ tipo: a.tipo, fechaInicio: formatearDia(a.inicio), fechaFin: formatearDia(a.fin) })),
    fusionadas,
  };
}

/**
 * Calcular las horas disponibles de UNA persona dentro de un sprint.
 * Contar los días laborables del rango que no caen en una ausencia.
 * Las ausencias fuera del rango no afectan; las que lo cruzan solo cuentan en la parte interna.
 *
 * @param {{horasPorDia: number, ausencias?: Array}} persona
 * @param {{inicio: string, fin: string}} sprint - Fechas "AAAA-MM-DD", ambas incluidas.
 * @param {number[]} [diasLaborables] - Días de la semana que se trabajan (0 = domingo).
 * @returns {{horas: number, diasHabiles: number, diasAusente: number}}
 * @throws {RangeError} Si el sprint no tiene fechas válidas.
 */
function capacidadUsuario({ horasPorDia, ausencias = [] }, sprint, diasLaborables = DIAS_LABORABLES) {
  const inicio = leerDia(sprint?.inicio);
  const fin = leerDia(sprint?.fin);
  if (inicio === null || fin === null || fin < inicio) {
    throw new RangeError('El sprint necesita fechas de inicio y fin válidas.');
  }
  const rangos = ausencias.map((a) => [leerDia(a.fechaInicio), leerDia(a.fechaFin)]);

  let diasHabiles = 0;
  let diasAusente = 0;
  for (let t = inicio; t <= fin; t += MS_DIA) {
    if (!diasLaborables.includes(new Date(t).getUTCDay())) continue;
    if (rangos.some(([desde, hasta]) => t >= desde && t <= hasta)) diasAusente += 1;
    else diasHabiles += 1;
  }
  return { horas: redondear(diasHabiles * Number(horasPorDia)), diasHabiles, diasAusente };
}

/**
 * Calcular la capacidad total del equipo en un sprint.
 * Quien aún no captura sus horas (horasPorDia null) aporta 0 h y queda con configurado:false.
 * Si el total es 0, marcar sinCapacidad:true para que la pantalla de planificación avise.
 *
 * @param {Array<{usuarioId: number, nombre?: string, horasPorDia: number|null, ausencias?: Array}>} miembros
 * @param {{inicio: string, fin: string}} sprint
 * @returns {{miembros: Array, totalHoras: number, sinCapacidad: boolean}}
 */
function capacidadEquipo(miembros, sprint) {
  const filas = miembros.map((m) => {
    const configurado = m.horasPorDia !== null && m.horasPorDia !== undefined;
    const base = configurado
      ? capacidadUsuario({ horasPorDia: m.horasPorDia, ausencias: m.ausencias ?? [] }, sprint)
      : { horas: 0, diasHabiles: 0, diasAusente: 0 };
    return { usuarioId: m.usuarioId, nombre: m.nombre, configurado, ...base };
  });
  const totalHoras = redondear(filas.reduce((suma, f) => suma + f.horas, 0));
  return { miembros: filas, totalHoras, sinCapacidad: totalHoras === 0 };
}

module.exports = {
  MAX_HORAS_POR_DIA,
  TIPOS_AUSENCIA,
  leerDia,
  formatearDia,
  validarCapacidad,
  fusionarAusencias,
  capacidadUsuario,
  capacidadEquipo,
};
