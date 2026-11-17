// Responsable: Alfonso - HU-26: formulario "+ Tarea" del tablero en modo continuo (tarea sin sprint).
/**
 * @file tarea-continua.js
 * @description Formulario del botón "+ Tarea" del tablero cuando el proyecto trabaja en flujo continuo (HU-26).
 *  - Pide a /api/flujo-continuo/proyectos/:id/opciones-tarea las historias abiertas y los integrantes.
 *  - Crea la tarea con el endpoint existente POST /api/tareas (tareas.service.js), que en modo continuo
 *    acepta historias sin sprint, la coloca en la primera columna y avisa a los demás tableros con
 *    "tablero:tarea-creada".
 *  - Crear tareas sigue siendo exclusivo del Scrum Master: a cualquier otro rol se le explica en español
 *    por qué no puede, en lugar de mostrarle un formulario que el servidor rechazaría.
 *
 * Usa un <dialog> con las clases .eq-dialogo (equipos.css). Los textos del usuario pasan por escaparHtml.
 *
 * Uso: abrirTareaContinua({ proyectoId, alCrear: (tarea) => recargarTablero() });
 *
 * @author Alfonso Mendoza Vasquez
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';

const ID_DIALOGO = 'dialogo-tarea-continua';

/** Mensaje para quien no es Scrum Master. */
export const MENSAJE_SOLO_SCRUM_MASTER =
  'Solo el Scrum Master del proyecto puede crear tareas. Pídele que la agregue o que revise tu rol en el proyecto.';

let estado = { proyectoId: null, alCrear: null, enviando: false };

/**
 * Crea el <dialog> la primera vez y lo devuelve.
 * @returns {HTMLDialogElement}
 */
function obtenerDialogo() {
  let dialogo = document.getElementById(ID_DIALOGO);
  if (dialogo) return dialogo;

  dialogo = document.createElement('dialog');
  dialogo.id = ID_DIALOGO;
  dialogo.className = 'eq-dialogo';
  dialogo.setAttribute('aria-labelledby', `${ID_DIALOGO}-titulo`);
  dialogo.innerHTML = `
    <h2 class="eq-dialogo__titulo" id="${ID_DIALOGO}-titulo">Nueva tarea</h2>
    <div data-tarea-cuerpo></div>`;
  document.body.appendChild(dialogo);
  dialogo.addEventListener('click', (evento) => {
    if (evento.target.closest('[data-tarea-cerrar]')) dialogo.close();
  });
  return dialogo;
}

/** Mensaje legible para un error de la API. */
function mensajeDeError(error) {
  if (error?.estado === 403) return MENSAJE_SOLO_SCRUM_MASTER;
  if (!error?.estado) return 'Sin conexión. Tus datos siguen en el formulario; inténtalo de nuevo al reconectar.';
  return error.cuerpo?.mensaje || 'No se pudo crear la tarea. Inténtalo de nuevo.';
}

/**
 * Muestra un mensaje con un solo botón para cerrar.
 * @param {string} titulo
 * @param {string} html Contenido ya escapado.
 */
function mostrarMensaje(titulo, html) {
  const dialogo = obtenerDialogo();
  dialogo.querySelector(`#${ID_DIALOGO}-titulo`).textContent = titulo;
  dialogo.querySelector('[data-tarea-cuerpo]').innerHTML = `${html}
    <div class="eq-dialogo__acciones">
      <button type="button" class="boton boton--primario" data-tarea-cerrar>Entendido</button>
    </div>`;
}

/**
 * Dibuja el formulario de la tarea.
 * @param {{historias: Array<Object>, integrantes: Array<Object>}} opciones
 */
