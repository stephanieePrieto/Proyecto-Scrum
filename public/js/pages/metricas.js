/**
 * @file metricas.js
 * @description Orquestador de la vista de métricas. Controla los selectores y 
 * decide si muestra la Gráfica Velocity o el Burndown.
 * Carga la velocity (HU-30), el avance (HU-31) y la distribución (HU-32).
 * @author Dana Carmona Santamaria
 * @author Citlaly Morales Viveros
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';
import { dibujarVelocity } from './metricas/velocity.js';
import { dibujarAvance } from './metricas/avance.js';
import { dibujarBurndown } from './metricas/burndown.js';
import { cargarPermisos } from '../core/permisos-ui.js';
import { dibujarDistribucion } from './metricas/distribucion.js';
import { procesarExportacionFront } from './metricas/exportar.js';
import { iniciarUmbral } from './metricas/umbral.js';

const contVelocity = document.getElementById('velocity-contenido');
const contAvance = document.getElementById('avance-contenido');
const selectSprint = document.getElementById('filtro-sprint');
const contDistribucion = document.getElementById('distribucion-contenido');

// 1. Inyección de filtros en la cabecera general (Vista e Integrante Principal)
const headerAcciones = document.querySelector('.encabezado-pagina__acciones');
if (headerAcciones) {
  // Primero inyectamos "Vista" (al inyectar el siguiente, este quedará a la derecha)
  if (!document.getElementById('filtro-tipo-grafica')) {
    const selectorTipo = document.createElement('label');
    selectorTipo.className = 'metricas__filtro';
    selectorTipo.innerHTML = `Vista <select id="filtro-tipo-grafica" class="metricas__selector">
      <option value="velocity" selected>Velocity</option>
      <option value="burndown">Burndown</option>
    </select>`;
    headerAcciones.prepend(selectorTipo);
  }
  
  // Luego inyectamos "Integrante" (al hacer prepend, queda a la izquierda de "Vista")
  if (!document.getElementById('filtro-integrante-principal')) {
    const selectorInt = document.createElement('label');
    selectorInt.className = 'metricas__filtro';
    selectorInt.innerHTML = `Integrante <select id="filtro-integrante-principal" class="metricas__selector">
      <option value="">Todo el equipo</option>
    </select>`;
    headerAcciones.prepend(selectorInt);
  }
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

/**
 * Leer el proyecto elegido en el Dashboard (localStorage 'proyectoActivo').
 * @returns {number|null} ID del proyecto, o null si no se eligió ninguno.
 */
function proyectoActivo() {
  let guardado = null;
  try { guardado = Number(window.localStorage.getItem(CLAVE_PROYECTO)); } catch { }
  return Number.isInteger(guardado) && guardado > 0 ? guardado : null;
}

/**
 * Manejar el ancla (hash) de la URL para hacer scroll automático 
 * y preseleccionar la pestaña/vista correcta (ej. #burndown o #avance).
 * @returns {void}
 */
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

/**
 * Importar dinámicamente y montar la barra de navegación superior.
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
 * Traducir un error HTTP en un mensaje legible para el usuario.
 * @param {ErrorApp} error - Objeto de error capturado.
 * @returns {string} Mensaje traducido.
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
 * Mostrar una alerta de error dentro del contenedor de la gráfica que falló,
 * permitiendo reintentar la solicitud específica.
 * @param {HTMLElement} contenedor - Elemento DOM de la sección.
 * @param {ErrorApp} error - El error que causó el fallo.
 * @param {string} clave - ID identificador del botón reintentar ('grafica', 'avance', 'distribucion').
 * @returns {void}
 */
function mostrarErrorSeccion(contenedor, error, clave) {
  if (!contenedor) return;
  contenedor.innerHTML = `<div class="alerta alerta--error metricas__error" role="alert">
      <span>${escaparHtml(mensajeDeError(error))}</span>
      <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar="${clave}">Reintentar</button>
    </div>`;
}

/**
 * Pintar un esqueleto animado mientras se espera la respuesta del servidor.
 * @param {HTMLElement} contenedor - Contenedor a limpiar y cargar.
 * @returns {void}
 */
function mostrarCarga(contenedor) {
  if (!contenedor) return;
  contenedor.setAttribute('aria-busy', 'true');
  contenedor.innerHTML = '<span class="esqueleto metricas__esqueleto"></span>';
}

