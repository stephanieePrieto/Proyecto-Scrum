// Responsable: Diego - HU-15: reglas puras del calendario (generar eventos del sprint, detectar conflictos)
/**
 * Reglas del calendario Scrum que no consultan la base de datos ni Express,
 * por eso se pueden probar de forma aislada (calendario.test.js).
 *
 * Los eventos se generan a partir de las fechas del sprint, solo en días hábiles (lunes a viernes):
 *   - Planning: primer día hábil del sprint.
 *   - Daily: cada día hábil, salvo el de Planning y el de Review/Retro.
 *   - Review y Retro: último día hábil del sprint.
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
