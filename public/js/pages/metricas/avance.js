/**
 * @file avance.js
 * @description Dibuja el porcentaje de avance mediante una gráfica de pastel (SVG)
 * y un resumen detallado a su izquierda. Muestra la información del equipo o 
 * de un integrante específico, con colores semánticos según el porcentaje.
 * @author Dana
 */

import { escaparHtml, pluralizar } from '../../core/utils.js';

const UMBRAL_EXITO = 70;        // desde aquí: verde
const UMBRAL_ADVERTENCIA = 40;  // desde aquí: ámbar; por debajo: rojo

const ETIQUETA_ROL = {
  scrum_master: 'Scrum Master',
  product_owner: 'Product Owner',
  developer: 'Developer',
};

/**
 * Retorna el valor HEX del color según el porcentaje.
 * Se utilizan valores quemados para asegurar que el SVG los tome correctamente.
 */
function colorPorPorcentaje(porcentaje) {
  if (porcentaje === null) return '#e2e8f0'; 
  if (porcentaje >= UMBRAL_EXITO) return '#10b981';
  if (porcentaje >= UMBRAL_ADVERTENCIA) return '#f59e0b'; 
  return '#ef4444'; 
}

/**
 * Genera el SVG del círculo (gráfica de pastel/dona).
 */
function dibujarPastel(porcentaje) {
  const dash = porcentaje === null ? 0 : porcentaje;
  const colorHex = colorPorPorcentaje(porcentaje);
  
  return `
    <svg viewBox="0 0 36 36" width="180" height="180" style="display:block; margin: 0 auto; overflow:visible;">
      <!-- Círculo fondo -->
      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#e2e8f0" stroke-width="4"></circle>
      <!-- Círculo progreso con color dinámico -->
      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="${colorHex}" stroke-width="4"
              stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="25"
              stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease-out;"></circle>
      <!-- Texto central -->
      <text x="18" y="20.5" text-anchor="middle" font-size="8" font-weight="600" fill="var(--texto-principal)">
        ${porcentaje === null ? 'N/A' : dash + '%'}
      </text>
    </svg>
  `;
}

/**
 * Dibuja el avance por equipo o por persona seleccionada dentro del contenedor.
 *
 * @param {HTMLElement} contenedor Elemento donde se inserta el resultado.
 * @param {Object} datos Respuesta completa del backend.
 * @param {string} seleccionadoId Id del usuario seleccionado, o 'equipo'.
 * @returns {void}
 */
export function dibujarAvance(contenedor, datos, seleccionadoId = 'equipo') {
  // 1. Determinar qué información mostrar (Equipo o Persona)
  let entidad;
  if (seleccionadoId === 'equipo') {
    entidad = datos.equipo;
  } else {
    entidad = datos.personas.find(p => String(p.usuarioId) === seleccionadoId) || datos.equipo;
  }

  // 2. Alertas generales
  let htmlAvisos = '';
  if (seleccionadoId === 'equipo') {
    const avisos = [];
    if (datos.equipo.tareasSinEstimar > 0) {
      avisos.push(`${datos.equipo.tareasSinEstimar} ${pluralizar(datos.equipo.tareasSinEstimar, 'tarea sin horas estimadas no se cuenta', 'tareas sin horas estimadas no se cuentan')} en el cálculo global.`);
    }
    if (datos.tareasSinResponsable > 0) {
      avisos.push(`${datos.tareasSinResponsable} ${pluralizar(datos.tareasSinResponsable, 'tarea no tiene', 'tareas no tienen')} responsable asignado.`);
    }
    htmlAvisos = avisos.map((texto) => `<p class="alerta alerta--info" role="status" style="margin-bottom: 16px;">${texto}</p>`).join('');
  } else if (entidad.tareasSinEstimar > 0) {
    htmlAvisos = `<p class="alerta alerta--info" role="status" style="margin-bottom: 16px;">Tienes ${entidad.tareasSinEstimar} ${pluralizar(entidad.tareasSinEstimar, 'tarea', 'tareas')} sin estimar que no suman a tu porcentaje.</p>`;
  }

  // 3. Renderizar el diseño de 2 columnas (Resumen + Gráfica)
  const titulo = entidad.nombre || 'Avance del Equipo';
  const subtitulo = entidad.rol ? ETIQUETA_ROL[entidad.rol] : 'Consolidado del proyecto';
  
  contenedor.innerHTML = `
    ${htmlAvisos}
    <div class="tarjeta" style="display:flex; flex-wrap:wrap; align-items:center; gap:32px; padding: 32px;">
      
      <!-- Lado Izquierdo: Resumen -->
      <div style="flex: 1; min-width: 240px;">
        <h3 style="font-size: 20px; margin: 0 0 4px 0; color: var(--texto-principal);">${escaparHtml(titulo)}</h3>
        <p style="margin: 0 0 24px 0; color: var(--texto-suave);">${subtitulo}</p>
        
        <ul style="list-style: none; padding: 0; margin: 0; line-height: 2;">
          <li><span style="display:inline-block; width:160px; color:var(--texto-suave);">Horas completadas:</span> 
              <strong style="font-size:16px;">${entidad.horasHechas} h</strong></li>
          <li><span style="display:inline-block; width:160px; color:var(--texto-suave);">Horas estimadas:</span> 
              <strong style="font-size:16px;">${entidad.horasAsignadas} h</strong></li>
          <li><span style="display:inline-block; width:160px; color:var(--texto-suave);">Tareas asignadas:</span> 
              <strong style="font-size:16px;">${entidad.tareas}</strong></li>
          ${entidad.estado === 'sin_tareas' ? `<li><strong style="color:var(--ambar-600);">Sin tareas asignadas</strong></li>` : ''}
        </ul>
      </div>

      <!-- Lado Derecho: Gráfica de Pastel -->
      <div style="flex: 0 0 200px; display:flex; justify-content:center; align-items:center;">
        ${dibujarPastel(entidad.porcentaje)}
      </div>
      
    </div>
  `;
}