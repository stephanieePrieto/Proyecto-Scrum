/**
 * @file burndown.js
 * @description Dibujar la gráfica de Burndown chart (HU-29).
 * Compara las horas/puntos restantes del sprint contra una línea ideal matemática, 
 * remarcando eventos como cambios de alcance a mitad de sprint.
 * Ahora incluye títulos de ejes y valores en cada punto para mayor legibilidad.
 * @author Dana
 */

import { escaparHtml } from '../../core/utils.js';

/**
 * Dibuja la gráfica de Burndown en el contenedor SVG.
 * 
 * @param {HTMLElement} contenedor El elemento que contendrá el SVG del burndown.
 * @param {Object} datos El objeto con los snapshots y la info del sprint devuelto por la API.
 */
export function dibujarBurndown(contenedor, datos) {
  if (datos.vacio) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">
      <h3 class="aviso__titulo">Aún no hay un sprint activo</h3>
      <p class="aviso__texto">El burndown requiere un sprint en curso con capacidad de horas definidas.</p>
    </div>`;
    return;
  }

  const { sprint, snapshots } = datos;
  if (!snapshots.length) {
     contenedor.innerHTML = `<p class="alerta alerta--info">El sprint acaba de iniciar. El burndown se generará cuando existan snapshots diarios.</p>`;
     return;
  }

  // --- Dimensiones y Márgenes del SVG ---
  const ANCHO_SVG = 800;
  const ALTO_SVG = 400;
  const MARGEN_IZQUIERDO = 70;
  const MARGEN_DERECHO = 40;
  const MARGEN_SUPERIOR = 40;
  const MARGEN_INFERIOR = 60;
  
  const ANCHO_GRAFICA = ANCHO_SVG - MARGEN_IZQUIERDO - MARGEN_DERECHO;
  const ALTO_GRAFICA = ALTO_SVG - MARGEN_SUPERIOR - MARGEN_INFERIOR;

  // --- Datos Base ---
  const maxHoras = sprint.capacidadHoras;
  const numPuntos = snapshots.length;
  
  // Ajuste para evitar división por cero si solo hay 1 snapshot (día 1)
  const divisionesX = Math.max(1, numPuntos - 1); 
  const espacioX = ANCHO_GRAFICA / divisionesX;

  // Función para mapear valor de horas a coordenada Y
  const escalarY = (valorHoras) => {
    // Si el valor es mayor a maxHoras (ej: se agregaron más tareas), lo topeamos visualmente al inicio
    const valorSeguro = Math.max(0, Math.min(maxHoras, valorHoras));
    // La Y crece hacia abajo en SVG. Por eso restamos desde el alto de la gráfica.
    return MARGEN_SUPERIOR + (ALTO_GRAFICA - (valorSeguro / maxHoras) * ALTO_GRAFICA);
  };

  // --- Cálculos de Puntos ---
  let etiquetasX = '';
  let etiquetasYIdeal = '';
  let etiquetasYReal = '';

  const puntosGraficos = snapshots.map((s, i) => {
     const x = MARGEN_IZQUIERDO + (i * espacioX);
     const yReal = escalarY(s.horas_restantes);
     
     // La línea ideal va de maxHoras a 0 en una línea recta diagonal.
     const valorIdeal = maxHoras - (i * (maxHoras / divisionesX));
     const yIdeal = escalarY(valorIdeal);

     // Etiqueta del eje X (Sprint/Día)
     etiquetasX += `<text x="${x}" y="${ALTO_SVG - MARGEN_INFERIOR + 20}" text-anchor="middle" font-size="12" fill="#555">Día ${i+1}</text>`;
     
     // Etiqueta del valor numérico - Línea Real (arriba del punto)
     etiquetasYReal += `<text x="${x}" y="${yReal - 12}" text-anchor="middle" font-size="11" font-weight="bold" fill="var(--primario)">${s.horas_restantes}</text>`;
     
     // Etiqueta del valor numérico - Línea Ideal (debajo de la línea, en gris)
     // Mostramos solo un decimal si no es entero
     const textoIdeal = valorIdeal % 1 === 0 ? valorIdeal : valorIdeal.toFixed(1);
     etiquetasYIdeal += `<text x="${x}" y="${yIdeal + 16}" text-anchor="middle" font-size="11" fill="#888">${textoIdeal}</text>`;

     return { 
       x: x, 
       yR: yReal, 
       yI: yIdeal, 
       modificacion: s.alcance_modificado 
     };
  });

  const lineaReal = puntosGraficos.map(p => `${p.x},${p.yR}`).join(' ');
  const lineaIdeal = puntosGraficos.map(p => `${p.x},${p.yI}`).join(' ');

  // Marcadores de puntos (círculos) para la línea real
  let puntosRealesSVG = '';
  let notificacionesModificados = '';
  puntosGraficos.forEach(p => {
    // Círculo base para el dato real
    puntosRealesSVG += `<circle cx="${p.x}" cy="${p.yR}" r="4" fill="var(--primario)" />`;
    
    // Si hubo cambio de alcance, se resalta con otro color y un borde
    if (p.modificacion) {
       notificacionesModificados += `<circle cx="${p.x}" cy="${p.yR}" r="7" fill="var(--ambar-500)" stroke="#fff" stroke-width="2"><title>Alcance modificado en este día</title></circle>`;
    }
  });

  // --- Ejes de Coordenadas ---
  // Línea vertical izquierda (Eje Y)
  const ejeY = `<line x1="${MARGEN_IZQUIERDO}" y1="${MARGEN_SUPERIOR}" x2="${MARGEN_IZQUIERDO}" y2="${ALTO_SVG - MARGEN_INFERIOR}" stroke="#ccc" stroke-width="1"/>`;
  // Línea horizontal inferior (Eje X)
  const ejeX = `<line x1="${MARGEN_IZQUIERDO}" y1="${ALTO_SVG - MARGEN_INFERIOR}" x2="${ANCHO_SVG - MARGEN_DERECHO}" y2="${ALTO_SVG - MARGEN_INFERIOR}" stroke="#ccc" stroke-width="1"/>`;

  // --- Títulos de los Ejes ---
  // Título del Eje X (Abajo, centrado)
  const tituloEjeX = `<text x="${MARGEN_IZQUIERDO + (ANCHO_GRAFICA / 2)}" y="${ALTO_SVG - 15}" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">Días del Sprint</text>`;
  
  // Título del Eje Y (Izquierda, rotado)
  const centroY = MARGEN_SUPERIOR + (ALTO_GRAFICA / 2);
  const tituloEjeY = `<text x="-${centroY}" y="25" transform="rotate(-90)" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">Horas Restantes</text>`;

  // --- Renderizado Final ---
  contenedor.innerHTML = `
    <div class="grafica__leyenda">
      <span class="leyenda__item"><span style="width:18px;height:4px;background:var(--primario);display:inline-block; vertical-align: middle;"></span> Horas restantes (Real)</span>
      <span class="leyenda__item"><span style="width:18px;height:4px;background:#aaa;display:inline-block; border-top: 2px dashed; vertical-align: middle;"></span> Línea Ideal</span>
    </div>
    
    <svg viewBox="0 0 ${ANCHO_SVG} ${ALTO_SVG}" width="100%" height="auto" style="max-width: 700px; display: block; margin: 0 auto; overflow: visible;">
       <!-- Ejes y Títulos -->
       ${ejeX}
       ${ejeY}
       ${tituloEjeX}
       ${tituloEjeY}

       <!-- Etiquetas de texto -->
       ${etiquetasX}
       ${etiquetasYIdeal}
       
       <!-- Líneas de datos -->
       <polyline points="${lineaIdeal}" stroke="#aaa" stroke-width="2" stroke-dasharray="6,4" fill="none"/>
       <polyline points="${lineaReal}" stroke="var(--primario)" stroke-width="3" fill="none"/>
       
       <!-- Puntos numéricos sobre la línea real -->
       ${puntosRealesSVG}
       ${etiquetasYReal}
       
       <!-- Resaltado de cambios de alcance -->
       ${notificacionesModificados}
    </svg>
  `;
}