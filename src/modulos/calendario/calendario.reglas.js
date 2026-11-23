/**
 * @file calendari.reglas.js
 * @description Reglas del calendario Scrum que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (calendario.test.js).
 *
 * Los eventos se generan a partir de las fechas del sprint, solo en días hábiles (lunes a viernes):
 *   - Planning: primer día hábil del sprint.
 *   - Daily: cada día hábil, salvo el de Planning y el de Review/Retro.
 *   - Review y Retro: último día hábil del sprint.
 * 
 * @author Diego Rafael Jiménez Trujano
 */

/** Zona horaria en la que se definen los horarios de las reuniones; cada persona los ve en la suya. */
export const ZONA_EVENTOS = 'America/Mexico_City';

/** Horarios de cada tipo de evento, "HH:MM" en ZONA_EVENTOS. */
export const HORARIOS = Object.freeze({
  planning: { inicio: '09:00', fin: '11:00', titulo: 'Sprint Planning' },
  daily: { inicio: '09:30', fin: '09:45', titulo: 'Daily Scrum' },
  review: { inicio: '15:00', fin: '16:00', titulo: 'Sprint Review' },
  retro: { inicio: '16:00', fin: '17:00', titulo: 'Retrospectiva' },
});

const MS_DIA = 24 * 3600 * 1000;

/**
 * Convertir "AAAA-MM-DD" en una fecha UTC a medianoche (sin efectos de zona horaria).
 *
 * @param {string} texto
 * @returns {Date}
 */
const aFecha = (texto) => {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};

/**
 * Convertir una fecha UTC en "AAAA-MM-DD".
 *
 * @param {Date} fecha
 * @returns {string}
 */
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);

/**
 * Indicar si el día es hábil (lunes a viernes).
 *
 * @param {Date} fecha
 * @returns {boolean}
 */
const esHabil = (fecha) => {
  const dia = fecha.getUTCDay();
  return dia >= 1 && dia <= 5;
};

/**
 * Listar los días hábiles entre dos fechas, ambas incluidas.
 *
 * @param {string} inicio - "AAAA-MM-DD".
 * @param {string} fin - "AAAA-MM-DD".
 * @returns {string[]} Fechas "AAAA-MM-DD" en orden.
 */
export function diasHabiles(inicio, fin) {
  const dias = [];
  for (let t = aFecha(inicio).getTime(); t <= aFecha(fin).getTime(); t += MS_DIA) {
    const fecha = new Date(t);
    if (esHabil(fecha)) dias.push(aTexto(fecha));
  }
  return dias;
}

/**
 * Generar los eventos Scrum de un sprint a partir de sus fechas.
 * Si el sprint no tiene días hábiles (por ejemplo, solo abarca un fin de semana), no genera nada.
 *
 * @param {{fechaInicio: string, fechaFin: string}} sprint - Fechas "AAAA-MM-DD".
 * @returns {Array<{tipo: string, titulo: string, fecha: string, horaInicio: string, horaFin: string}>}
 */
export function generarEventos({ fechaInicio, fechaFin }) {
  const habiles = diasHabiles(fechaInicio, fechaFin);
  if (!habiles.length) return [];

  const primero = habiles[0];
  const ultimo = habiles[habiles.length - 1];
  const crear = (tipo, fecha) => ({
    tipo,
    titulo: HORARIOS[tipo].titulo,
    fecha,
    horaInicio: HORARIOS[tipo].inicio,
    horaFin: HORARIOS[tipo].fin,
  });

  const eventos = [crear('planning', primero)];
  for (const dia of habiles) {
    if (dia !== primero && dia !== ultimo) eventos.push(crear('daily', dia));
  }
  eventos.push(crear('review', ultimo), crear('retro', ultimo));
  return eventos;
}

/**
 * Crear la clave que identifica un evento (tipo, día y hora de inicio) para comparar conjuntos.
 *
 * @param {{tipo: string, fecha: string, horaInicio: string}} evento
 * @returns {string}
 */
export const claveEvento = (evento) => `${evento.tipo}|${evento.fecha} ${evento.horaInicio}`;

/**
 * Indicar si los eventos guardados ya coinciden con los que corresponden a las fechas del sprint.
 *
 * @param {Array<{tipo: string, fecha: string, horaInicio: string}>} esperados
 * @param {Array<{tipo: string, fecha: string, horaInicio: string}>} existentes
 * @returns {boolean}
 */
export function coinciden(esperados, existentes) {
  if (esperados.length !== existentes.length) return false;
  const guardadas = new Set(existentes.map(claveEvento));
  return esperados.every((e) => guardadas.has(claveEvento(e)));
}

/**
 * Detectar los eventos que caen en un día de ausencia de alguien clave (Product Owner o Scrum Master).
 *
 * @param {Array<{id: number, fecha: string}>} eventos - `fecha` es el día "AAAA-MM-DD" en ZONA_EVENTOS.
 * @param {Array<{usuarioId: number, nombre: string, rol: string, desde: string, hasta: string}>} ausencias
 * @returns {Map<number, Array<{usuarioId: number, nombre: string, rol: string}>>} Conflictos por id de evento.
 */
