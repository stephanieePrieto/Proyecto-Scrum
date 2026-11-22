/**
 * @file burnup.js
 * @description Dibujar la gráfica de Burnup del proyecto: alcance total frente a trabajo
 * completado (en horas), con un punto por sprint cerrado y el punto actual.
 *
 * @author Dana Carmona Santamaria
 */

import { escaparHtml } from '../../core/utils.js';

/**
 * Dibuja la gráfica de Burnup en el contenedor SVG.
 *
 * @param {HTMLElement} contenedor El elemento que contendrá el SVG del burnup.
 * @param {Object} datos El objeto devuelto por GET /api/burnup/proyectos/:proyectoId/burnup.
 */
export function dibujarBurnup(contenedor, datos) {
  if (datos.vacio) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">
      <h3 class="aviso__titulo">Aún no hay datos de burnup</h3>
      <p class="aviso__texto">El burnup requiere horas estimadas en las tareas del proyecto.</p>
    </div>`;
    return;
  }

  const puntos = datos.puntos || [];
  if (puntos.length < 2) {
    contenedor.innerHTML = `<p class="alerta alerta--info">No hay datos suficientes para generar el burnup.</p>`;
    return;
  }

  const ANCHO_SVG = 800;
  const ALTO_SVG = 420;
  const MARGEN = { izq: 70, der: 40, arriba: 50, abajo: 80 };

  const ANCHO_GRAFICA = ANCHO_SVG - MARGEN.izq - MARGEN.der;
  const ALTO_GRAFICA = ALTO_SVG - MARGEN.arriba - MARGEN.abajo;

  const alcance = datos.alcanceTotal || Math.max(...puntos.map((p) => p.alcance ?? 0), 10);
  const maxValor = Math.max(alcance, ...puntos.map((p) => p.completado ?? 0), 10);

  const pasoY = maxValor <= 100 ? 20 : 50;
  const maxEscala = Math.max(pasoY, Math.ceil(maxValor / pasoY) * pasoY);

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

  // Línea de alcance total (constante en la serie; se dibuja hasta donde llega la serie)
  const puntosAlcance = [];
  let etiquetasX = '';
  let circulosAlcance = '';
  let textosAlcance = '';
  let circulosReal = '';
  let textosReal = '';
  const puntosReal = [];

  for (let i = 0; i < puntos.length; i++) {
    const x = xPos(i);
    const p = puntos[i];
    const nombreLabel = p.nombre || `Punto ${i + 1}`;

    etiquetasX += `<line x1="${x}" x2="${x}" y1="${yPos(0)}" y2="${yPos(0) + 6}" stroke="#94a3b8" stroke-width="1.5" />
      <text x="${x}" y="${yPos(0) + 24}" text-anchor="middle" font-size="12" fill="#334155">${escaparHtml(nombreLabel)}</text>`;

    const yAlcance = yPos(p.alcance ?? alcance);
    puntosAlcance.push(`${x},${yAlcance}`);
    const txtAlcance = (p.alcance ?? alcance) % 1 === 0 ? (p.alcance ?? alcance).toFixed(0) : (p.alcance ?? alcance).toFixed(1);
    circulosAlcance += `<circle cx="${x}" cy="${yAlcance}" r="4" fill="#94a3b8" stroke="#ffffff" stroke-width="2">
      <title>${escaparHtml(nombreLabel)}: alcance ${txtAlcance} h</title>
    </circle>`;
    textosAlcance += `<text x="${x}" y="${yAlcance - 10}" text-anchor="middle" font-size="11" fill="#64748b">${txtAlcance}</text>`;

    if (p.completado !== null && p.completado !== undefined) {
      const valReal = Number(p.completado);
      const y = yPos(valReal);
      puntosReal.push(`${x},${y}`);
      const txtReal = valReal % 1 === 0 ? valReal.toFixed(0) : valReal.toFixed(1);
      circulosReal += `<circle cx="${x}" cy="${y}" r="5" fill="#1F5A67" stroke="#ffffff" stroke-width="2">
        <title>${escaparHtml(nombreLabel)}: ${txtReal} h completadas</title>
      </circle>`;
      textosReal += `<text x="${x}" y="${y - 10}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1F5A67">${txtReal}</text>`;
    }
  }

  const ejeY = `<line x1="${MARGEN.izq}" y1="${MARGEN.arriba}" x2="${MARGEN.izq}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;
  const ejeX = `<line x1="${MARGEN.izq}" y1="${yPos(0)}" x2="${ANCHO_SVG - MARGEN.der}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;

  const centroY = MARGEN.arriba + (ALTO_GRAFICA / 2);
  const tituloEjeY = `<text x="-${centroY}" y="22" transform="rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Horas</text>`;
  const tituloEjeX = `<text x="${MARGEN.izq + (ANCHO_GRAFICA / 2)}" y="${ALTO_SVG - 16}" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Cierre de sprint</text>`;

  contenedor.innerHTML = `
    <div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">Burnup chart</h2>
        <p class="subtitulo-pagina">Alcance total del proyecto frente al trabajo completado, en horas. El alcance incluye el backlog, así que su punto de inicio no coincide con el del Burndown.</p>
      </div>
    </div>

    <svg viewBox="0 0 ${ANCHO_SVG} ${ALTO_SVG}" width="100%" height="auto" style="max-width: 750px; display: block; margin: 0 auto; overflow: visible;">
      ${rejillaY}
      ${ejeX}
      ${ejeY}
      ${tituloEjeX}
      ${tituloEjeY}
      ${etiquetasX}

      <polyline points="${puntosAlcance.join(' ')}" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="8,6" fill="none" />
      ${circulosAlcance}
      ${textosAlcance}

      ${puntosReal.length > 1 ? `<polyline points="${puntosReal.join(' ')}" stroke="#1F5A67" stroke-width="3.5" fill="none" stroke-linejoin="round" />` : ''}
      ${circulosReal}
      ${textosReal}
    </svg>

    <div style="display: flex; justify-content: center; align-items: center; gap: 32px; margin-top: 16px; font-size: 13px; color: #334155;">
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 0; border-top: 3px dashed #94a3b8; display: inline-block;"></span>
        Alcance total (h)
      </span>
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 12px; display: inline-flex; align-items: center; justify-content: center; position: relative;">
          <span style="width: 24px; height: 3.5px; background: #1F5A67; position: absolute;"></span>
          <span style="width: 8px; height: 8px; background: #1F5A67; border-radius: 50%; z-index: 1;"></span>
        </span>
        Completado (h)
      </span>
    </div>
  `;
}
