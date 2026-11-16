/**
 * @file cfd.js
 * @description Dibujar el Diagrama de Flujo Acumulado (CFD): tarjetas por columna y por día,
 * como áreas apiladas. Si todavía no hay suficientes cambios de columna registrados, se avisa
 * que la gráfica solo muestra la columna actual de cada tarjeta.
 *
 * @author Dana Carmona Santamaria
 */

import { escaparHtml } from '../../core/utils.js';

/** Paleta de las áreas, en el orden de las columnas (la columna final usa verde). */
const COLORES = ['#94a3b8', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6'];
const COLOR_FINAL = '#22c55e';

/**
 * Dibuja el CFD en el contenedor SVG.
 *
 * @param {HTMLElement} contenedor El elemento que contendrá el SVG del CFD.
 * @param {Object} datos El objeto devuelto por GET /api/burnup/proyectos/:proyectoId/cfd.
 */
export function dibujarCfd(contenedor, datos) {
  if (datos.vacio) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">
      <h3 class="aviso__titulo">Aún no hay datos de flujo acumulado</h3>
      <p class="aviso__texto">El CFD requiere tarjetas registradas en el proyecto.</p>
    </div>`;
    return;
  }

  const columnas = datos.columnas || [];
  const dias = datos.dias || [];
  if (!dias.length || !columnas.length) {
    contenedor.innerHTML = `<p class="alerta alerta--info">No hay datos suficientes para generar el flujo acumulado.</p>`;
    return;
  }

  const ANCHO_SVG = 800;
  const ALTO_SVG = 420;
  const MARGEN = { izq: 70, der: 40, arriba: 50, abajo: 80 };

  const ANCHO_GRAFICA = ANCHO_SVG - MARGEN.izq - MARGEN.der;
  const ALTO_GRAFICA = ALTO_SVG - MARGEN.arriba - MARGEN.abajo;

  const maxTotal = Math.max(...dias.map((d) => columnas.reduce((acc, c) => acc + Number(d.conteos[c.id] || 0), 0)), 10);
  const pasoY = maxTotal <= 10 ? 2 : maxTotal <= 50 ? 5 : 10;
  const maxEscala = Math.max(pasoY, Math.ceil(maxTotal / pasoY) * pasoY);

  const espacioX = dias.length > 1 ? ANCHO_GRAFICA / (dias.length - 1) : 0;
  const yPos = (valor) => MARGEN.arriba + ALTO_GRAFICA - (valor / maxEscala) * ALTO_GRAFICA;
  const xPos = (i) => MARGEN.izq + i * espacioX;

  let rejillaY = '';
  for (let v = 0; v <= maxEscala; v += pasoY) {
    const y = yPos(v);
    rejillaY += `<line x1="${MARGEN.izq}" x2="${ANCHO_SVG - MARGEN.der}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
      <text x="${MARGEN.izq - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#64748b">${v}</text>`;
  }

  // Etiquetas del eje X: mostrar como mucho 8 fechas para no saturar
  let etiquetasX = '';
  const salto = Math.max(1, Math.ceil(dias.length / 8));
  dias.forEach((d, i) => {
    if (i % salto !== 0 && i !== dias.length - 1) return;
    const x = xPos(i);
    etiquetasX += `<line x1="${x}" x2="${x}" y1="${yPos(0)}" y2="${yPos(0) + 6}" stroke="#94a3b8" stroke-width="1.5" />
      <text x="${x}" y="${yPos(0) + 24}" text-anchor="middle" font-size="12" fill="#334155">${escaparHtml(d.fecha.slice(5))}</text>`;
  });

  // Áreas apiladas: la primera columna es la base (abajo), la última queda arriba.
  const colores = columnas.map((c, i) => (c.esFinal ? COLOR_FINAL : COLORES[i % COLORES.length]));
  let areas = '';
  const acumulados = new Array(dias.length).fill(0);
  columnas.forEach((columna, idx) => {
    const color = colores[idx];
    const bordeSuperior = [];
    const bordeInferior = [];
    dias.forEach((d, i) => {
      const n = Number(d.conteos[columna.id] || 0);
      const base = acumulados[i];
      acumulados[i] = base + n;
      bordeSuperior.push(`${xPos(i)},${yPos(acumulados[i])}`);
      bordeInferior.unshift(`${xPos(i)},${yPos(base)}`);
    });
    const totalColumna = Number(dias[dias.length - 1].conteos[columna.id] || 0);
    areas += `<polygon points="${bordeSuperior.join(' ')} ${bordeInferior.join(' ')}" fill="${color}" fill-opacity="0.75" stroke="${color}" stroke-width="1">
      <title>${escaparHtml(columna.nombre)}: ${totalColumna} tarjeta(s) el último día</title>
    </polygon>`;
  });

  // Leyenda con el color de cada columna
  const leyenda = columnas.map((c, i) => `
    <span style="display: inline-flex; align-items: center; gap: 6px;">
      <span style="width: 12px; height: 12px; background: ${colores[i]}; border-radius: 2px; display: inline-block;"></span>
      ${escaparHtml(c.nombre)}
    </span>`).join('');

  const ejeY = `<line x1="${MARGEN.izq}" y1="${MARGEN.arriba}" x2="${MARGEN.izq}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;
  const ejeX = `<line x1="${MARGEN.izq}" y1="${yPos(0)}" x2="${ANCHO_SVG - MARGEN.der}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;

  const centroY = MARGEN.arriba + (ALTO_GRAFICA / 2);
  const tituloEjeY = `<text x="-${centroY}" y="22" transform="rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Tarjetas</text>`;
  const tituloEjeX = `<text x="${MARGEN.izq + (ANCHO_GRAFICA / 2)}" y="${ALTO_SVG - 16}" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Fecha</text>`;

  contenedor.innerHTML = `
    <div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">Diagrama de flujo acumulado</h2>
        <p class="subtitulo-pagina">Tarjetas en cada columna del tablero, día a día. La distancia entre las líneas muestra el trabajo en curso de cada estado.</p>
      </div>
    </div>

    ${datos.historialSuficiente ? '' : `<div class="alerta alerta--info" role="status" style="margin-bottom: 16px;">
      Todavía no hay suficiente historial de cambios de columna: la gráfica muestra solo la columna actual de cada tarjeta.
      El historial se empezó a registrar con este cambio; el diagrama será completo a medida que las tarjetas se muevan.
    </div>`}

    <svg viewBox="0 0 ${ANCHO_SVG} ${ALTO_SVG}" width="100%" height="auto" style="max-width: 750px; display: block; margin: 0 auto; overflow: visible;">
      ${rejillaY}
      ${ejeX}
      ${ejeY}
      ${tituloEjeX}
      ${tituloEjeY}
      ${etiquetasX}
      ${areas}
    </svg>

    <div style="display: flex; justify-content: center; align-items: center; gap: 24px; margin-top: 16px; font-size: 13px; color: #334155; flex-wrap: wrap;">
      ${leyenda}
    </div>
  `;
}
