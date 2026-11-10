/**
 * @file avance-curso.js
 * @description Control de la interfaz para supervisar el avance global de los integrantes del equipo.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { montarBarraSuperior } from '../core/layout.js';

let datosIntegrantes = [];
let proyectoId = null;
let interfazConstruida = false;

async function inicializar() {
  montarBarraSuperior();
  
  const proyectoGuardado = localStorage.getItem('proyectoActivo');
  if (!proyectoGuardado || proyectoGuardado === 'null' || proyectoGuardado === 'undefined') {
    mostrarAvisoSeleccionarProyecto();
    return;
  }

  proyectoId = parseInt(proyectoGuardado, 10);

  const autorizado = await verificarPermisos();
  if (autorizado) {
    await cargarDatosAvance();
  }
}

function mostrarAvisoSeleccionarProyecto() {
  const contenido = document.getElementById('contenido-principal');
  if (contenido) {
    contenido.innerHTML = `
      <div class="acceso-denegado" style="text-align: center; padding: 40px; background: var(--blanco, #fff); border-radius: 12px; box-shadow: var(--sombra-sm, 0 1px 3px rgba(0,0,0,0.1));">
        <i class="fas fa-folder-open" style="font-size: 3rem; color: var(--ambar-500, #d97706); margin-bottom: 15px;"></i>
        <h2 style="color: var(--primario, #1e293b); margin-bottom: 10px;">Selecciona un proyecto</h2>
        <p style="color: var(--texto-suave, #64748b); margin-bottom: 20px;">Debes seleccionar un proyecto activo en el Dashboard para consultar el avance del equipo.</p>
        <a class="boton boton--primario" href="./dashboard.html">
          <i class="fas fa-arrow-left"></i> Ir al Dashboard
        </a>
      </div>
    `;
  }
}

async function verificarPermisos() {
  try {
    const respuesta = await fetch(`/api/curso-scrum/${proyectoId}`);
    if (!respuesta.ok) throw new Error('No autorizado');

    const datos = await respuesta.json();
    const rolEnProyecto = datos.rolEnProyecto;

    if (rolEnProyecto !== 'scrum_master' && rolEnProyecto !== 'product_owner') {
      mostrarAccesoDenegado();
      return false;
    }
    return true;
  } catch (error) {
    mostrarAccesoDenegado();
    return false;
  }
}

function mostrarAccesoDenegado() {
  const contenido = document.getElementById('contenido-principal');
  if (contenido) {
    contenido.innerHTML = `
      <div class="acceso-denegado" style="text-align: center; padding: 40px; background: var(--blanco, #fff); border-radius: 12px;">
        <i class="fas fa-lock" style="font-size: 3rem; color: #ef4444; margin-bottom: 15px;"></i>
        <h2 style="color: var(--primario, #1e293b); margin-bottom: 10px;">Acceso Denegado</h2>
        <p style="color: var(--texto-suave, #64748b);">Solo el Scrum Master o Product Owner pueden ver el avance del equipo en este proyecto.</p>
      </div>
    `;
  }
}

async function cargarDatosAvance() {
  try {
    const respuesta = await fetch(`/api/curso-scrum/${proyectoId}`);
    if (!respuesta.ok) throw new Error('Error al cargar datos');

    const datos = await respuesta.json();
    datosIntegrantes = datos.progresoEquipo || [];

    // Construir la estructura general solo la primera vez para no perder eventos ni focos
    if (!interfazConstruida) {
      construirEstructuraBase();
      configurarEventos();
      interfazConstruida = true;
    }

    actualizarMetricasResumen();
    
    // Obtener los valores actuales de los selectores para mantener el filtro activo al actualizar
    const filtroRolActual = document.getElementById('filtro-rol')?.value || 'todos';
    const filtroEstadoActual = document.getElementById('filtro-estado')?.value || 'todos';
    
    actualizarListaIntegrantes(filtroRolActual, filtroEstadoActual);
  } catch (error) {
    console.error('[avance-curso] Error:', error);
  }
}

function construirEstructuraBase() {
  const contenido = document.getElementById('contenido-principal');
  if (!contenido) return;

  contenido.innerHTML = `
    <div class="resumen-avance">
      <h2><i class="fas fa-chart-bar"></i> Resumen del Equipo</h2>
      <div class="resumen-grid">
        <div class="resumen-item">
          <span class="resumen-label">Total de integrantes</span>
          <span class="resumen-valor" id="resumen-total">0</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Curso completado</span>
          <span class="resumen-valor" id="resumen-completado">0</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">En progreso</span>
          <span class="resumen-valor" id="resumen-progreso">0</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">No iniciado</span>
          <span class="resumen-valor" id="resumen-no-iniciado">0</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Promedio de avance</span>
          <span class="resumen-valor" id="resumen-promedio">0%</span>
        </div>
      </div>
    </div>

    <!-- Barra de Filtros -->
    <div class="barra-filtros">
      <select id="filtro-rol" class="select-filtro">
        <option value="todos">Todos los roles</option>
        <option value="scrum_master">Scrum Master</option>
        <option value="product_owner">Product Owner</option>
        <option value="developer">Developer</option>
      </select>
      <select id="filtro-estado" class="select-filtro">
        <option value="todos">Todos los estados</option>
        <option value="completado">Curso completado</option>
        <option value="en-progreso">En progreso</option>
        <option value="no-iniciado">No iniciado</option>
      </select>
      <button id="btn-actualizar-avance" class="btn-actualizar" type="button">
        <i class="fas fa-sync-alt"></i> Actualizar
      </button>
    </div>

    <h2><i class="fas fa-users"></i> Integrantes del Equipo</h2>
    <div id="lista-integrantes"></div>
  `;
}

function actualizarMetricasResumen() {
  const total = datosIntegrantes.length;
  
  const completado = datosIntegrantes.filter(i => {
    const totalLec = Number(i.total_lecciones) || 0;
    return totalLec > 0 &&
      Number(i.lecciones_completadas) === totalLec &&
      Number(i.quizzes_aprobados) === totalLec;
  }).length;

  const enProgreso = datosIntegrantes.filter(i => {
    const totalLec = Number(i.total_lecciones) || 0;
    const comp = totalLec > 0 && Number(i.lecciones_completadas) === totalLec && Number(i.quizzes_aprobados) === totalLec;
    const tieneAvance = Number(i.lecciones_completadas) > 0 || Number(i.quizzes_aprobados) > 0;
    return tieneAvance && !comp;
  }).length;

  const noIniciado = total - completado - enProgreso;

  const promedio = total > 0
    ? Math.round(datosIntegrantes.reduce((sum, i) => {
        const totalLec = Number(i.total_lecciones) || 1;
        const porcentaje = Math.min(100, Math.round(
          ((Number(i.lecciones_completadas) + Number(i.quizzes_aprobados)) / (totalLec * 2)) * 100
        ));
        return sum + porcentaje;
      }, 0) / total)
    : 0;

  const elTotal = document.getElementById('resumen-total');
  const elCompletado = document.getElementById('resumen-completado');
  const elProgreso = document.getElementById('resumen-progreso');
  const elNoIniciado = document.getElementById('resumen-no-iniciado');
  const elPromedio = document.getElementById('resumen-promedio');

  if (elTotal) elTotal.textContent = total;
  if (elCompletado) elCompletado.textContent = completado;
  if (elProgreso) elProgreso.textContent = enProgreso;
  if (elNoIniciado) elNoIniciado.textContent = noIniciado;
  if (elPromedio) elPromedio.textContent = `${promedio}%`;
}

function actualizarListaIntegrantes(filtroRol = 'todos', filtroEstado = 'todos') {
  const lista = document.getElementById('lista-integrantes');
  if (!lista) return;

  let datosFiltrados = [...datosIntegrantes];

  if (filtroRol !== 'todos') {
    datosFiltrados = datosFiltrados.filter(i => i.rol === filtroRol);
  }

  if (filtroEstado !== 'todos') {
    datosFiltrados = datosFiltrados.filter(i => {
      const tot = Number(i.total_lecciones) || 0;
      const comp = tot > 0 && Number(i.lecciones_completadas) === tot && Number(i.quizzes_aprobados) === tot;
      const prog = (Number(i.lecciones_completadas) > 0 || Number(i.quizzes_aprobados) > 0) && !comp;
      const noIni = Number(i.lecciones_completadas) === 0 && Number(i.quizzes_aprobados) === 0;

      if (filtroEstado === 'completado') return comp;
      if (filtroEstado === 'en-progreso') return prog;
      if (filtroEstado === 'no-iniciado') return noIni;
      return true;
    });
  }

  if (datosFiltrados.length === 0) {
    lista.innerHTML = `
      <div class="aviso avisos--info" style="margin-top: 15px;">
        <i class="fas fa-info-circle"></i>
        No hay integrantes que coincidan con los filtros seleccionados.
      </div>
    `;
    return;
  }

  lista.innerHTML = datosFiltrados.map(integrante => {
    const totalLecciones = Number(integrante.total_lecciones) || 1;
    const leccionesCompletadas = Number(integrante.lecciones_completadas) || 0;
    const quizzesAprobados = Number(integrante.quizzes_aprobados) || 0;
    const tieneCertificado = integrante.tiene_certificado || false;
    
    const porcentaje = Math.min(100, Math.round(((leccionesCompletadas + quizzesAprobados) / (totalLecciones * 2)) * 100));

    return `
      <div class="tarjeta-integrante">
        <div class="integrante-info">
          <div class="integrante-nombre">${integrante.nombre}</div>
          <div class="integrante-rol">
            <i class="fas fa-user-tag"></i> ${obtenerNombreRol(integrante.rol)}
          </div>
          <div class="integrante-correo">
            <i class="fas fa-envelope"></i> ${integrante.correo}
          </div>
        </div>
        <div class="integrante-progreso">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="barra-progreso-integrante">
              <div class="barra-progreso-relleno" style="width: ${porcentaje}%;"></div>
            </div>
            <span class="porcentaje-progreso">${porcentaje}%</span>
          </div>
          <div class="estado-certificado">
            ${tieneCertificado ? `
              <span class="certificado-icono" title="Certificado obtenido">
                <i class="fas fa-trophy" style="color: #d97706;"></i> Certificado Obtenido
              </span>
            ` : `
              <span class="sin-certificado" style="color: #64748b; font-size: 0.85rem;">Sin certificado</span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function obtenerNombreRol(rol) {
  const roles = {
    scrum_master: 'Scrum Master',
    product_owner: 'Product Owner',
    developer: 'Developer',
    admin: 'Administrador'
  };
  return roles[rol] || rol;
}

function configurarEventos() {
  const filtroRol = document.getElementById('filtro-rol');
  const filtroEstado = document.getElementById('filtro-estado');
  const btnActualizar = document.getElementById('btn-actualizar-avance');

  if (filtroRol) {
    filtroRol.addEventListener('change', () => {
      actualizarListaIntegrantes(filtroRol.value, filtroEstado?.value || 'todos');
    });
  }

  if (filtroEstado) {
    filtroEstado.addEventListener('change', () => {
      actualizarListaIntegrantes(filtroRol?.value || 'todos', filtroEstado.value);
    });
  }

  if (btnActualizar) {
    btnActualizar.addEventListener('click', async () => {
      btnActualizar.disabled = true;
      const icono = btnActualizar.querySelector('i');
      if (icono) icono.classList.add('fa-spin');

      await cargarDatosAvance();

      if (icono) icono.classList.remove('fa-spin');
      btnActualizar.disabled = false;
    });
  }
}

document.addEventListener('DOMContentLoaded', inicializar);