export function conflictosPorAusencia(eventos, ausencias) {
  const conflictos = new Map();
  for (const evento of eventos) {
    const afectados = ausencias
      .filter((a) => evento.fecha >= a.desde && evento.fecha <= a.hasta)
      .map(({ usuarioId, nombre, rol }) => ({ usuarioId, nombre, rol }));
    const unicos = [...new Map(afectados.map((a) => [a.usuarioId, a])).values()];
    if (unicos.length) conflictos.set(evento.id, unicos);
  }
  return conflictos;
}

/* ====================================================================
 * Reuniones Scrum creadas por el Scrum Master
 * ==================================================================== */

/** Tipos de reunión (los mismos de los eventos generados). */
export const TIPOS_REUNION = Object.freeze(['planning', 'daily', 'review', 'retro']);

/** Largo máximo del título de una reunión. */
export const MAX_TITULO_REUNION = 150;

/** Largo máximo de las notas de una reunión. */
export const MAX_NOTAS_REUNION = 2000;

/** Participantes máximos de una reunión. */
export const MAX_PARTICIPANTES = 100;

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Indicar si un texto es una fecha "AAAA-MM-DD" que existe en el calendario.
 *
 * @param {*} texto
 * @returns {boolean}
 */
function esFecha(texto) {
  if (typeof texto !== 'string' || !FORMATO_FECHA.test(texto)) return false;
  const fecha = aFecha(texto);
  return aTexto(fecha) === texto;
}

/**
 * Pasar "HH:MM" a minutos desde la medianoche.
 *
 * @param {string} hora
 * @returns {number}
 */
const aMinutos = (hora) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Pasar minutos desde la medianoche a "HH:MM" (sin pasar de 23:59).
 *
 * @param {number} minutos
 * @returns {string}
 */
const aHora = (minutos) => {
  const limitado = Math.min(minutos, 23 * 60 + 59);
  return `${String(Math.floor(limitado / 60)).padStart(2, '0')}:${String(limitado % 60).padStart(2, '0')}`;
};

/**
 * Validar y limpiar los datos de una reunión.
 *  - Obligatorios: título, tipo y fecha.
 *  - La hora de inicio y la de fin son opcionales: si faltan se usan el horario y la duración habituales del tipo
 *    (HORARIOS). La de fin debe ser posterior a la de inicio.
 *  - Participantes (identificadores de usuario) y notas son opcionales.
 *
 * @param {{titulo?: string, tipo?: string, fecha?: string, hora_inicio?: string, hora_fin?: string,
 *   participantes?: Array<number|string>, notas?: string}} [datos]
 * @returns {{errores: Object<string,string>, valores: {titulo: string, tipo: string, fecha: string, horaInicio: string,
 *   horaFin: string, participantes: number[], notas: (string|null)}}}
 *   `errores` es un objeto { campo: mensaje } (vacío si todo está bien).
 */
export function validarReunion(datos = {}) {
  const errores = {};
  const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

  const titulo = texto(datos?.titulo);
  if (!titulo) errores.titulo = 'Escribe un título para la reunión.';
  else if (titulo.length > MAX_TITULO_REUNION) errores.titulo = `Máximo ${MAX_TITULO_REUNION} caracteres.`;

  const tipo = datos?.tipo;
  if (!TIPOS_REUNION.includes(tipo)) errores.tipo = 'Elige el tipo: Planning, Daily, Review o Retrospectiva.';

  const fecha = texto(datos?.fecha);
  if (!fecha) errores.fecha = 'Indica la fecha de la reunión.';
  else if (!esFecha(fecha)) errores.fecha = 'La fecha no es válida.';

  const habitual = HORARIOS[tipo] ?? HORARIOS.planning;
  let horaInicio = texto(datos?.hora_inicio) || habitual.inicio;
  if (!FORMATO_HORA.test(horaInicio)) {
    errores.hora_inicio = 'La hora de inicio no es válida (HH:MM).';
    horaInicio = habitual.inicio;
  }
  const duracion = aMinutos(habitual.fin) - aMinutos(habitual.inicio);
  const horaFin = texto(datos?.hora_fin) || aHora(aMinutos(horaInicio) + duracion);
  if (!FORMATO_HORA.test(horaFin)) errores.hora_fin = 'La hora de fin no es válida (HH:MM).';
  else if (!errores.hora_inicio && aMinutos(horaFin) <= aMinutos(horaInicio)) errores.hora_fin = 'La hora de fin debe ser posterior a la de inicio.';

  const participantes = [];
  const lista = datos?.participantes ?? [];
  if (!Array.isArray(lista) || lista.length > MAX_PARTICIPANTES) errores.participantes = 'La lista de participantes no es válida.';
  else {
    for (const valor of lista) {
      const id = Number(valor);
      if (!Number.isInteger(id) || id <= 0) {
        errores.participantes = 'La lista de participantes no es válida.';
        break;
      }
      if (!participantes.includes(id)) participantes.push(id);
    }
  }

  const notas = texto(datos?.notas);
  if (notas.length > MAX_NOTAS_REUNION) errores.notas = `Máximo ${MAX_NOTAS_REUNION} caracteres.`;

  return { errores, valores: { titulo, tipo, fecha, horaInicio, horaFin, participantes, notas: notas || null } };
}
