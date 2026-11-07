/**
 * @file resumen-proyecto.js
 * @description Lógica para la vista de resumen de proyecto (HU-35).
 * Se encarga de descargar la información básica, visión y Definition of Done (DoD) del proyecto actual,
 * además de configurar el enlace dinámico para la Capacitación Scrum.
 * @author Dana Carmona Santamaria
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml } from '../core/utils.js';
import { cargarPermisos } from '../core/permisos-ui.js';

/**
 * Carga el layout y consulta la API del proyecto activo para rellenar los datos.
 */
async function iniciar() {
  await montarBarraSuperior();
  const id = new URLSearchParams(window.location.search).get('proyecto') || localStorage.getItem('proyectoActivo');

  if (!id) {
    document.getElementById('rp-titulo').textContent = 'Proyecto no encontrado';
    const btnCapacitacion = document.getElementById('btn-capacitacion-scrum');
    if (btnCapacitacion) btnCapacitacion.style.display = 'none';
    return;
  }

  // Configurar el enlace del botón de Capacitación Scrum dinámicamente con el ID del proyecto
  const btnCapacitacion = document.getElementById('btn-capacitacion-scrum');
  if (btnCapacitacion) {
    btnCapacitacion.href = `/pages/curso-scrum.html?proyecto_id=${id}`;
  }

  // Permisos del proyecto que se está viendo
  cargarPermisos(Number(id)).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });

  try {
    const { proyecto } = await api(`/proyectos/${id}`);
    document.getElementById('rp-titulo').textContent = escaparHtml(proyecto.nombre);
    document.getElementById('rp-fechas').textContent = `Inició: ${proyecto.fecha_inicio} - Cierre planeado: ${proyecto.fecha_fin}`;
    document.getElementById('rp-vision').textContent = escaparHtml(proyecto.vision);
    document.getElementById('rp-dod').textContent = escaparHtml(proyecto.definition_of_done);
  } catch (error) {
    document.getElementById('rp-titulo').textContent = 'Error al cargar';
  }
}

iniciar();