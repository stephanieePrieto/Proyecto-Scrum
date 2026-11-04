/**
 * @file velocity.js
 * @description Dibujar la gráfica de velocity por sprint cerrado (HU-30).
 * Columnas agrupadas (Comprometidos vs Aceptados/Completados) con tooltips y sin línea amarilla.
 * @author Dana
 */

import { escaparHtml } from '../../core/utils.js';

const ANCHO = 640;
const ALTO = 320;
const MARGEN = { izq: 44, der: 16, arriba: 24, abajo: 56 };

/**
 * Calcular un máximo "redondo" para el eje vertical y el paso entre marcas.
 *
 * @param {number} mayor Valor más alto que debe caber en la gráfica.
 * @returns {{maximo: number, paso: number}}
 */
function escalaVertical(mayor) {
  const paso = mayor <= 10 ? 2 : mayor <= 25 ? 5 : mayor <= 60 ? 10 : 20;
  return { maximo: Math.max(paso, Math.ceil(mayor / paso) * paso), paso };
}

const acortar = (nombre, limite) => (nombre.length > limite ? `${nombre.slice(0, limite - 1)}…` : nombre);

/**
 * Construir el SVG con las barras de puntos y la línea de promedio móvil (agrupadas).
 *
 * @param {Array<Object>} sprints Sprints cerrados.
 * @param {boolean} individual Si es true, representa horas en lugar de puntos de historia.
 * @returns {string} Código SVG.
 */
function construirSvg(sprints, individual) {
  const mayor = Math.max(...sprints.map(s => Math.max(s.puntos, s.puntosComprometidos)), 1);
  const { maximo, paso } = escalaVertical(mayor);

  const anchoUtil = ANCHO - MARGEN.izq - MARGEN.der;
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const ranura = anchoUtil / sprints.length; 
  const anchoBarraTotal = Math.min(56, ranura * 0.7);
  const anchoColumna = anchoBarraTotal / 2;
  
  const limiteEtiqueta = Math.max(6, Math.floor(ranura / 7));

  const y = (valor) => MARGEN.arriba + altoUtil - (valor / maximo) * altoUtil;
  const centro = (i) => MARGEN.izq + ranura * i + ranura / 2;

  let rejilla = '';
  for (let v = 0; v <= maximo; v += paso) {
    rejilla += `<line class="grafica__rejilla" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e8f0" stroke-width="1" />
      <text class="grafica__texto" x="${MARGEN.izq - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#64748b">${v}</text>`;
  }

  const etiquetaComp = individual ? 'Horas comprometidas' : 'Pts comprometidos';
  const etiquetaCompl = individual ? 'Horas completadas' : 'Pts aceptados';

  const barras = sprints.map((s, i) => {
    const altoComp = (s.puntosComprometidos / maximo) * altoUtil;
    const altoCompletado = (s.puntos / maximo) * altoUtil;
    const xBase = centro(i) - anchoBarraTotal / 2;
    
    return `<g>
      <!-- Barra 1: Comprometidos (Azul grisáceo) -->
      <rect fill="#6A8CA0" x="${xBase}" y="${y(s.puntosComprometidos)}" width="${anchoColumna - 1}" height="${altoComp}" rx="3">
        <title>${etiquetaComp}: ${s.puntosComprometidos}</title>
      </rect>
      <text class="grafica__valor" x="${xBase + anchoColumna/2}" y="${y(s.puntosComprometidos) - 6}" text-anchor="middle" font-size="10" font-weight="bold" fill="#334155">${s.puntosComprometidos}</text>
      
      <!-- Barra 2: Aceptados/Completados (Negro/Oscuro) -->
      <rect fill="#282828" x="${xBase + anchoColumna + 1}" y="${y(s.puntos)}" width="${anchoColumna - 1}" height="${altoCompletado}" rx="3">
        <title>${etiquetaCompl}: ${s.puntos}</title>
      </rect>
      <text class="grafica__valor" x="${xBase + anchoColumna + 1 + anchoColumna/2}" y="${y(s.puntos) - 6}" text-anchor="middle" font-size="10" font-weight="bold" fill="#334155">${s.puntos}</text>
      
      <text class="grafica__texto" x="${centro(i)}" y="${ALTO - MARGEN.abajo + 20}" text-anchor="middle" font-size="11" fill="#334155">${escaparHtml(acortar(s.nombre, limiteEtiqueta))}</text>
    </g>`;
  }).join('');

  return `<svg class="grafica" viewBox="0 0 ${ANCHO} ${ALTO}" style="max-width: 650px; display: block; margin: 0 auto; overflow: visible;">
    ${rejilla}
    <line class="grafica__eje" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(0)}" y2="${y(0)}" stroke="#94a3b8" stroke-width="1.5" />
    ${barras}
  </svg>`;
}

/**
 * Dibujar la sección de velocity dentro del contenedor.
 * Con datos, sin sprints cerrados, ventana incompleta
 * y rechazadas excluidas (se informan en el detalle, pero no suman).
 *
 * @param {HTMLElement} contenedor Elemento donde se inserta el resultado.
 * @param {Object} datos Respuesta de GET /api/metricas/proyectos/:id/velocity.
 * @returns {void}
 */
export function dibujarVelocity(contenedor, datos) {
  if (datos.vacio) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">Aún no hay datos de velocity</div>`;
    return;
  }
  
  const titulo = datos.individual ? 'Velocity individual por sprint' : 'Velocity por sprint';
  const descripcion = datos.individual 
    ? 'Horas estimadas comprometidas frente a horas completadas por sprint cerrado'
    : 'Puntos de historias comprometidos frente a puntos aceptados en cada sprint cerrado';

  const etiquetaComp = datos.individual ? 'Horas comprometidas' : 'Pts comprometidos';
  const etiquetaCompl = datos.individual ? 'Horas completadas' : 'Pts aceptados';

  contenedor.innerHTML = `
    <div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">${titulo}</h2>
        <p class="subtitulo-pagina">${descripcion}</p>
      </div>
    </div>

    <div class="grafica__leyenda" style="display: flex; gap: 20px; margin-bottom: 16px; font-size: 13px; color: #334155;">
      <span class="leyenda__item" style="display: inline-flex; align-items: center; gap: 6px;">
        <span style="width:14px; height:14px; background:#6A8CA0; display:inline-block; border-radius: 2px;"></span>${etiquetaComp}
      </span>
      <span class="leyenda__item" style="display: inline-flex; align-items: center; gap: 6px;">
        <span style="width:14px; height:14px; background:#282828; display:inline-block; border-radius: 2px;"></span>${etiquetaCompl}
      </span>
    </div>
    ${construirSvg(datos.sprints, datos.individual)}`;
}