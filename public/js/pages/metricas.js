/**
 * @file metricas.js
 * @description Página de métricas del proyecto: carga la velocity (HU-30) y el avance (HU-31).
 * Cada sección se carga por separado: si una falla, la otra se muestra igual (mismo criterio
 * de aislamiento de errores que el dashboard de la HU-35).
 * El proyecto sale de ?proyecto=ID o, si falta, de GET /api/metricas/mis-proyectos.
 * Las demás gráficas (burndown, distribución, umbrales, exportar) se agregan en sus propios
 * sprints dentro de public/js/pages/metricas/ y se invocan desde cargarTodo().
 * @author Dana
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';
import { dibujarVelocity } from './metricas/velocity.js';
import { dibujarAvance } from './metricas/avance.js';

// Guardar referencias a los elementos de la página
const contVelocity = document.getElementById('velocity-contenido');
const contAvance = document.getElementById('avance-contenido');
const selectSprint = document.getElementById('filtro-sprint');
const selectProyecto = document.getElementById('filtro-proyecto');
const cajaProyecto = document.getElementById('selector-proyecto');
const avisoError = document.getElementById('metricas-error');

// Clave donde el dashboard guarda el proyecto activo; se comparte para que ambas páginas muestren el mismo
const CLAVE_PROYECTO = 'proyectoActivo';

/**
 * Leer el proyecto de la URL (?proyecto=ID).
 *
 * @returns {number|null} Identificador del proyecto, o null si falta o no es válido.
 */
