// Responsable: Alfonso - HU-52: menú "Mover a…" para mover tarjetas en pantallas táctiles y protección del arrastre
/**
 * @file mover-menu.js
 * @description En pantallas táctiles el arrastre HTML5 es poco confiable, así que cada tarjeta muestra un botón
 *              "Mover a…" (lo crea tarjeta.js y solo se ve con `pointer: coarse`, ver responsive.css). Este módulo:
 *   - Abre un menú con las columnas del tablero y mueve la tarjeta con POST /api/tarjetas/:id/mover, el endpoint
 *     que aplica permisos de rol (tarea.gestionar), límite WIP duro, bloqueo hacia la columna final y versión.
 *   - Funciona igual en la vista de columnas y en carriles (HU-21) y avisa a los filtros con
 *     `tablero:cambio-en-vivo` para que oculten la tarjeta si ya no coincide.
 *   - Lleva la cuenta de si hay un arrastre en curso (para que el sondeo no repinte a mitad de un arrastre) y,
 *     si la tablet gira o cambia de tamaño y el navegador no avisa el fin del arrastre, limpia su estado visual
 *     sin mover ni quitar la tarjeta (criterio 2).
 */

import { api } from '../../core/api.js';
import { actualizarContadoresYAlertasWip } from './arrastrar.js';
import { estaEnModoCarriles, actualizarContadoresCarriles } from './swimlanes.js';
import { obtenerColumnas, mostrarAviso } from './filtros.js';
import { arrastreVigente, ARRASTRE_INACTIVO_MS } from '../../componentes/tiempo-real.reglas.js';

/** Clases que arrastrar.js pone durante un arrastre (en la tarjeta y en la lista destino). */
const CLASES_TARJETA_ARRASTRADA = ['opacity-40', 'scale-95'];
const CLASE_LISTA_RESALTADA = 'bg-indigo-50/50';

/** Estado del arrastre en curso. */
const arrastre = { activo: false, ultimoEvento: 0 };

/** Elementos del menú (se crean una sola vez). */
let menu = null;

/**
 * Indica si hay un arrastre en curso. Lo usa el sondeo para no repintar a mitad de un arrastre.
 * @returns {boolean}
 */
export function hayArrastreEnCurso() {
  const vigente = arrastreVigente({ ...arrastre, ahora: Date.now() });
  if (!vigente) arrastre.activo = false;
  return vigente;
}

/** @returns {HTMLElement|null} */
function obtenerContenedor() {
  return document.getElementById('tablero-contenedor');
}

/** Recalcula los contadores de la vista vigente (columnas o carriles). */
function actualizarContadores() {
  const contenedor = obtenerContenedor();
  if (estaEnModoCarriles(contenedor)) actualizarContadoresCarriles(contenedor);
  else actualizarContadoresYAlertasWip();
}

/** Quita el estado visual de un arrastre que el navegador canceló sin avisar. La tarjeta queda donde estaba. */
function limpiarArrastreVisual() {
  document.querySelectorAll('.tarjeta-item').forEach((tarjeta) => tarjeta.classList.remove(...CLASES_TARJETA_ARRASTRADA));
  document.querySelectorAll('[id^="lista-tarjetas-"]').forEach((lista) => lista.classList.remove(CLASE_LISTA_RESALTADA));
  arrastre.activo = false;
}

/**
 * Al girar la pantalla o cambiar su tamaño durante un arrastre: si el navegador deja de enviar eventos de
 * arrastre, se da por terminado y se limpia su estado visual (criterio 2: la tarjeta no se pierde).
 */
function alCambiarOrientacion() {
  if (!arrastre.activo) return;
  setTimeout(() => {
    if (!hayArrastreEnCurso()) limpiarArrastreVisual();
  }, ARRASTRE_INACTIVO_MS + 100);
}