function dibujarFormulario({ historias, integrantes }) {
  const dialogo = obtenerDialogo();
  dialogo.querySelector(`#${ID_DIALOGO}-titulo`).textContent = 'Nueva tarea';
  const opcionesHistoria = historias.map((h) =>
    `<option value="${Number(h.id)}">HU-${Number(h.numeroHu)} · ${escaparHtml(h.titulo)}</option>`).join('');
  const opcionesPersona = integrantes.map((p) =>
    `<option value="${Number(p.id)}">${escaparHtml(p.nombre)}</option>`).join('');

  dialogo.querySelector('[data-tarea-cuerpo]').innerHTML = `
    <p class="subtitulo-pagina">El proyecto trabaja en flujo continuo: la tarea no pertenece a ningún sprint y aparece en la primera columna del tablero.</p>
    <form data-tarea-formulario novalidate style="margin-top: 12px;">
      <div class="tarea-continua__campo">
        <label class="form-label" for="tarea-continua-historia">Historia</label>
        <select class="form-select" id="tarea-continua-historia" name="historia_id" required>${opcionesHistoria}</select>
      </div>
      <div class="tarea-continua__campo">
        <label class="form-label" for="tarea-continua-titulo">Título</label>
        <input class="form-input" id="tarea-continua-titulo" name="titulo" type="text" maxlength="200" required />
      </div>
      <div class="tarea-continua__campo">
        <label class="form-label" for="tarea-continua-descripcion">Descripción (opcional)</label>
        <textarea class="form-input" id="tarea-continua-descripcion" name="descripcion" rows="3"></textarea>
      </div>
      <div class="tarea-continua__campo">
        <label class="form-label" for="tarea-continua-responsable">Responsable</label>
        <select class="form-select" id="tarea-continua-responsable" name="responsable_id" required>${opcionesPersona}</select>
      </div>
      <div class="tarea-continua__campo">
        <label class="form-label" for="tarea-continua-horas">Horas estimadas</label>
        <input class="form-input" id="tarea-continua-horas" name="horas_estimadas" type="number" min="0.1" step="0.1" inputmode="decimal" required />
      </div>
      <p class="modo-flujo__error" data-tarea-error role="alert"></p>
      <div class="eq-dialogo__acciones">
        <button type="button" class="boton boton--secundario" data-tarea-cerrar>Cancelar</button>
        <button type="submit" class="boton boton--primario" data-tarea-guardar>Crear tarea</button>
      </div>
    </form>`;

  dialogo.querySelector('[data-tarea-formulario]').addEventListener('submit', guardar);
  dialogo.querySelector('#tarea-continua-titulo').focus();
}

/** Envía la tarea al endpoint existente de tareas. */
async function guardar(evento) {
  evento.preventDefault();
  if (estado.enviando) return;
  const formulario = evento.currentTarget;
  const error = formulario.querySelector('[data-tarea-error]');
  const boton = formulario.querySelector('[data-tarea-guardar]');
  const datos = Object.fromEntries(new FormData(formulario));

  if (!String(datos.titulo || '').trim()) {
    error.textContent = 'Escribe el título de la tarea.';
    formulario.querySelector('#tarea-continua-titulo').focus();
    return;
  }

  estado.enviando = true;
  boton.disabled = true;
  error.textContent = '';
  try {
    const tarea = await api('/tareas', {
      metodo: 'POST',
      cuerpo: {
        historia_id: Number(datos.historia_id),
        titulo: String(datos.titulo).trim(),
        descripcion: String(datos.descripcion || '').trim(),
        responsable_id: Number(datos.responsable_id),
        horas_estimadas: Number(datos.horas_estimadas),
      },
    });
    obtenerDialogo().close();
    if (typeof estado.alCrear === 'function') estado.alCrear(tarea);
  } catch (fallo) {
    error.textContent = mensajeDeError(fallo);
  } finally {
    estado.enviando = false;
    boton.disabled = false;
  }
}

/**
 * Abre el formulario de tarea del tablero continuo.
 * @param {Object} opciones
 * @param {number|string} opciones.proyectoId Proyecto activo.
 * @param {(tarea: Object) => void} [opciones.alCrear] Se llama al crear la tarea (por ejemplo, para recargar el tablero).
 * @returns {Promise<void>}
 */
export async function abrirTareaContinua({ proyectoId, alCrear } = {}) {
  estado = { proyectoId: Number(proyectoId), alCrear, enviando: false };
  const dialogo = obtenerDialogo();
  dialogo.querySelector('[data-tarea-cuerpo]').innerHTML = '<p class="subtitulo-pagina">Cargando…</p>';
  if (!dialogo.open) dialogo.showModal();

  try {
    const respuesta = await api(`/flujo-continuo/proyectos/${estado.proyectoId}/opciones-tarea`);
    const opciones = respuesta.datos;

    if (opciones.modo !== 'continuo') {
      mostrarMensaje('Proyecto en modo Scrum',
        '<p>Este proyecto trabaja con sprints: las tareas se crean desde Planificación del sprint.</p>');
    } else if (!opciones.puedeCrear) {
      mostrarMensaje('No puedes crear tareas', `<p>${escaparHtml(MENSAJE_SOLO_SCRUM_MASTER)}</p>`);
    } else if (!opciones.historias.length) {
      mostrarMensaje('No hay historias abiertas',
        '<p>Cada tarea pertenece a una historia. Crea una historia en el <a href="/pages/backlog.html">Backlog</a> y vuelve a intentarlo.</p>');
    } else {
      dibujarFormulario(opciones);
    }
  } catch (error) {
    mostrarMensaje('No se pudo abrir el formulario', `<p>${escaparHtml(mensajeDeError(error))}</p>`);
  }
}
