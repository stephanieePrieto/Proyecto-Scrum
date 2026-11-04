/**
 * @file metricas.js
 * @description Orquestador de la vista de métricas. Controla los selectores y 
 * decide si muestra la Gráfica Velocity o el Burndown.
 * Carga la velocity (HU-30) y el avance (HU-31).
 * @author Dana
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';
import { dibujarVelocity } from './metricas/velocity.js';
import { dibujarAvance } from './metricas/avance.js';
import { dibujarBurndown } from './metricas/burndown.js';

const contVelocity = document.getElementById('velocity-contenido');
const contAvance = document.getElementById('avance-contenido');
const selectSprint = document.getElementById('filtro-sprint');
const selectProyecto = document.getElementById('filtro-proyecto');
const cajaProyecto = document.getElementById('selector-proyecto');
const avisoError = document.getElementById('metricas-error');

// 1. Inyección del filtro de Tipo de Gráfica en la cabecera general (con validación de existencia)
const headerAcciones = document.querySelector('.encabezado-pagina__acciones');
if (headerAcciones && !document.getElementById('filtro-tipo-grafica')) {
  const selectorTipo = document.createElement('label');
  selectorTipo.className = 'metricas__filtro';
  selectorTipo.innerHTML = `Vista <select id="filtro-tipo-grafica" class="metricas__selector">
    <option value="velocity" selected>Velocity</option>
    <option value="burndown">Burndown</option>
  </select>`;
  headerAcciones.prepend(selectorTipo);
}

// 2. Inyección del filtro de Integrante junto al filtro de Sprint (Sección Avance con validación)
let selectIntegranteAvance = document.getElementById('filtro-integrante-avance');
if (selectSprint && !selectIntegranteAvance) {
  const contenedorFiltrosAvance = selectSprint.closest('.metricas__cabecera') || selectSprint.parentElement?.parentElement;
  if (contenedorFiltrosAvance) {
    const labelIntegrante = document.createElement('label');
    labelIntegrante.className = 'metricas__filtro';
    labelIntegrante.style.marginLeft = '16px';
    labelIntegrante.innerHTML = `Integrante <select id="filtro-integrante-avance" class="metricas__selector">
      <option value="equipo">Todo el equipo</option>
    </select>`;
    contenedorFiltrosAvance.appendChild(labelIntegrante);
    selectIntegranteAvance = document.getElementById('filtro-integrante-avance');
  }
}

const CLAVE_PROYECTO = 'proyectoActivo';
let datosAvanceActual = null;

function proyectoDeLaUrl() {
  const id = Number(new URLSearchParams(window.location.search).get('proyecto'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function recordarProyecto(proyectoId) {
  const url = new URL(window.location.href);
  url.searchParams.set('proyecto', proyectoId);
  window.history.replaceState(null, '', url);
  try { window.localStorage.setItem(CLAVE_PROYECTO, String(proyectoId)); } catch { }
}

function manejarTabUrl() {
  const hash = window.location.hash;
  const selectTipo = document.getElementById('filtro-tipo-grafica');
  if (hash === '#burndown') {
    if (selectTipo) selectTipo.value = 'burndown';
    document.getElementById('seccion-velocity')?.scrollIntoView();
  }
  if (hash === '#avance') {
    document.getElementById('seccion-avance')?.scrollIntoView();
  }
}

async function elegirProyecto() {
  const proyectos = await api('/metricas/mis-proyectos');
  if (proyectos.length === 0) return null;

  if (selectProyecto) {
    selectProyecto.innerHTML = proyectos.map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('');
  }
  if (cajaProyecto) {
    cajaProyecto.hidden = proyectos.length < 2;
  }

  let recordado = null;
  try { recordado = Number(window.localStorage.getItem(CLAVE_PROYECTO)); } catch { }
  const elegido = proyectos.find((p) => p.id === (proyectoDeLaUrl() || recordado)) || proyectos[0];
  if (selectProyecto) selectProyecto.value = String(elegido.id);
  return elegido.id;
}

async function montarLayout() {
  try {
    const layout = await import('../core/layout.js');
    await layout.montarBarraSuperior();
  } catch (error) {
    console.warn('[metricas] No se pudo montar la barra superior:', error.message);
  }
}

function mensajeDeError(error) {
  if (error.estado === 401) {
    window.location.href = '/pages/login.html';
    return 'Tu sesión terminó. Inicia sesión de nuevo.';
  }
  if (error.estado === 403) return 'No tienes acceso a las métricas de este proyecto.';
  return error.cuerpo?.mensaje || 'No se pudo cargar esta sección.';
}

function mostrarErrorSeccion(contenedor, error, clave) {
  if (!contenedor) return;
  contenedor.innerHTML = `<div class="alerta alerta--error metricas__error" role="alert">
      <span>${escaparHtml(mensajeDeError(error))}</span>
      <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar="${clave}">Reintentar</button>
    </div>`;
}

function mostrarCarga(contenedor) {
  if (!contenedor) return;
  contenedor.setAttribute('aria-busy', 'true');
  contenedor.innerHTML = '<span class="esqueleto metricas__esqueleto"></span>';
}

async function cargarGraficaPrincipal(proyectoId) {
  const selectTipo = document.getElementById('filtro-tipo-grafica');
  const tipo = selectTipo ? selectTipo.value : 'velocity';

  const titulo = document.getElementById('velocity-titulo');
  const subtitulo = titulo?.nextElementSibling;

  if (titulo) {
    titulo.textContent = tipo === 'velocity' ? 'Velocity por sprint' : 'Burndown chart';
  }
  if (subtitulo && subtitulo.classList.contains('subtitulo-pagina')) {
    subtitulo.textContent = tipo === 'velocity'
      ? 'Puntos de historias comprometidos frente a puntos aceptados en cada sprint cerrado'
      : 'Seguimiento de las horas restantes de trabajo en cada sprint comparadas con la proyección ideal';
  }

  mostrarCarga(contVelocity);
  try {
    if (tipo === 'velocity') {
      dibujarVelocity(contVelocity, await api(`/metricas/proyectos/${proyectoId}/velocity`));
    } else {
      dibujarBurndown(contVelocity, await api(`/metricas/proyectos/${proyectoId}/burndown`));
    }
  } catch (error) {
    mostrarErrorSeccion(contVelocity, error, 'grafica');
  } finally {
    contVelocity?.removeAttribute('aria-busy');
  }
}

function llenarSelectorSprints(sprints, elegido) {
  if (!selectSprint) return;
  selectSprint.innerHTML = '<option value="">Todo el proyecto</option>' + sprints
    .map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)} (${escaparHtml(s.estado)})</option>`).join('');
  selectSprint.value = elegido ? String(elegido) : '';
}

async function cargarAvance(proyectoId, sprintId = null) {
  mostrarCarga(contAvance);
  try {
    const consulta = sprintId ? `?sprintId=${sprintId}` : '';
    datosAvanceActual = await api(`/metricas/proyectos/${proyectoId}/avance${consulta}`);
    
    llenarSelectorSprints(datosAvanceActual.sprints, datosAvanceActual.sprintId);

    // Poblar el filtro de integrantes basado en los permisos aplicados en el backend
    const selectInt = document.getElementById('filtro-integrante-avance');
    if (selectInt) {
      const valActual = selectInt.value;
      const opcionesIntegrantes = datosAvanceActual.personas.map(p => 
        `<option value="${p.usuarioId}">${escaparHtml(p.nombre)}</option>`
      ).join('');
      
      selectInt.innerHTML = '<option value="equipo">Todo el equipo</option>' + opcionesIntegrantes;
      
      // Si el usuario previo existe en la nueva lista, mantenerlo; si no, volver a "equipo"
      const existe = valActual === 'equipo' || datosAvanceActual.personas.some(p => String(p.usuarioId) === valActual);
      selectInt.value = existe ? valActual : 'equipo';
      
      dibujarAvance(contAvance, datosAvanceActual, selectInt.value);
    } else {
      dibujarAvance(contAvance, datosAvanceActual, 'equipo');
    }
  } catch (error) {
    mostrarErrorSeccion(contAvance, error, 'avance');
  } finally {
    contAvance?.removeAttribute('aria-busy');
  }
}

function cargarTodo(proyectoId) {
  return Promise.allSettled([
    cargarGraficaPrincipal(proyectoId),
    cargarAvance(proyectoId, Number(selectSprint?.value) || null),
  ]);
}

function mostrarAvisoGeneral(texto) {
  if (avisoError) {
    avisoError.textContent = texto;
    avisoError.hidden = false;
  }
  const secVelocity = document.getElementById('seccion-velocity');
  const secAvance = document.getElementById('seccion-avance');
  if (secVelocity) secVelocity.hidden = true;
  if (secAvance) secAvance.hidden = true;
}

async function iniciar() {
  await montarLayout();
  let proyectoId;
  
  try {
    proyectoId = proyectoDeLaUrl() || await elegirProyecto();
  } catch (error) {
    return mostrarAvisoGeneral(mensajeDeError(error));
  }
  
  if (!proyectoId) return mostrarAvisoGeneral('No perteneces a ningún proyecto todavía.');
  
  recordarProyecto(proyectoId);
  manejarTabUrl();

  if (selectProyecto && selectProyecto.options.length === 0) {
    try { await elegirProyecto(); selectProyecto.value = String(proyectoId); } catch { }
  }

  selectProyecto?.addEventListener('change', () => {
    proyectoId = Number(selectProyecto.value);
    recordarProyecto(proyectoId);
    if (selectSprint) selectSprint.value = '';
    cargarTodo(proyectoId);
  });

  const selectTipo = document.getElementById('filtro-tipo-grafica');
  selectTipo?.addEventListener('change', () => cargarGraficaPrincipal(proyectoId));
  
  // Al cambiar sprint, consultamos al backend
  selectSprint?.addEventListener('change', () => cargarAvance(proyectoId, Number(selectSprint.value) || null));
  
  // Al cambiar integrante, redibujamos localmente (sin request)
  const selectInt = document.getElementById('filtro-integrante-avance');
  selectInt?.addEventListener('change', () => {
    if (datosAvanceActual) dibujarAvance(contAvance, datosAvanceActual, selectInt.value);
  });

  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-reintentar]');
    if (!boton) return;
    if (boton.dataset.reintentar === 'grafica') cargarGraficaPrincipal(proyectoId);
    if (boton.dataset.reintentar === 'avance') cargarAvance(proyectoId, Number(selectSprint?.value) || null);
  });

  await cargarTodo(proyectoId);
}

iniciar();