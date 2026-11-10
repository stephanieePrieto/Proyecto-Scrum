// Responsable: Diego - HU-15: logica de la pantalla del calendario de eventos Scrum (llama a la API y escucha sockets)
/**
 * Pintar el calendario del sprint activo:
 *   - Vista mensual o semanal, con un color por tipo de evento.
 *   - Las horas se muestran en la zona horaria del perfil de la persona.
 *   - Avisa de los eventos que caen en una ausencia del Scrum Master o del Product Owner.
 *   - Sin sprint activo, muestra un mensaje.
 *   - Se actualiza sola cuando cambian las fechas del sprint (Socket.io).
 *
 * @author Citlaly Morales Viveros (Cliente / Programadora XP)
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal, mostrarSinProyecto } from '../pages/ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';

montarBarraSuperior();

const el = {
  subtitulo: document.getElementById('subtitulo'),
  vistas: document.querySelectorAll('[data-vista]'),
  aviso: document.getElementById('aviso'),
  conflictos: document.getElementById('conflictos'),
  calendario: document.getElementById('calendario'),
  titulo: document.getElementById('titulo-periodo'),
  zona: document.getElementById('zona'),
  rejilla: document.getElementById('rejilla'),
  anterior: document.getElementById('btn-anterior'),
  siguiente: document.getElementById('btn-siguiente'),
  hoy: document.getElementById('btn-hoy'),
};

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const ETIQUETA_ROL = { scrum_master: 'Scrum Master', product_owner: 'Product Owner' };
const MS_DIA = 24 * 3600 * 1000;

const ctx = { proyectoId: null, datos: null, vista: 'mes', referencia: null, porDia: new Map() };

/* ====================================================================
 * Fechas (todo en la zona horaria de la persona)
 * ==================================================================== */

/**
 * Obtener el día "AAAA-MM-DD" de un instante en la zona de la persona.
 *
 * @param {string|Date} instante
 * @returns {string}
 */
function claveLocal(instante) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ctx.datos.zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante));
}

/**
 * Dar formato "HH:MM" a un instante en la zona de la persona.
 *
 * @param {string|Date} instante
 * @returns {string}
 */