/**
 * Consultar al backend y renderizar la gráfica principal elegida (Velocity o Burndown).
 * Aplica automáticamente el filtro del integrante seleccionado.
 * @param {number} proyectoId - ID del proyecto activo.
 * @returns {Promise<void>}
 */
async function cargarGraficaPrincipal(proyectoId) {
  const selectTipo = document.getElementById('filtro-tipo-grafica');
  const selectInt = document.getElementById('filtro-integrante-principal'); 
  const tipo = selectTipo ? selectTipo.value : 'velocity';
  const integranteId = selectInt ? selectInt.value : '';

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
    const query = integranteId ? `?usuarioId=${integranteId}` : '';
    if (tipo === 'velocity') {
      dibujarVelocity(contVelocity, await api(`/metricas/proyectos/${proyectoId}/velocity${query}`));
    } else {
      dibujarBurndown(contVelocity, await api(`/metricas/proyectos/${proyectoId}/burndown${query}`));
    }
  } catch (error) {
    mostrarErrorSeccion(contVelocity, error, 'grafica');
  } finally {
    contVelocity?.removeAttribute('aria-busy');
  }
}

/**
 * Rellenar el `<select>` de Sprints para poder filtrar el avance.
 * @param {Array<Object>} sprints - Arreglo de sprints devuelto por la API.
 * @param {number|null} elegido - ID del sprint actualmente seleccionado.
 * @returns {void}
 */
