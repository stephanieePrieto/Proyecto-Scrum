/**
 * @file avance-curso.js
 * @description Control de la interfaz para supervisar el avance global de los integrantes del equipo.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { montarBarraSuperior } from '../core/layout.js';

let datosIntegrantes = [];
let proyectoId = null;

async function inicializar() {
  montarBarraSuperior();
  proyectoId = window.proyectoActual?.id || 1;

  const autorizado = await verificarPermisos();
  if (autorizado) {
    await cargarDatosAvance();
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
      <div class="acceso-denegado">
        <i class="fas fa-lock"></i>
        <h2>Acceso Denegado</h2>
        <p>Solo el Scrum Master o Product Owner pueden ver el avance del equipo.</p>
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

    actualizarResumen();
    actualizarListaIntegrantes();
    configurarEventos();
  } catch (error) {
    console.error('[avance-curso] Error:', error);
  }
}

function actualizarResumen() {
  const total = datosIntegrantes.length;
  const completado = datosIntegrantes.filter(i =>
    Number(i.lecciones_completadas) === Number(i.total_lecciones) &&
    Number(i.quizzes_aprobados) === Number(i.total_lecciones)
  ).length;

  const enProgreso = datosIntegrantes.filter(i =>
    (Number(i.lecciones_completadas) > 0 || Number(i.quizzes_aprobados) > 0)
  ).length - completado;

  const noIniciado = total - completado - enProgreso;

  const promedio = total > 0
    ? Math.round(datosIntegrantes.reduce((sum, i) => {
        const totalLec = Number(i.total_lecciones) || 1;
        const porcentaje = Math.round(
          ((Number(i.lecciones_completadas) + Number(i.quizzes_aprobados)) / (totalLec * 2)) * 100
        );
        return sum + porcentaje;
      }, 0) / total)
    : 0;

  const contenido = document.getElementById('contenido-principal');
  if (!contenido) return;

  contenido.innerHTML = `
    <div class="resumen-avance">
      <h2><i class="fas fa-chart-bar"></i> Resumen del Equipo</h2>
      <div class="resumen-grid">
        <div class="resumen-item">
          <span class="resumen-label">Total de integrantes</span>
          <span class="resumen-valor">${total}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Curso completado</span>
          <span class="resumen-valor">${completado}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">En progreso</span>
          <span class="resumen-valor">${enProgreso}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">No iniciado</span>
          <span class="resumen-valor">${noIniciado}</span>
        </div>
        <div class="resumen-item">
          <span class="resumen-label">Promedio de avance</span>
          <span class="resumen-valor">${promedio}%</span>
        </div>
      </div>
    </div>

    <!-- Barra de Filtros estilizada -->
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

function actualizarListaIntegrantes(filtroRol = 'todos', filtroEstado = 'todos') {
  const lista = document.getElementById('lista-integrantes');
  if (!lista) return;

  let datosFiltrados = [...datosIntegrantes];

  if (filtroRol !== 'todos') {
    datosFiltrados = datosFiltrados.filter(i => i.rol === filtroRol);
  }

  if (filtroEstado !== 'todos') {
    datosFiltrados = datosFiltrados.filter(i => {
      const tot = Number(i.total_lecciones) || 4;
      const comp = Number(i.lecciones_completadas) === tot && Number(i.quizzes_aprobados) === tot;
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
      <div class="aviso avisos--info">
        <i class="fas fa-info-circle"></i>
        No hay integrantes que coincidan con los filtros seleccionados.
      </div>
    `;
    return;
  }

  lista.innerHTML = datosFiltrados.map(integrante => {
    const totalLecciones = Number(integrante.total_lecciones) || 4;
    const leccionesCompletadas = Number(integrante.lecciones_completadas) || 0;
    const quizzesAprobados = Number(integrante.quizzes_aprobados) || 0;
    const tieneCertificado = integrante.tiene_certificado || false;
    const porcentaje = Math.round(((leccionesCompletadas + quizzesAprobados) / (totalLecciones * 2)) * 100);

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
                <i class="fas fa-trophy"></i>
              </span>
            ` : `
              <span class="sin-certificado">Sin certificado</span>
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
  if (filtroRol) {
    filtroRol.addEventListener('change', () => {
      const filtroEstado = document.getElementById('filtro-estado')?.value || 'todos';
      actualizarListaIntegrantes(filtroRol.value, filtroEstado);
    });
  }

  const filtroEstado = document.getElementById('filtro-estado');
  if (filtroEstado) {
    filtroEstado.addEventListener('change', () => {
      const filtroRol = document.getElementById('filtro-rol')?.value || 'todos';
      actualizarListaIntegrantes(filtroRol, filtroEstado.value);
    });
  }

  const btnActualizar = document.getElementById('btn-actualizar-avance');
  if (btnActualizar) {
    btnActualizar.addEventListener('click', async () => {
      await cargarDatosAvance();
    });
  }
}

document.addEventListener('DOMContentLoaded', inicializar);