/** Registra los eventos que indican si hay un arrastre en curso. */
function seguirArrastres() {
  const marcar = () => {
    arrastre.activo = true;
    arrastre.ultimoEvento = Date.now();
  };
  const terminar = () => {
    arrastre.activo = false;
  };
  document.addEventListener('dragstart', marcar, true);
  document.addEventListener('drag', () => { arrastre.ultimoEvento = Date.now(); }, true);
  document.addEventListener('dragend', terminar, true);
  document.addEventListener('drop', terminar, true);
  window.addEventListener('orientationchange', alCambiarOrientacion);
  window.addEventListener('resize', alCambiarOrientacion);
}

/**
 * Crea el menú (modal) la primera vez; usa las clases de modales.css.
 * @returns {{overlay: HTMLElement, tarea: HTMLElement, lista: HTMLElement, error: HTMLElement, cancelar: HTMLElement}}
 */
function crearMenu() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay modal--hidden mover-menu';
  overlay.inert = true;

  const tarjeta = document.createElement('div');
  tarjeta.className = 'modal-card';
  tarjeta.setAttribute('role', 'dialog');
  tarjeta.setAttribute('aria-modal', 'true');
  tarjeta.setAttribute('aria-labelledby', 'mover-menu-titulo');
  tarjeta.style.maxWidth = '420px';

  const encabezado = document.createElement('div');
  encabezado.className = 'modal-header';
  const titulo = document.createElement('h2');
  titulo.id = 'mover-menu-titulo';
  titulo.style.cssText = 'font-size: 18px; font-weight: 600; margin: 0;';
  titulo.textContent = 'Mover a…';
  encabezado.append(titulo);

  const cuerpo = document.createElement('div');
  cuerpo.className = 'modal-body';
  const tarea = document.createElement('p');
  tarea.className = 'mover-menu__tarea';
  const lista = document.createElement('ul');
  lista.className = 'mover-menu__lista';
  lista.setAttribute('aria-label', 'Columnas del tablero');
  const error = document.createElement('p');
  error.className = 'mover-menu__error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  cuerpo.append(tarea, lista, error);

  const pie = document.createElement('div');
  pie.className = 'modal-footer';
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'btn btn--secondary';
  cancelar.textContent = 'Cancelar';
  pie.append(cancelar);

  tarjeta.append(encabezado, cuerpo, pie);
  overlay.append(tarjeta);
  document.body.append(overlay);
  return { overlay, tarea, lista, error, cancelar };
}

/**
 * Lista de la columna destino para una tarjeta, en columnas o en el mismo carril si el tablero está agrupado.
 * @param {HTMLElement} tarjeta
 * @param {string} columnaId
 * @returns {HTMLElement|null}
 */
function listaDestino(tarjeta, columnaId) {
  const carril = tarjeta.closest('.carril');
  if (carril) {
    return carril.querySelector(`.carril__celda[data-columna-id="${CSS.escape(String(columnaId))}"] [id^="lista-tarjetas-"]`);
  }
  return document.getElementById(`lista-tarjetas-${columnaId}`);
}

/**
 * Mueve la tarjeta en el servidor y, si se aceptó, en la pantalla.
 * @param {HTMLElement} tarjeta
 * @param {{id: number, nombre: string}} columna
 * @param {() => void} cerrar
 */
async function moverA(tarjeta, columna, cerrar) {
  const tareaId = Number(tarjeta.dataset.tareaId);
  if (!navigator.onLine) {
    mostrarError('Sin conexión: no se puede mover la tarjeta ahora.');
    return;
  }
  menu.lista.querySelectorAll('button').forEach((boton) => { boton.disabled = true; });
  try {
    const respuesta = await api(`/tarjetas/${tareaId}/mover`, {
      metodo: 'POST',
      cuerpo: { nuevaColumnaId: Number(columna.id) },
    });
    const tarea = respuesta?.data?.tarea || {};
    const destino = listaDestino(tarjeta, columna.id);
    if (destino) destino.append(tarjeta);
    if (tarea.version !== undefined) tarjeta.dataset.version = String(tarea.version);
    if (tarea.orden !== undefined) tarjeta.dataset.orden = String(tarea.orden);
    actualizarContadores();
    cerrar();
    mostrarAviso(`Tarjeta movida a ${columna.nombre}.`);

    // Los filtros (HU-21) actualizan su copia y ocultan la tarjeta si ya no coincide
    document.dispatchEvent(new CustomEvent('tablero:cambio-en-vivo', {
      detail: { tareaId, columnaId: Number(columna.id), version: tarea.version, orden: tarea.orden },
    }));
  } catch (error) {
    mostrarError(error?.cuerpo?.mensaje || 'No se pudo mover la tarjeta. Intenta de nuevo.');
    pintarOpciones(tarjeta, cerrar);
  }
}

