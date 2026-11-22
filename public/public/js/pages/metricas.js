/**
 * @file metricas.js
 * @description Orquestador de la vista de métricas. Controla los selectores y 
 * decide si muestra la Gráfica Velocity o el Burndown.
 * Carga la velocity (HU-30), el avance (HU-31) y la distribución (HU-32).
 * 
 * @author Dana Carmona Santamaria
 * @author Citlaly Morales Viveros
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';
import { dibujarVelocity } from './metricas/velocity.js';
import { dibujarAvance } from './metricas/avance.js';
import { dibujarBurndown } from './metricas/burndown.js';
import { dibujarBurnup } from './metricas/burnup.js';
import { dibujarCfd } from './metricas/cfd.js';
import { cargarPermisos } from '../core/permisos-ui.js';
import { dibujarDistribucion } from './metricas/distribucion.js';
import { procesarExportacionFront } from './metricas/exportar.js';
import { iniciarUmbral } from './metricas/umbral.js';
import { iniciarDesviacion } from './metricas/desviacion.js';
import { dibujarFlujo, dibujarAvisoNoAplica } from './metricas/flujo.js';

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
      <option value="burnup">Burnup</option>
      <option value="cfd">Flujo acumulado (CFD)</option>
      <option value="flujo">Tiempos de flujo (Lead y Cycle Time)</option>
    </select>`;
    headerAcciones.prepend(selectorTipo);
  }

  // Luego inyectamos "Integrante" (al hacer prepend, queda a la izquierda de "Vista")
  if (!document.getElementById('filtro-integrante-principal')) {
    const selectorInt = document.createElement('label');
    selectorInt.className = 'metricas__filtro';
    selectorInt.innerHTML = `Integrante principal <select id="filtro-integrante-principal" class="metricas__selector">
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

/** HU-26: modo de trabajo del proyecto ('scrum' o 'continuo') y periodo elegido para los tiempos de flujo. */
let modoFlujo = 'scrum';
let diasFlujo = 30;

/** HU-26: métricas que dependen de los sprints y no aplican en flujo continuo. */
const METRICAS_DE_SPRINT = { velocity: 'Velocity', burndown: 'Burndown', burnup: 'Burnup' };

/**
 * HU-26: leer el modo de trabajo del proyecto. Si falla, se asume Scrum (comportamiento de siempre).
 * @param {number} proyectoId - ID del proyecto activo.
 * @returns {Promise<string>} 'scrum' o 'continuo'.
 */
