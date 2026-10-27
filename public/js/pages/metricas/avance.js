/**
 * @file avance.js
 * @description Dibujar el porcentaje de avance por persona y por equipo.
 * El porcentaje se calcula en el servidor con las horas estimadas de las tareas en "Hecho"
 * entre las horas estimadas asignadas; aquí solo se presenta.
 * @author Dana
 */

import { escaparHtml, pluralizar } from '../../core/utils.js';

// Umbrales (en %) que deciden el color de la barra para identificar rezagos de un vistazo
const UMBRAL_EXITO = 70;        // desde aquí: verde
const UMBRAL_ADVERTENCIA = 40;  // desde aquí: ámbar; por debajo: rojo

// Traducir el rol del proyecto a una etiqueta legible
const ETIQUETA_ROL = {
  scrum_master: 'Scrum Master',
  product_owner: 'Product Owner',
  developer: 'Developer',
};

/**
 * Elegir el tono de la barra según el porcentaje.
 *
 * @param {number} porcentaje Valor de 0 a 100.
 * @returns {'exito'|'advertencia'|'peligro'}
 */
function tonoPorPorcentaje(porcentaje) {
  if (porcentaje >= UMBRAL_EXITO) return 'exito';
  if (porcentaje >= UMBRAL_ADVERTENCIA) return 'advertencia';
  return 'peligro';
}

/**
 * Construir el texto del porcentaje o el motivo por el cual no existe.
 * "Sin tareas" no es un error: es un estado válido (HU-31).
 *
 * @param {Object} fila Persona o equipo devuelto por el servidor.
 * @returns {string} HTML del valor.
 */
function textoPorcentaje(fila) {
  if (fila.estado === 'sin_tareas') return '<span class="avance__porcentaje avance__porcentaje--vacio">Sin tareas</span>';
  if (fila.estado === 'sin_estimar') return '<span class="avance__porcentaje avance__porcentaje--vacio">Sin horas estimadas</span>';
  return `<span class="avance__porcentaje">${fila.porcentaje} %</span>`;
}

/**
 * Construir la barra de progreso. El ancho NO se escribe en el HTML (sin estilos en línea):
 * se guarda en data-valor y lo aplica aplicarAnchos() después de insertar el HTML.
 *
 * @param {Object} fila Persona o equipo devuelto por el servidor.
 * @param {string} nombre Nombre accesible de la barra.
 * @returns {string} HTML de la barra, o cadena vacía si no hay porcentaje.
 */
function barra(fila, nombre) {
  if (fila.porcentaje === null) return '';
  return `<div class="progreso" role="progressbar" aria-label="Avance de ${escaparHtml(nombre)}"
       aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fila.porcentaje}">
      <div class="progreso__barra progreso__barra--${tonoPorPorcentaje(fila.porcentaje)}" data-valor="${fila.porcentaje}"></div>
    </div>`;
}

/**
 * Construir la línea de detalle ("8 h de 10 h · 4 tareas").
 *
 * @param {Object} fila Persona o equipo devuelto por el servidor.
 * @returns {string} Texto del detalle (vacío si no hay tareas).
 */
function detalle(fila) {
  if (fila.tareas === 0) return '';
  return `${fila.horasHechas} h de ${fila.horasAsignadas} h · ${fila.tareas} ${pluralizar(fila.tareas, 'tarea', 'tareas')}`;
}

/**
 * Asignar el ancho de cada barra desde su data-valor.
 * Se hace con JavaScript (CSSOM) y no con style="..." para respetar la política de seguridad de contenido.
 *
 * @param {HTMLElement} contenedor Elemento que contiene las barras.
 * @returns {void}
 */
function aplicarAnchos(contenedor) {
  contenedor.querySelectorAll('[data-valor]').forEach((el) => {
    const valor = Math.max(0, Math.min(100, Number(el.dataset.valor)));
    el.style.width = `${valor}%`;
  });
}

/**
 * Dibujar el avance por equipo y por persona dentro del contenedor.
 * Avisar cuando hay tareas sin horas estimadas (no se cuentan) o sin responsable.
 * Conservar y marcar a las personas dadas de baja que tienen tareas.
 *
 * @param {HTMLElement} contenedor Elemento donde se inserta el resultado.
 * @param {Object} datos Respuesta de GET /api/metricas/proyectos/:id/avance.
 * @returns {void}
 */
export function dibujarAvance(contenedor, datos) {
  const { equipo, personas } = datos;

  // Avisos: las tareas sin estimar y sin responsable no entran al porcentaje
  const avisos = [];
  if (equipo.tareasSinEstimar > 0) {
    avisos.push(`${equipo.tareasSinEstimar} ${pluralizar(equipo.tareasSinEstimar, 'tarea sin horas estimadas no se cuenta', 'tareas sin horas estimadas no se cuentan')} en el cálculo.`);
  }
  if (datos.tareasSinResponsable > 0) {
    avisos.push(`${datos.tareasSinResponsable} ${pluralizar(datos.tareasSinResponsable, 'tarea no tiene responsable y no aparece', 'tareas no tienen responsable y no aparecen')} en el avance por persona.`);
  }
  const htmlAvisos = avisos.map((texto) => `<p class="alerta alerta--info" role="status">${texto}</p>`).join('');

  const filas = personas.map((p) => `<li class="avance__fila${p.baja ? ' avance__fila--baja' : ''}">
      <div class="avance__encabezado">
        <span class="avance__nombre">${escaparHtml(p.nombre)}
          ${p.rol ? `<span class="insignia insignia--primario">${ETIQUETA_ROL[p.rol] || escaparHtml(p.rol)}</span>` : ''}
          ${p.baja ? '<span class="insignia insignia--advertencia">Baja</span>' : ''}
        </span>
        ${textoPorcentaje(p)}
      </div>
      ${barra(p, p.nombre)}
      <span class="avance__detalle">${detalle(p)}${p.tareasSinEstimar > 0 ? ` · ${p.tareasSinEstimar} sin estimar` : ''}</span>
    </li>`).join('');

  contenedor.innerHTML = `
    ${htmlAvisos}
    <div class="avance__equipo">
      <div class="avance__encabezado">
        <span class="avance__nombre">${escaparHtml(equipo.nombre || 'Equipo')}</span>
        ${textoPorcentaje(equipo)}
      </div>
      ${barra(equipo, equipo.nombre || 'equipo')}
      <span class="avance__detalle">${detalle(equipo)}</span>
    </div>
    <ul class="avance__lista">${filas}</ul>`;

  aplicarAnchos(contenedor);
}