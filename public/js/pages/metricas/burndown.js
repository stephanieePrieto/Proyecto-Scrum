/**
 * @file burndown.js
 * @description Dibujar la gráfica de Burndown del proyecto por cierre de sprint (HU-29).
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
      <h3 class="aviso__titulo">Aún no hay datos de burndown</h3>
      <p class="aviso__texto">El burndown requiere que el proyecto tenga sprints registrados.</p>
    </div>`;
    return;
  }

  let puntos = [];

  if (datos.sprints && datos.sprints.length > 0) {
    puntos = datos.sprints;
  } else if (datos.snapshots && datos.snapshots.length > 0) {
    const inicio = datos.sprint?.capacidadHoras || datos.snapshots[0].horas_restantes || 90;
    puntos = [
      { nombre: 'Inicio', horasRestantes: inicio },
      ...datos.snapshots.map((s, i) => ({
        nombre: `Sprint ${i + 1}`,
        horasRestantes: s.horas_restantes,
      }))
    ];
  }

  if (!puntos.length) {
    contenedor.innerHTML = `<p class="alerta alerta--info">No hay datos suficientes para generar el burndown.</p>`;
    return;
  }

  const ANCHO_SVG = 800;
  const ALTO_SVG = 420;
  const MARGEN = { izq: 70, der: 40, arriba: 50, abajo: 80 };

  const ANCHO_GRAFICA = ANCHO_SVG - MARGEN.izq - MARGEN.der;
  const ALTO_GRAFICA = ALTO_SVG - MARGEN.arriba - MARGEN.abajo;

  const horasIniciales = datos.horasIniciales || puntos[0]?.horasRestantes || 100;
  const maxRestantes = Math.max(...puntos.map(p => p.horasRestantes ?? 0), horasIniciales, 10);
  
  const pasoY = maxRestantes <= 100 ? 20 : 50;
  const maxEscala = Math.max(pasoY, Math.ceil(maxRestantes / pasoY) * pasoY);

  const totalSlots = Math.max(6, puntos.length - 1);
  const espacioX = ANCHO_GRAFICA / totalSlots;

  const yPos = (valor) => MARGEN.arriba + ALTO_GRAFICA - (valor / maxEscala) * ALTO_GRAFICA;
  const xPos = (i) => MARGEN.izq + i * espacioX;

  let rejillaY = '';
  for (let v = 0; v <= maxEscala; v += pasoY) {
    const y = yPos(v);
    rejillaY += `<line x1="${MARGEN.izq}" x2="${ANCHO_SVG - MARGEN.der}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
      <text x="${MARGEN.izq - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#64748b">${v}</text>`;
  }

  const puntosIdeal = [];
  let textosIdeal = '';

  for (let i = 0; i <= totalSlots; i++) {
    const x = xPos(i);
    const valIdeal = Math.max(0, horasIniciales - i * (horasIniciales / totalSlots));
    const y = yPos(valIdeal);
    puntosIdeal.push(`${x},${y}`);

    const txt = valIdeal % 1 === 0 ? valIdeal.toFixed(0) : valIdeal.toFixed(1);
    textosIdeal += `<text x="${x}" y="${y + 18}" text-anchor="middle" font-size="11" fill="#64748b">${txt}</text>`;
  }

  const puntosReal = [];
  let circulosReal = '';
  let textosReal = '';
  let etiquetasX = '';

  for (let i = 0; i <= totalSlots; i++) {
    const x = xPos(i);
    const p = puntos[i];
    const nombreLabel = p ? p.nombre : `Sprint ${i}`;
    
    etiquetasX += `<line x1="${x}" x2="${x}" y1="${yPos(0)}" y2="${yPos(0) + 6}" stroke="#94a3b8" stroke-width="1.5" />
      <text x="${x}" y="${yPos(0) + 24}" text-anchor="middle" font-size="12" fill="#334155">${escaparHtml(nombreLabel)}</text>`;

    if (p && p.horasRestantes !== null && p.horasRestantes !== undefined) {
      const valReal = Number(p.horasRestantes);
      const y = yPos(valReal);
      puntosReal.push(`${x},${y}`);

      const txtReal = valReal % 1 === 0 ? valReal.toFixed(0) : valReal.toFixed(1);
      
      circulosReal += `<circle cx="${x}" cy="${y}" r="5" fill="#1F5A67" stroke="#ffffff" stroke-width="2">
        <title>${escaparHtml(nombreLabel)}: ${txtReal} h restantes</title>
      </circle>`;

      textosReal += `<text x="${x}" y="${y - 10}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1F5A67">${txtReal}</text>`;
    }
  }

  const ejeY = `<line x1="${MARGEN.izq}" y1="${MARGEN.arriba}" x2="${MARGEN.izq}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;
  const ejeX = `<line x1="${MARGEN.izq}" y1="${yPos(0)}" x2="${ANCHO_SVG - MARGEN.der}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;

  const centroY = MARGEN.arriba + (ALTO_GRAFICA / 2);
  const tituloEjeY = `<text x="-${centroY}" y="22" transform="rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Horas restantes</text>`;
  const tituloEjeX = `<text x="${MARGEN.izq + (ANCHO_GRAFICA / 2)}" y="${ALTO_SVG - 16}" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Cierre de sprint</text>`;

  contenedor.innerHTML = `
    <div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">Burndown chart</h2>
        <p class="subtitulo-pagina">Seguimiento de las horas restantes de trabajo en cada sprint comparadas con la proyección ideal</p>
      </div>
    </div>

    <svg viewBox="0 0 ${ANCHO_SVG} ${ALTO_SVG}" width="100%" height="auto" style="max-width: 750px; display: block; margin: 0 auto; overflow: visible;">
      ${rejillaY}
      ${ejeX}
      ${ejeY}
      ${tituloEjeX}
      ${tituloEjeY}
      ${etiquetasX}

      <polyline points="${puntosIdeal.join(' ')}" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="8,6" fill="none" />
      ${textosIdeal}

      ${puntosReal.length > 1 ? `<polyline points="${puntosReal.join(' ')}" stroke="#1F5A67" stroke-width="3.5" fill="none" stroke-linejoin="round" />` : ''}
      ${circulosReal}
      ${textosReal}
    </svg>

    <div style="display: flex; justify-content: center; align-items: center; gap: 32px; margin-top: 16px; font-size: 13px; color: #334155;">
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 0; border-top: 3px dashed #94a3b8; display: inline-block;"></span>
        Línea ideal (h)
      </span>
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 12px; display: inline-flex; align-items: center; justify-content: center; position: relative;">
          <span style="width: 24px; height: 3.5px; background: #1F5A67; position: absolute;"></span>
          <span style="width: 8px; height: 8px; background: #1F5A67; border-radius: 50%; z-index: 1;"></span>
        </span>
        Real restante (h)
      </span>
    </div>
  `;
}