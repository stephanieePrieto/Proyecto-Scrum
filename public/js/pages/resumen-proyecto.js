/**
 * @file resumen-proyecto.js
 * @description Lógica para la vista de resumen de proyecto (HU-35).
 * Se encarga de descargar la información básica, visión y Definition of Done (DoD) del proyecto actual.
 * @author Dana
 */

import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml } from '../core/utils.js';

/**
 * Carga el layout y consulta la API del proyecto activo para rellenar los datos.
 */
async function iniciar() {
  await montarBarraSuperior();
  const id = new URLSearchParams(window.location.search).get('proyecto') || localStorage.getItem('proyectoActivo');
  
  if (!id) {
    document.getElementById('rp-titulo').textContent = 'Proyecto no encontrado';
    return;
  }

  try {
    const { proyecto } = await api(`/proyectos/${id}`);
    document.getElementById('rp-titulo').textContent = escaparHtml(proyecto.nombre);
    document.getElementById('rp-fechas').textContent = `Inició: ${proyecto.fecha_inicio} - Cierre planeado: ${proyecto.fecha_fin}`;
    document.getElementById('rp-vision').textContent = escaparHtml(proyecto.vision);
    document.getElementById('rp-dod').textContent = escaparHtml(proyecto.definition_of_done);
  } catch(error) {
    document.getElementById('rp-titulo').textContent = 'Error al cargar';
  }
}

iniciar();