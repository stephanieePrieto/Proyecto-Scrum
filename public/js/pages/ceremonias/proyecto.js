// Responsable: Diego - HU-10, HU-11: elegir el proyecto activo y conectar los avisos en tiempo real
/**
 * Utilidades compartidas por las pantallas de ceremonias (Daily, impedimentos, ciclo, calendario, retrospectiva).
 * El proyecto es el que la persona abrió desde el dashboard: ?proyecto=ID, el último proyecto usado
 * (localStorage "proyectoActivo") o el primero disponible. Estas pantallas ya no ofrecen cambiar de proyecto.
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