function proyectoDeLaUrl() {
  const id = Number(new URLSearchParams(window.location.search).get('proyecto'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Guardar el proyecto elegido en la URL (sin recargar) y en localStorage (proyectoActivo).
 * El almacenamiento puede estar bloqueado por el navegador, por eso se protege con try/catch.
 *
 * @param {number} proyectoId Proyecto elegido.
 * @returns {void}
 */
function recordarProyecto(proyectoId) {
  const url = new URL(window.location.href);
  url.searchParams.set('proyecto', proyectoId);
  window.history.replaceState(null, '', url);
  try { window.localStorage.setItem(CLAVE_PROYECTO, String(proyectoId)); } catch { /* sin almacenamiento */ }
}

/**
 * Decidir qué proyecto mostrar cuando la URL no lo indica.
 * Orden: el proyecto activo del dashboard (si el usuario aún pertenece a él) y si no el primero de la lista.
 * Si el usuario tiene varios proyectos, muestra el selector de proyecto.
 *
 * @returns {Promise<number|null>} Proyecto a mostrar, o null si el usuario no pertenece a ninguno.
 */
async function elegirProyecto() {
  const proyectos = await api('/metricas/mis-proyectos');
  if (proyectos.length === 0) return null;

  selectProyecto.innerHTML = proyectos
    .map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`)
    .join('');
  cajaProyecto.hidden = proyectos.length < 2;

  let recordado = null;
  try { recordado = Number(window.localStorage.getItem(CLAVE_PROYECTO)); } catch { /* sin almacenamiento */ }
  const elegido = proyectos.find((p) => p.id === (proyectoDeLaUrl() || recordado)) || proyectos[0];
  selectProyecto.value = String(elegido.id);
  return elegido.id;
}

/**
 * Montar la barra superior (menú, usuario y notificaciones) con core/layout.js.
 * Se importa de forma dinámica: si el layout falla, las métricas se muestran igual.
 *
 * @returns {Promise<void>}
 */
async function montarLayout() {
  try {
    const layout = await import('../core/layout.js');
    await layout.montarBarraSuperior();
  } catch (error) {
    console.warn('[metricas] No se pudo montar la barra superior:', error.message);
  }
}

/**
 * Traducir un error de la API a un texto para el usuario.
 * Redirigir al login cuando la sesión expiró (401).
 *
 * @param {Error & {estado?: number, cuerpo?: {mensaje?: string}}} error Error lanzado por api().
 * @returns {string} Mensaje a mostrar.
 */
function mensajeDeError(error) {
  if (error.estado === 401) {
    window.location.href = '/pages/login.html';
    return 'Tu sesión terminó. Inicia sesión de nuevo.';
  }
  if (error.estado === 403) return 'No tienes acceso a las métricas de este proyecto.';
  return error.cuerpo?.mensaje || 'No se pudo cargar esta sección.';
}

/**
 * Mostrar el error de una sección con un botón para reintentar solo esa sección.
 *
 * @param {HTMLElement} contenedor Contenedor de la sección.
 * @param {Error} error Error ocurrido.
 * @param {string} clave 'velocity' o 'avance' (se guarda en data-reintentar).
 * @returns {void}
 */
function mostrarErrorSeccion(contenedor, error, clave) {
  contenedor.innerHTML = `<div class="alerta alerta--error metricas__error" role="alert">
      <span>${escaparHtml(mensajeDeError(error))}</span>
      <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar="${clave}">Reintentar</button>
    </div>`;
}

/**
 * Mostrar un esqueleto de carga mientras llegan los datos.
 *
 * @param {HTMLElement} contenedor Contenedor de la sección.
 * @returns {void}
 */
function mostrarCarga(contenedor) {
  contenedor.setAttribute('aria-busy', 'true');
  contenedor.innerHTML = '<span class="esqueleto metricas__esqueleto"></span>';
}

/**
 * Cargar y dibujar la velocity (HU-30).
 *
 * @param {number} proyectoId Proyecto a consultar.
 * @returns {Promise<void>}
 */
async function cargarVelocity(proyectoId) {
  mostrarCarga(contVelocity);
  try {
    dibujarVelocity(contVelocity, await api(`/metricas/proyectos/${proyectoId}/velocity`));
  } catch (error) {
    mostrarErrorSeccion(contVelocity, error, 'velocity');
  } finally {
    contVelocity.removeAttribute('aria-busy');
  }
}

/**
 * Llenar el selector de sprints con los del proyecto (sin perder la opción elegida).
 *
 * @param {Array<{id: number, nombre: string, estado: string}>} sprints Sprints del proyecto.
 * @param {number|null} elegido Sprint seleccionado actualmente.
 * @returns {void}
 */
function llenarSelectorSprints(sprints, elegido) {
  selectSprint.innerHTML = '<option value="">Todo el proyecto</option>' + sprints
    .map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)} (${escaparHtml(s.estado)})</option>`)
    .join('');
  selectSprint.value = elegido ? String(elegido) : '';
}

/**
 * Cargar y dibujar el avance por persona y por equipo (HU-31).
 *
 * @param {number} proyectoId Proyecto a consultar.
 * @param {number|null} [sprintId] Sprint a filtrar; null = todo el proyecto.
 * @returns {Promise<void>}
 */
async function cargarAvance(proyectoId, sprintId = null) {
  mostrarCarga(contAvance);
  try {
    const consulta = sprintId ? `?sprintId=${sprintId}` : '';
    const datos = await api(`/metricas/proyectos/${proyectoId}/avance${consulta}`);
    llenarSelectorSprints(datos.sprints, datos.sprintId);
    dibujarAvance(contAvance, datos);
  } catch (error) {
    mostrarErrorSeccion(contAvance, error, 'avance');
  } finally {
    contAvance.removeAttribute('aria-busy');
  }
}

/**
 * Cargar todas las secciones en paralelo; una que falle no bloquea a las demás.
 *
 * @param {number} proyectoId Proyecto a consultar.
 * @returns {Promise<void>}
 */
function cargarTodo(proyectoId) {
  return Promise.allSettled([
    cargarVelocity(proyectoId),
    cargarAvance(proyectoId, Number(selectSprint.value) || null),
  ]);
}

/**
 * Mostrar un aviso general y ocultar las secciones (sin proyecto o sin permiso).
 *
 * @param {string} texto Mensaje para la persona usuaria.
 * @returns {void}
 */
function mostrarAvisoGeneral(texto) {
  avisoError.textContent = texto;
  avisoError.hidden = false;
  document.getElementById('seccion-velocity').hidden = true;
  document.getElementById('seccion-avance').hidden = true;
}

/**
 * Iniciar la página: montar el layout, resolver el proyecto y registrar los eventos.
 *
 * @returns {Promise<void>}
 */
async function iniciar() {
  await montarLayout();

  let proyectoId;
  try {
    // Con ?proyecto= se usa ese; sin él se pregunta al servidor cuáles proyectos tiene el usuario
    proyectoId = proyectoDeLaUrl() || await elegirProyecto();
  } catch (error) {
    mostrarAvisoGeneral(mensajeDeError(error));
    return;
  }
  if (!proyectoId) {
    mostrarAvisoGeneral('No perteneces a ningún proyecto todavía. Pide a tu Scrum Master que te agregue a uno.');
    return;
  }
  recordarProyecto(proyectoId);

  // Si la URL trajo el proyecto, el selector aún no se llenó: llenarlo para poder cambiar de proyecto
  if (selectProyecto.options.length === 0) {
    try { await elegirProyecto(); selectProyecto.value = String(proyectoId); } catch { /* el selector es opcional */ }
  }

  // Cambiar de proyecto recarga todas las secciones
  selectProyecto.addEventListener('change', () => {
    proyectoId = Number(selectProyecto.value);
    recordarProyecto(proyectoId);
    selectSprint.value = '';
    cargarTodo(proyectoId);
  });

  // Cambiar el sprint del filtro recalcula solo el avance
  selectSprint.addEventListener('change', () => cargarAvance(proyectoId, Number(selectSprint.value) || null));

  // Reintentar solo la sección que falló
  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-reintentar]');
    if (!boton) return;
    if (boton.dataset.reintentar === 'velocity') cargarVelocity(proyectoId);
    if (boton.dataset.reintentar === 'avance') cargarAvance(proyectoId, Number(selectSprint.value) || null);
  });

  await cargarTodo(proyectoId);
}

iniciar();