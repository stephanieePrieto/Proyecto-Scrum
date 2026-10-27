/**
 * @file velocity.js
 * @description Dibujar la gráfica de velocity por sprint cerrado.
 * Mostrar barras con los puntos de historias aceptadas y una línea con el promedio móvil.
 * La gráfica es un SVG generado aquí (sin librerías); los colores viven en css/componentes/metricas.css.
 * @author Dana
 */

import { escaparHtml, pluralizar } from '../../core/utils.js';

// Definir el lienzo del SVG (se escala con CSS, por eso solo importa la proporción)
const ANCHO = 640;
const ALTO = 320;
const MARGEN = { izq: 44, der: 16, arriba: 24, abajo: 56 };

/**
 * Calcular un máximo "redondo" para el eje vertical y el paso entre marcas.
 * Ejemplo: 16 puntos -> máximo 20 con marcas cada 5.
 *
 * @param {number} mayor Valor más alto que debe caber en la gráfica.
 * @returns {{maximo: number, paso: number}}
 */
function escalaVertical(mayor) {
  const paso = mayor <= 10 ? 2 : mayor <= 25 ? 5 : mayor <= 60 ? 10 : 20;
  return { maximo: Math.max(paso, Math.ceil(mayor / paso) * paso), paso };
}

/**
 * Acortar un nombre largo para que quepa bajo su barra (el nombre completo va en <title>).
 *
 * @param {string} nombre Nombre del sprint.
 * @param {number} limite Máximo de caracteres visibles (depende del ancho de cada barra).
 * @returns {string}
 */
const acortar = (nombre, limite) => (nombre.length > limite ? `${nombre.slice(0, limite - 1)}…` : nombre);

/**
 * Construir el SVG con las barras de puntos y la línea de promedio móvil.
 *
 * @param {Array<Object>} sprints Sprints cerrados, del más antiguo al más reciente.
 * @returns {string} Código SVG listo para insertar.
 */
function construirSvg(sprints) {
  const mayor = Math.max(...sprints.map((s) => Math.max(s.puntos, s.promedioMovil)), 1);
  const { maximo, paso } = escalaVertical(mayor);

  const anchoUtil = ANCHO - MARGEN.izq - MARGEN.der;
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const ranura = anchoUtil / sprints.length; // espacio que le toca a cada sprint
  const anchoBarra = Math.min(56, ranura * 0.6);
  // Cuántos caracteres caben bajo cada barra (unos 7 px por letra); con muchos sprints se acorta más
  const limiteEtiqueta = Math.max(6, Math.floor(ranura / 7));

  // Convertir un valor de puntos a coordenada vertical (0 abajo, máximo arriba)
  const y = (valor) => MARGEN.arriba + altoUtil - (valor / maximo) * altoUtil;
  const centro = (i) => MARGEN.izq + ranura * i + ranura / 2;

  // Rejilla horizontal con su etiqueta en el eje vertical
  let rejilla = '';
  for (let v = 0; v <= maximo; v += paso) {
    rejilla += `<line class="grafica__rejilla" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(v)}" y2="${y(v)}" />
      <text class="grafica__texto" x="${MARGEN.izq - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }

  // Barras (puntos aceptados), con su valor encima y el nombre del sprint debajo
  const barras = sprints.map((s, i) => {
    const alto = (s.puntos / maximo) * altoUtil;
    return `<g>
      <title>${escaparHtml(s.nombre)}: ${s.puntos} puntos aceptados (promedio móvil ${s.promedioMovil})</title>
      <rect class="grafica__barra" x="${centro(i) - anchoBarra / 2}" y="${y(s.puntos)}" width="${anchoBarra}" height="${alto}" rx="4" />
      <text class="grafica__valor" x="${centro(i)}" y="${y(s.puntos) - 6}" text-anchor="middle">${s.puntos}</text>
      <text class="grafica__texto" x="${centro(i)}" y="${ALTO - MARGEN.abajo + 20}" text-anchor="middle">${escaparHtml(acortar(s.nombre, limiteEtiqueta))}</text>
    </g>`;
  }).join('');

  // Línea de promedio móvil con un punto por sprint
  const puntosLinea = sprints.map((s, i) => `${centro(i)},${y(s.promedioMovil)}`).join(' ');
  const circulos = sprints.map((s, i) =>
    `<circle class="grafica__punto" cx="${centro(i)}" cy="${y(s.promedioMovil)}" r="5" />`).join('');

  return `<svg class="grafica" viewBox="0 0 ${ANCHO} ${ALTO}" role="img"
      aria-label="Velocity de ${sprints.length} ${pluralizar(sprints.length, 'sprint cerrado', 'sprints cerrados')}: barras de puntos aceptados y línea de promedio móvil">
    ${rejilla}
    <line class="grafica__eje" x1="${MARGEN.izq}" x2="${ANCHO - MARGEN.der}" y1="${y(0)}" y2="${y(0)}" />
    ${barras}
    <polyline class="grafica__linea" points="${puntosLinea}" />
    ${circulos}
  </svg>`;
}

/**
 * Construir el estado vacío cuando todavía no hay sprints cerrados.
 *
 * @returns {string} HTML del aviso.
 */
function avisoSinDatos() {
  return `<div class="aviso aviso--vacio">
    <div class="aviso__icono" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>
    </div>
    <h3 class="aviso__titulo">Aún no hay datos de velocity</h3>
    <p class="aviso__texto">Cuando se cierre el primer sprint, aquí aparecerán los puntos aceptados de cada uno.</p>
  </div>`;
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
  // Caso: no hay sprints cerrados
  if (datos.vacio) {
    contenedor.innerHTML = avisoSinDatos();
    return;
  }

  // Caso: hay menos sprints que la ventana del promedio -> usar los disponibles e indicarlo
  const avisoVentana = datos.ventanaIncompleta
    ? `<p class="alerta alerta--info" role="status">Solo hay ${datos.sprints.length} ${pluralizar(datos.sprints.length, 'sprint cerrado', 'sprints cerrados')}:
         el promedio móvil usa los disponibles (la ventana completa es de ${datos.ventana}).</p>`
    : '';

  const detalle = datos.sprints.map((s) => `<li class="grafica__detalle-fila">
      <strong>${escaparHtml(s.nombre)}</strong>
      <span>${s.puntos} pts · promedio ${s.promedioMovil}${s.muestras < datos.ventana ? ` (con ${s.muestras} ${pluralizar(s.muestras, 'sprint', 'sprints')})` : ''}</span>
      <span class="grafica__detalle-dato">${s.aceptadas} ${pluralizar(s.aceptadas, 'aceptada', 'aceptadas')}
        · ${s.rechazadas} ${pluralizar(s.rechazadas, 'rechazada (no suma)', 'rechazadas (no suman)')}</span>
    </li>`).join('');

  contenedor.innerHTML = `
    ${avisoVentana}
    <div class="grafica__leyenda">
      <span class="leyenda__item"><span class="leyenda__muestra leyenda__muestra--barra"></span>Puntos aceptados</span>
      <span class="leyenda__item"><span class="leyenda__muestra leyenda__muestra--linea"></span>Promedio móvil (${datos.ventana} sprints)</span>
    </div>
    ${construirSvg(datos.sprints)}
    <ul class="grafica__detalle">${detalle}</ul>`;
}