function horaLocal(instante) {
  return new Intl.DateTimeFormat('es', { timeZone: ctx.datos.zona, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(instante));
}

const aFecha = (clave) => new Date(`${clave}T00:00:00Z`);
const aClave = (fecha) => fecha.toISOString().slice(0, 10);
const sumarDias = (clave, n) => aClave(new Date(aFecha(clave).getTime() + n * MS_DIA));

/** Lunes de la semana de un día (lunes = primer día). */
const inicioDeSemana = (clave) => sumarDias(clave, -((aFecha(clave).getUTCDay() + 6) % 7));

/**
 * Dar formato largo a un día "AAAA-MM-DD".
 *
 * @param {string} clave
 * @param {Intl.DateTimeFormatOptions} opciones
 * @returns {string}
 */
const formatoDia = (clave, opciones) => new Intl.DateTimeFormat('es', { timeZone: 'UTC', ...opciones }).format(aFecha(clave));

/* ====================================================================
 * Pintado
 * ==================================================================== */

/**
 * Pintar un evento como una pastilla de color con su hora; si tiene conflicto, lleva un aviso.
 *
 * @param {Object} e - Evento de la API.
 * @returns {string}
 */
function pintarEvento(e) {
  const conflicto = e.conflictos.length
    ? ` ⚠ <span class="solo-lectores">Conflicto: ${e.conflictos.map((c) => escaparHtml(c.nombre)).join(', ')} está ausente</span>`
    : '';
  const titulo = `${e.titulo}, ${horaLocal(e.iniciaEn)} a ${horaLocal(e.terminaEn)}${e.conflictos.length ? ' (conflicto por ausencia)' : ''}`;
  return `<li class="evento ev--${e.tipo}${e.conflictos.length ? ' evento--conflicto' : ''}" title="${escaparHtml(titulo)}">
    <span class="evento__hora">${horaLocal(e.iniciaEn)}</span> ${escaparHtml(e.titulo)}${conflicto}
  </li>`;
}

/**
 * Pintar la celda de un día con sus eventos.
 *
 * @param {string} clave - "AAAA-MM-DD".
 * @param {{fueraDelMes?: boolean, maximo?: number}} [opciones]
 * @returns {string}
 */
function pintarDia(clave, { fueraDelMes = false, maximo = 99 } = {}) {
  const eventos = ctx.porDia.get(clave) ?? [];
  const visibles = eventos.slice(0, maximo);
  const resto = eventos.length - visibles.length;
  const esHoy = clave === claveLocal(new Date());
  return `<div class="dia${fueraDelMes ? ' dia--fuera' : ''}${esHoy ? ' dia--hoy' : ''}">
    <span class="dia__numero">${Number(clave.slice(8))}</span>
    <ul class="dia__eventos">${visibles.map(pintarEvento).join('')}${resto > 0 ? `<li class="dia__mas">+${resto} más</li>` : ''}</ul>
  </div>`;
}

/**
 * Pintar la vista mensual o semanal según el estado.
 *
 * @returns {void}
 */
function pintarRejilla() {
  const cabecera = `<div class="rejilla__cabecera">${DIAS.map((d) => `<span>${d}</span>`).join('')}</div>`;
  let dias;
  if (ctx.vista === 'semana') {
    const lunes = inicioDeSemana(ctx.referencia);
    dias = Array.from({ length: 7 }, (_, i) => pintarDia(sumarDias(lunes, i)));
    el.titulo.textContent = `${formatoDia(lunes, { day: 'numeric', month: 'short' })} – ${formatoDia(sumarDias(lunes, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else {
    const primero = `${ctx.referencia.slice(0, 7)}-01`;
    const mes = ctx.referencia.slice(0, 7);
    const inicio = inicioDeSemana(primero);
    const ultimo = aClave(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0)));
    const total = Math.ceil(((aFecha(ultimo) - aFecha(inicio)) / MS_DIA + 1) / 7) * 7;
    dias = Array.from({ length: total }, (_, i) => {
      const clave = sumarDias(inicio, i);
      return pintarDia(clave, { fueraDelMes: clave.slice(0, 7) !== mes, maximo: 3 });
    });
    el.titulo.textContent = formatoDia(primero, { month: 'long', year: 'numeric' });
  }
  el.rejilla.className = `rejilla rejilla--${ctx.vista}`;
  el.rejilla.innerHTML = cabecera + dias.join('');
}

/**
 * Pintar el aviso de conflictos con ausencias del Scrum Master o Product Owner.
 *
 * @returns {void}
 */
function pintarConflictos() {
  const { conflictos } = ctx.datos;
  el.conflictos.hidden = !conflictos.length;
  el.conflictos.innerHTML = conflictos.map((c) => {
    const quienes = c.personas.map((p) => `${escaparHtml(p.nombre)} (${ETIQUETA_ROL[p.rol] ?? ''})`).join(', ');
    return `<li><strong>Conflicto:</strong> ${escaparHtml(c.titulo)} del ${formatoDia(claveLocal(c.iniciaEn), { weekday: 'long', day: 'numeric', month: 'long' })} cae en una ausencia de ${quienes}.</li>`;
  }).join('');
}

/**
 * Cambiar la fecha de referencia según la vista (un mes o una semana).
 *
 * @param {number} direccion - -1 para atrás, 1 para adelante.
 * @returns {void}
 */
function mover(direccion) {
  if (ctx.vista === 'semana') {
    ctx.referencia = sumarDias(ctx.referencia, 7 * direccion);
  } else {
    const [a, m] = ctx.referencia.split('-').map(Number);
    ctx.referencia = aClave(new Date(Date.UTC(a, m - 1 + direccion, 1)));
  }
  pintarRejilla();
}

el.anterior.addEventListener('click', () => mover(-1));
el.siguiente.addEventListener('click', () => mover(1));
el.hoy.addEventListener('click', () => { ctx.referencia = claveLocal(new Date()); pintarRejilla(); });
el.vistas.forEach((boton) => boton.addEventListener('click', () => {
  ctx.vista = boton.dataset.vista;
  el.vistas.forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));
  pintarRejilla();
}));

/* ====================================================================
 * Carga de datos
 * ==================================================================== */

/**
 * Consultar el calendario del proyecto y repintar la pantalla.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    ctx.datos = await api(`/calendario/proyecto/${ctx.proyectoId}`);
  } catch (error) {
    el.calendario.hidden = true;
    el.aviso.hidden = false;
    el.aviso.className = 'cal-aviso alerta alerta--error';
    el.aviso.textContent = error.estado === 404
      ? 'No encontramos este proyecto o no tienes acceso a él.'
      : 'No pudimos cargar el calendario. Revisa tu conexión e inténtalo de nuevo.';
    return;
  }

  const { sprint, eventos, mensaje, zona } = ctx.datos;
  el.aviso.hidden = !mensaje;
  if (mensaje) {
    el.aviso.className = 'cal-aviso alerta alerta--advertencia';
    el.aviso.textContent = mensaje;
  }
  el.calendario.hidden = !sprint;
  el.conflictos.hidden = true;
  if (!sprint) {
    el.subtitulo.textContent = 'Planning, Dailies, Review y Retro del sprint.';
    return;
  }

  el.subtitulo.textContent = `${sprint.nombre} · ${sprint.fechaInicio} a ${sprint.fechaFin}`;
  el.zona.textContent = `Horas en tu zona horaria: ${zona.replace('_', ' ')}`;

  ctx.porDia = new Map();
  for (const e of eventos) {
    const clave = claveLocal(e.iniciaEn);
    ctx.porDia.set(clave, [...(ctx.porDia.get(clave) ?? []), e]);
  }

  const hoy = claveLocal(new Date());
  if (!ctx.referencia) ctx.referencia = hoy >= sprint.fechaInicio && hoy <= sprint.fechaFin ? hoy : sprint.fechaInicio;
  el.calendario.removeAttribute('aria-busy');
  pintarConflictos();
  pintarRejilla();
}

/* ====================================================================
 * INICIO
 * ==================================================================== */

async function iniciar() {
  let eleccion;
  try {
    eleccion = await resolverProyecto();
  } catch {
    el.aviso.hidden = false;
    el.aviso.className = 'cal-aviso alerta alerta--error';
    el.aviso.textContent = 'No pudimos cargar tus proyectos. Revisa tu conexión o inicia sesión de nuevo.';
    return;
  }
  if (!eleccion.id) {
    mostrarSinProyecto(!eleccion.proyectos.length);
    return;
  }
  ctx.proyectoId = eleccion.id;
  // Permisos del proyecto elegido, para mostrar solo lo que le toca a su rol
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
  await cargar();
  const socket = conectarTiempoReal(ctx.proyectoId, ['calendario:actualizado', 'sprint:iniciado', 'sprint:cerrado'], cargar);
  if (socket) escucharCambiosDeRol(socket);
}

iniciar();