async function leerModoFlujo(proyectoId) {
  try {
    const respuesta = await api(`/proyectos/${proyectoId}`);
    return respuesta?.proyecto?.modo_flujo === 'continuo' ? 'continuo' : 'scrum';
  } catch {
    return 'scrum';
  }
}

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
  if (hash === '#burnup') {
    if (selectTipo) selectTipo.value = 'burnup';
    document.getElementById('seccion-velocity')?.scrollIntoView();
  }
  if (hash === '#cfd') {
    if (selectTipo) selectTipo.value = 'cfd';
    document.getElementById('seccion-velocity')?.scrollIntoView();
  }
  if (hash === '#flujo') {
    if (selectTipo) selectTipo.value = 'flujo';
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
 * Consultar al backend y renderizar la gráfica principal elegida (Velocity, Burndown,
 * Burnup o CFD). El filtro de integrante solo aplica a Velocity y Burndown; Burnup y CFD
 * son del proyecto completo y lo ignoran.
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

  const TITULOS = {
    velocity: ['Velocity por sprint', 'Puntos de historias comprometidos frente a puntos aceptados en cada sprint cerrado'],
    burndown: ['Burndown chart', 'Seguimiento de las horas restantes de trabajo en cada sprint comparadas con la proyección ideal'],
    burnup: ['Burnup chart', 'Alcance total del proyecto frente al trabajo completado, en horas'],
    cfd: ['Diagrama de flujo acumulado', 'Tarjetas en cada columna del tablero, día a día'],
    flujo: ['Tiempos de flujo', 'Lead Time y Cycle Time de las tarjetas terminadas'],
  };
  const [textoTitulo, textoSubtitulo] = TITULOS[tipo] || TITULOS.velocity;

  if (titulo) {
    titulo.textContent = textoTitulo;
  }
  if (subtitulo && subtitulo.classList.contains('subtitulo-pagina')) {
    subtitulo.textContent = textoSubtitulo;
  }

  // HU-26: en flujo continuo, Velocity, Burndown y Burnup no aplican; se avisa en lugar de dibujar una gráfica vacía
  if (modoFlujo === 'continuo' && METRICAS_DE_SPRINT[tipo]) {
    dibujarAvisoNoAplica(contVelocity, METRICAS_DE_SPRINT[tipo], () => {
      if (selectTipo) selectTipo.value = 'flujo';
      cargarGraficaPrincipal(proyectoId);
    });
    return;
  }

  mostrarCarga(contVelocity);
  try {
    const query = integranteId ? `?usuarioId=${integranteId}` : '';
    if (tipo === 'flujo') {
      // HU-26: Lead Time y Cycle Time con filtro de periodo (últimos 30 días por defecto)
      const respuesta = await api(`/flujo-continuo/proyectos/${proyectoId}/tiempos?dias=${diasFlujo}`);
      dibujarFlujo(contVelocity, respuesta.datos, {
        alCambiarDias: (dias) => { diasFlujo = dias; cargarGraficaPrincipal(proyectoId); },
      });
    } else if (tipo === 'velocity') {
      dibujarVelocity(contVelocity, await api(`/metricas/proyectos/${proyectoId}/velocity${query}`));
    } else if (tipo === 'burndown') {
      dibujarBurndown(contVelocity, await api(`/metricas/proyectos/${proyectoId}/burndown${query}`));
    } else if (tipo === 'burnup') {
      dibujarBurnup(contVelocity, await api(`/burnup/proyectos/${proyectoId}/burnup`));
    } else {
      dibujarCfd(contVelocity, await api(`/burnup/proyectos/${proyectoId}/cfd`));
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

/** HU-28: rol que puede ver la desviación de horas (el servidor lo exige igual, ROLES_PERMITIDOS en desviacion.service.js). */
const ROL_DESVIACION = 'scrum_master';

/** HU-28: componente de desviación montado, o null. */
let desviacion = null;

/**
 * HU-28: mostrar la desviación de horas solo al Scrum Master y montarla una sola vez.
 * Se vuelve a evaluar cada vez que cambian los permisos (evento "permisos:actualizados" de permisos-ui.js).
 * @param {number} proyectoId - ID del proyecto activo.
 * @param {string|null} rol - Rol vigente de la persona en el proyecto.
 * @returns {void}
 */
function actualizarDesviacion(proyectoId, rol) {
  const seccion = document.getElementById('seccion-desviacion');
  const contenedor = document.getElementById('desviacion-contenido');
  if (!seccion || !contenedor) return;
  const permitido = rol === ROL_DESVIACION;
  seccion.hidden = !permitido;
  if (permitido && !desviacion) {
    desviacion = iniciarDesviacion({ contenedor, proyectoId });
  } else if (!permitido && desviacion) {
    desviacion.destruir();
    desviacion = null;
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
  
  // HU-28: la desviación depende del rol; se escucha antes de pedir los permisos para no perder el aviso
  window.addEventListener('permisos:actualizados', (evento) => {
    if (evento.detail?.proyectoId === proyectoId) actualizarDesviacion(proyectoId, evento.detail.rol);
  });

  // Refrescar qué botones mostrar según los permisos del usuario para este proyecto
  cargarPermisos(proyectoId).catch(() => { /* Silenciar error si aún no hay backend de permisos conectado */ });
  manejarTabUrl();

  const selectTipo = document.getElementById('filtro-tipo-grafica');

  // HU-26: en flujo continuo la vista inicial es "Tiempos de flujo" (salvo que la URL pida otra)
  modoFlujo = await leerModoFlujo(proyectoId);
  if (modoFlujo === 'continuo' && selectTipo && !window.location.hash) selectTipo.value = 'flujo';
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