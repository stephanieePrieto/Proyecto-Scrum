// Responsable: Diego - HU-10, HU-11: elegir el proyecto activo y conectar los avisos en tiempo real
/**
 * Utilidades compartidas por las pantallas de Daily Scrum e impedimentos.
 * Siguen la misma convención que backlog y dashboard: ?proyecto=ID, el último proyecto usado
 * (localStorage "proyectoActivo") o el primero disponible.
 */
import { api } from '../../core/api.js';

/**
 * Elegir el proyecto con el que trabaja la pantalla.
 * Solo se acepta un proyecto que aparezca en la lista de la persona (si no, se ignora).
 *
 * @returns {Promise<{id: (number|null), proyectos: Array<{id: number, nombre: string}>}>}
 *   `id` es null si la persona no tiene proyectos.
 * @throws {Error} Si no se pudo consultar la lista de proyectos (con `estado` HTTP).
 */
export async function resolverProyecto() {
  const { proyectos = [] } = await api('/proyectos');
  const existe = (id) => proyectos.some((p) => p.id === Number(id));

  const explicito = new URLSearchParams(location.search).get('proyecto');
  let guardado = null;
  try { guardado = localStorage.getItem('proyectoActivo'); } catch { /* almacenamiento bloqueado */ }

  const id = [explicito, guardado].find((candidato) => candidato && existe(candidato)) ?? proyectos[0]?.id ?? null;
  if (id) {
    try { localStorage.setItem('proyectoActivo', String(id)); } catch { /* almacenamiento bloqueado */ }
  }
  return { id: id ? Number(id) : null, proyectos };
}

/**
 * Conectar Socket.io, unirse a la sala del proyecto y ejecutar una función cuando llegue
 * cualquiera de los eventos. Varios eventos seguidos se juntan en una sola recarga.
 * Si el cliente de Socket.io no cargó, no hace nada (la pantalla sigue funcionando sin tiempo real).
 *
 * @param {number} proyectoId
 * @param {string[]} eventos - Nombres de los eventos a escuchar.
 * @param {() => void} alCambiar - Función que recarga la pantalla.
 * @returns {object|null} El socket, o null si no hay Socket.io.
 */
export function conectarTiempoReal(proyectoId, eventos, alCambiar) {
  if (typeof window.io !== 'function') return null;
  try {
    const socket = window.io();
    let temporizador = null;
    const recargar = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(alCambiar, 250);
    };
    socket.on('connect', () => socket.emit('unirse_proyecto', proyectoId));
    eventos.forEach((evento) => socket.on(evento, recargar));
    return socket;
  } catch {
    return null;
  }
}

/**
 * Llenar un <select> con los proyectos de la persona; al cambiar, recargar la página con ?proyecto=ID.
 * Se oculta si solo hay un proyecto.
 *
 * @param {HTMLSelectElement} select
 * @param {Array<{id: number, nombre: string}>} proyectos
 * @param {number} idActivo
 * @param {(texto: string) => string} escapar - Función para escapar HTML.
 * @param {string} ruta - Ruta de la página, por ejemplo "/pages/daily.html".
 * @returns {void}
 */
export function pintarSelectorProyecto(select, proyectos, idActivo, escapar, ruta) {
  select.hidden = proyectos.length < 2;
  select.innerHTML = proyectos
    .map((p) => `<option value="${p.id}"${p.id === idActivo ? ' selected' : ''}>${escapar(p.nombre)}</option>`)
    .join('');
  select.addEventListener('change', () => {
    try { localStorage.setItem('proyectoActivo', select.value); } catch { /* almacenamiento bloqueado */ }
    location.href = `${ruta}?proyecto=${encodeURIComponent(select.value)}`;
  });
}
