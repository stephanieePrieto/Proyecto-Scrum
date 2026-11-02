/**
 * @file velocity.js
 * @description Dibujar la gráfica de velocity por sprint cerrado.
 * Modificada para dibujar gráficas de columnas agrupadas.
 * @author Dana
 */

import { escaparHtml, pluralizar } from '../../core/utils.js';

// Definir el lienzo del SVG (se escala con CSS, por eso solo importa la proporción)
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

/**
 * Acortar un nombre largo para que quepa bajo su barra.
 *
 * @param {string} nombre Nombre del sprint.
 * @param {number} limite Máximo de caracteres visibles.
 * @returns {string}
 */
const acortar = (nombre, limite) => (nombre.length > limite ? `${nombre.slice(0, limite - 1)}…` : nombre);

/**
 * Construir el SVG con las barras de puntos y la línea de promedio móvil (agrupadas).
 *
 * @param {Array<Object>} sprints Sprints cerrados.
 * @param {boolean} individual Si es true, representa horas en lugar de puntos de historia.
 * @returns {string} Código SVG.
 */
function construirSvg(sprints, individual) {
  const mayor = Math.max(...sprints.map(s => Math.max(s.puntos, s.puntosComprometidos, s.promedioMovil)), 1);
  const { maximo, paso } = escalaVertical(mayor);

  const anchoUtil = ANCHO - MARGEN.izq - MARGEN.der;
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const ranura = anchoUtil / sprints.length; 
  const anchoBarraTotal = Math.min(56, ranura * 0.7);
  const anchoColumna = anchoBarraTotal / 2; // COLUMNAS AGRUPADAS
  
  const limiteEtiqueta = Math.max(6, Math.floor(ranura / 7));

  const y = (valor) => MARGEN.arriba + altoUtil - (valor / maximo) * altoUtil;
  const centro = (i) => MARGEN.izq + ranura * i + ranura / 2;

  let rejilla = '';
  for (let v = 0; v <= maximo; v += paso) {
    rejilla += `<line class="grafica__rejilla" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(v)}" y2="${y(v)}" />
      <text class="grafica__texto" x="${MARGEN.izq - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }

  const barras = sprints.map((s, i) => {
    const altoComp = (s.puntosComprometidos / maximo) * altoUtil;
    const altoCompletado = (s.puntos / maximo) * altoUtil;
    const xBase = centro(i) - anchoBarraTotal / 2;
    
    return `<g>
      <title>${escaparHtml(s.nombre)}</title>
      <!-- Barra 1: Comprometidos (Gris Azulado) -->
      <rect fill="#6A8CA0" x="${xBase}" y="${y(s.puntosComprometidos)}" width="${anchoColumna - 1}" height="${altoComp}" rx="3" />
      <text class="grafica__valor" x="${xBase + anchoColumna/2}" y="${y(s.puntosComprometidos) - 6}" text-anchor="middle" font-size="10">${s.puntosComprometidos}</text>
      
      <!-- Barra 2: Aceptados/Completados (Verde/Primario) -->
      <rect fill="#282828" x="${xBase + anchoColumna + 1}" y="${y(s.puntos)}" width="${anchoColumna - 1}" height="${altoCompletado}" rx="3" />
      <text class="grafica__valor" x="${xBase + anchoColumna + 1 + anchoColumna/2}" y="${y(s.puntos) - 6}" text-anchor="middle" font-size="10">${s.puntos}</text>
      
      <text class="grafica__texto" x="${centro(i)}" y="${ALTO - MARGEN.abajo + 20}" text-anchor="middle">${escaparHtml(acortar(s.nombre, limiteEtiqueta))}</text>
    </g>`;
  }).join('');

  const puntosLinea = sprints.map((s, i) => `${centro(i)},${y(s.promedioMovil)}`).join(' ');
  const circulos = sprints.map((s, i) => `<circle class="grafica__punto" cx="${centro(i)}" cy="${y(s.promedioMovil)}" r="5" />`).join('');

  return `<svg class="grafica" viewBox="0 0 ${ANCHO} ${ALTO}">
    ${rejilla}
    <line class="grafica__eje" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(0)}" y2="${y(0)}" />
    ${barras}
    <polyline class="grafica__linea" points="${puntosLinea}" />
    ${circulos}
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
  const etiquetaComp = datos.individual ? 'Horas comprometidas' : 'Pts comprometidos';
  const etiquetaCompl = datos.individual ? 'Horas completadas' : 'Pts aceptados';

  contenedor.innerHTML = `
    <div class="grafica__leyenda">
      <span class="leyenda__item"><span style="width:14px; height:14px; background:#6A8CA0; display:inline-block;"></span>${etiquetaComp}</span>
      <span class="leyenda__item"><span style="width:14px; height:14px; background:#282828; display:inline-block;"></span>${etiquetaCompl}</span>
      <span class="leyenda__item"><span class="leyenda__muestra leyenda__muestra--linea"></span>Promedio móvil</span>
    </div>
    ${construirSvg(datos.sprints, datos.individual)}`;
}