/**
 * Muestra un error dentro del menú.
 * @param {string} texto
 */
function mostrarError(texto) {
  menu.error.textContent = texto;
  menu.error.hidden = false;
}

/**
 * Dibuja un botón por columna; la columna actual queda deshabilitada.
 * @param {HTMLElement} tarjeta
 * @param {() => void} cerrar
 */
function pintarOpciones(tarjeta, cerrar) {
  const actual = tarjeta.closest('[data-columna-id]')?.dataset.columnaId;
  const opciones = obtenerColumnas().map((columna) => {
    const esActual = String(columna.id) === String(actual);
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn btn--secondary mover-menu__opcion';
    boton.disabled = esActual;
    if (esActual) boton.setAttribute('aria-current', 'true');
    boton.textContent = esActual ? `${columna.nombre} (actual)` : columna.nombre;
    boton.addEventListener('click', () => moverA(tarjeta, columna, cerrar));
    const elemento = document.createElement('li');
    elemento.append(boton);
    return elemento;
  });
  menu.lista.replaceChildren(...opciones);
}

/**
 * Abre el menú "Mover a…" para una tarjeta.
 * @param {HTMLElement} tarjeta - Elemento .tarjeta-item.
 * @param {HTMLElement} botonOrigen - Botón que abrió el menú (recibe el foco al cerrar).
 */
function abrirMenu(tarjeta, botonOrigen) {
  if (!menu) menu = crearMenu();
  const titulo = tarjeta.querySelector('h4')?.textContent || `Tarea #${tarjeta.dataset.tareaId}`;
  menu.tarea.textContent = `«${titulo}»`;
  menu.error.hidden = true;

  const alTeclear = (evento) => {
    if (evento.key === 'Escape') cerrar();
  };
  const alClicFondo = (evento) => {
    if (evento.target === menu.overlay) cerrar();
  };
  function cerrar() {
    menu.overlay.classList.add('modal--hidden');
    menu.overlay.inert = true;
    document.removeEventListener('keydown', alTeclear);
    menu.overlay.removeEventListener('click', alClicFondo);
    menu.cancelar.removeEventListener('click', cerrar);
    if (botonOrigen?.isConnected) botonOrigen.focus();
  }

  pintarOpciones(tarjeta, cerrar);
  menu.overlay.inert = false;
  menu.overlay.classList.remove('modal--hidden');
  document.addEventListener('keydown', alTeclear);
  menu.overlay.addEventListener('click', alClicFondo);
  menu.cancelar.addEventListener('click', cerrar);
  (menu.lista.querySelector('button:not(:disabled)') || menu.cancelar).focus();
}

/**
 * Inicia el menú táctil y el seguimiento de arrastres. Se llama una vez desde tablero.js.
 * @returns {void}
 */
export function inicializarMenuMover() {
  const contenedor = obtenerContenedor();
  if (!contenedor || contenedor.dataset.menuMover === 'listo') return;
  contenedor.dataset.menuMover = 'listo';

  seguirArrastres();

  contenedor.addEventListener('click', (evento) => {
    const boton = evento.target.closest?.('.tarjeta-mover-btn');
    if (!boton) return;
    evento.preventDefault();
    evento.stopPropagation();
    const tarjeta = boton.closest('.tarjeta-item');
    if (tarjeta) abrirMenu(tarjeta, boton);
  });

  // Un doble toque sobre el botón no debe abrir la edición de la tarjeta (HU-25)
  contenedor.addEventListener('dblclick', (evento) => {
    if (evento.target.closest?.('.tarjeta-mover-btn')) evento.stopPropagation();
  }, true);
}