function llenarSelectorSprints(sprints, elegido) {
  if (!selectSprint) return;
  selectSprint.innerHTML = '<option value="">Todo el proyecto</option>' + sprints
    .map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)} (${escaparHtml(s.estado)})</option>`).join('');
  selectSprint.value = elegido ? String(elegido) : '';
}

/**
 * Cargar y renderizar la barra de Avance por equipo o integrante individual (HU-31).
 * Esta función también lee la lista de miembros filtrada por permisos y puebla los selectores de integrantes.
 * @param {number} proyectoId - ID del proyecto activo.
 * @param {number|null} sprintId - ID opcional del sprint a filtrar.
 * @returns {Promise<void>}
 */
async function cargarAvance(proyectoId, sprintId = null) {
  mostrarCarga(contAvance);
  try {
    const consulta = sprintId ? `?sprintId=${sprintId}` : '';
    datosAvanceActual = await api(`/metricas/proyectos/${proyectoId}/avance${consulta}`);
    const seccionExportar = document.getElementById('seccion-exportar');
    if (seccionExportar) seccionExportar.hidden = !datosAvanceActual.esScrumMaster;

    llenarSelectorSprints(datosAvanceActual.sprints, datosAvanceActual.sprintId);

    // Poblar el filtro de integrantes (Avance) basado en los permisos aplicados en el backend
    const selectIntAvance = document.getElementById('filtro-integrante-avance');
    if (selectIntAvance) {
      const valActual = selectIntAvance.value;
      const opcionesIntegrantes = datosAvanceActual.personas.map(p =>
        `<option value="${p.usuarioId}">${escaparHtml(p.nombre)}</option>`
      ).join('');

      selectIntAvance.innerHTML = '<option value="equipo">Todo el equipo</option>' + opcionesIntegrantes;

      // Mantener el usuario si sigue en la lista, sino volver a "equipo"
      const existe = valActual === 'equipo' || datosAvanceActual.personas.some(p => String(p.usuarioId) === valActual);
      selectIntAvance.value = existe ? valActual : 'equipo';

      dibujarAvance(contAvance, datosAvanceActual, selectIntAvance.value);
    } else {
      dibujarAvance(contAvance, datosAvanceActual, 'equipo');
    }

    // Poblar el filtro principal superior (Velocity/Burndown) basado en los mismos permisos
    const selectIntPrincipal = document.getElementById('filtro-integrante-principal');
    if (selectIntPrincipal) {
      const valActualPrin = selectIntPrincipal.value;
      const opcionesPrin = datosAvanceActual.personas.map(p => 
        `<option value="${p.usuarioId}">${escaparHtml(p.nombre)}</option>`
      ).join('');
      
      selectIntPrincipal.innerHTML = '<option value="">Todo el equipo</option>' + opcionesPrin;
      
      const existePrin = valActualPrin === '' || datosAvanceActual.personas.some(p => String(p.usuarioId) === valActualPrin);
      selectIntPrincipal.value = existePrin ? valActualPrin : '';
    }

  } catch (error) {
    mostrarErrorSeccion(contAvance, error, 'avance');
  } finally {
    contAvance?.removeAttribute('aria-busy');
  }
}

/**
 * Cargar y renderizar la gráfica de dona interactiva con el tiempo invertido (HU-32).
 * @param {number} proyectoId - ID del proyecto activo.
 * @returns {Promise<void>}
 */
async function cargarDistribucion(proyectoId) {
  mostrarCarga(contDistribucion);
  try {
    const datos = await api(`/metricas/proyectos/${proyectoId}/distribucion`);
    dibujarDistribucion(contDistribucion, datos);
  } catch (error) {
    mostrarErrorSeccion(contDistribucion, error, 'distribucion');
  } finally {
    contDistribucion?.removeAttribute('aria-busy');
  }
}

/**
 * Ejecutar todas las llamadas de red para dibujar las métricas simultáneamente.
 * @param {number} proyectoId - ID del proyecto.
 * @returns {Promise<Array>} Promesas resueltas sin importar si alguna falla de forma aislada.
 */
function cargarTodo(proyectoId) {
  iniciarUmbral(proyectoId);
  return Promise.allSettled([
    cargarGraficaPrincipal(proyectoId),
    cargarAvance(proyectoId, Number(selectSprint?.value) || null),
    cargarDistribucion(proyectoId)
  ]);
}

/**
 * Sin proyecto activo: oculta toda la página (por CSS) y muestra el aviso "Selecciona un proyecto",
 * igual que en curso-scrum.
 * @returns {void}
 */
function mostrarAvisoSeleccionarProyecto() {
  document.querySelector('main.principal')?.classList.add('metricas--sin-proyecto');
  const aviso = document.getElementById('aviso-proyecto');
  if (aviso) aviso.hidden = false;
}

/**
 * Función principal de arranque. 
 * Resuelve el proyecto de la URL o el último usado, valida permisos y enlaza eventos de selectores.
 * @returns {Promise<void>}
 */
async function iniciar() {
  await montarLayout();
  // El proyecto se elige únicamente en el Dashboard; aquí solo se lee el proyecto activo
  const proyectoId = proyectoActivo();
  if (!proyectoId) return mostrarAvisoSeleccionarProyecto();
  
  // Refrescar qué botones mostrar según los permisos del usuario para este proyecto
  cargarPermisos(proyectoId).catch(() => { /* Silenciar error si aún no hay backend de permisos conectado */ });
  manejarTabUrl();

  const selectTipo = document.getElementById('filtro-tipo-grafica');
  selectTipo?.addEventListener('change', () => cargarGraficaPrincipal(proyectoId));
  
  const selectIntPrincipal = document.getElementById('filtro-integrante-principal');
  selectIntPrincipal?.addEventListener('change', () => cargarGraficaPrincipal(proyectoId));

  // Al cambiar sprint, consultamos al backend
  selectSprint?.addEventListener('change', () => cargarAvance(proyectoId, Number(selectSprint.value) || null));

  // Al cambiar integrante de avance, redibujamos localmente (sin request)
  const selectIntAvance = document.getElementById('filtro-integrante-avance');
  selectIntAvance?.addEventListener('change', () => {
    if (datosAvanceActual) dibujarAvance(contAvance, datosAvanceActual, selectIntAvance.value);
  });

  // Reintentar cargar sección si alguna falla
  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-reintentar]');
    if (!boton) return;
    if (boton.dataset.reintentar === 'grafica') cargarGraficaPrincipal(proyectoId);
    if (boton.dataset.reintentar === 'avance') cargarAvance(proyectoId, Number(selectSprint?.value) || null);
    if (boton.dataset.reintentar === 'distribucion') cargarDistribucion(proyectoId);
  });

  const btnExportar = document.getElementById('btn-exportar');
  if (btnExportar) {
    btnExportar.addEventListener('click', async () => {
      // Importamos exportar.js dinámicamente al hacer clic para optimizar la carga
      const moduloExportar = await import('./metricas/exportar.js');
      
      const formato = document.getElementById('exportar-formato').value;
      const contProgreso = document.getElementById('exportar-progreso-contenedor');
      const avisoExp = document.getElementById('exportar-error');
      const alcance = document.getElementById('exportar-alcance').value;
      moduloExportar.procesarExportacionFront(proyectoId, formato, alcance, btnExportar, contProgreso, avisoExp);
    });
  }

  await cargarTodo(proyectoId);
}

iniciar();