// Responsable: Diego - HU-10, HU-11: elegir el proyecto activo y conectar los avisos en tiempo real
/**
 * Utilidades compartidas por las pantallas de ceremonias (Daily, impedimentos, ciclo, calendario, retrospectiva).
 * El proyecto es el que la persona abrió desde el dashboard: ?proyecto=ID o el último proyecto usado
 * (localStorage "proyectoActivo"). Estas pantallas no ofrecen cambiar de proyecto: si no hay uno elegido,
 * muestran un aviso para volver al dashboard (mostrarSinProyecto).
 */
import { api } from '../../core/api.js';

/**
 * Elegir el proyecto con el que trabaja la pantalla.
 * Solo se acepta un proyecto que aparezca en la lista de la persona (si no, se ignora).
 *
 * @param {{primeroPorDefecto?: boolean}} [opciones] - Con `primeroPorDefecto`, si no hay proyecto elegido
 *   se toma el primero de la lista (lo usan las pantallas que sí pueden trabajar sin una elección previa).
 * @returns {Promise<{id: (number|null), proyectos: Array<{id: number, nombre: string}>}>}
 *   `id` es null si la persona no tiene proyectos.
 * @throws {Error} Si no se pudo consultar la lista de proyectos (con `estado` HTTP).
 */
export async function resolverProyecto({ primeroPorDefecto = false } = {}) {
  const { proyectos = [] } = await api('/proyectos');
  const existe = (id) => proyectos.some((p) => p.id === Number(id));

  const explicito = new URLSearchParams(location.search).get('proyecto');
  let guardado = null;
  try { guardado = localStorage.getItem('proyectoActivo'); } catch { /* almacenamiento bloqueado */ }

  const id = [explicito, guardado].find((candidato) => candidato && existe(candidato)) ?? (primeroPorDefecto ? proyectos[0]?.id : null) ?? null;
  if (id) {
    try { localStorage.setItem('proyectoActivo', String(id)); } catch { /* almacenamiento bloqueado */ }
  }
  return { id: id ? Number(id) : null, proyectos };
}

/**
 * Reemplazar el contenido de la pantalla por un aviso con el botón para volver al dashboard y elegir proyecto.
 * Se usa cuando la pantalla necesita un proyecto y la persona no ha elegido uno (o no tiene ninguno).
 * Conserva el título de la página y oculta el resto (formularios, botones y listas que necesitan datos).
 *
 * @param {boolean} [sinProyectos=false] - true si la persona no pertenece a ningún proyecto.
 * @returns {void}
 */
export function mostrarSinProyecto(sinProyectos = false) {
  const principal = document.querySelector('main');
  if (!principal) return;
  principal.querySelector('[aria-busy="true"]')?.removeAttribute('aria-busy');
  for (const hijo of principal.children) {
    if (hijo.classList.contains('encabezado-pagina')) {
      [...hijo.children].slice(1).forEach((parte) => { parte.hidden = true; });
    } else {
      hijo.hidden = true;
    }
  }
  const aviso = document.createElement('div');
  aviso.className = 'aviso--vacio';
  aviso.innerHTML = `
    <h3 class="aviso__titulo">${sinProyectos ? 'Todavía no perteneces a ningún proyecto' : 'No hay un proyecto seleccionado'}</h3>
    <p class="aviso__texto">${sinProyectos ? 'Cuando te agreguen a uno, aparecerá en el Dashboard.' : 'Elige un proyecto desde el Dashboard para ver esta pantalla.'}</p>
    <a class="boton boton--primario" href="/pages/dashboard.html">Ir al Dashboard</a>`;
  principal.append(aviso);
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
