/**
 * Generar el HTML de componentes visuales reutilizables.
 * Incluir la tarjeta KPI en sus 3 estados: carga, error y valor.
 */
import { escaparHtml } from './utils.js';

/**
 * Almacenar los trazos SVG de cada icono, indexados por clave.
 */
const ICONOS = {
  avance: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  dias: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  impedimentos: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  desviacion: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
};

/**
 * Construir el icono circular de la esquina de la tarjeta.
 * @param {string} clave - Clave del icono en ICONOS.
 * @returns {string} HTML del icono.
 */
const icono = (clave) =>
  `<span class="kpi__icono" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONOS[clave]}</svg></span>`;

/**
 * Generar la tarjeta en estado de carga (esqueleto).
 * Marcar aria-busy para informar a los lectores de pantalla.
 *
 * @param {string} etiqueta - Título del KPI.
 * @param {string} claveIcono - Clave del icono.
 * @returns {string} HTML de la tarjeta.
 */
export function tarjetaCarga(etiqueta, claveIcono) {
  return `<article class="tarjeta kpi kpi--cargando" aria-busy="true">
    <div class="kpi__cabecera"><span class="kpi__etiqueta">${etiqueta}</span>${icono(claveIcono)}</div>
    <span class="esqueleto esqueleto--valor"></span>
    <span class="esqueleto esqueleto--linea"></span>
  </article>`;
}

/**
 * Generar la tarjeta en estado de error.
 * Informar que solo este indicador falló e incluir un botón para reintentar.
 *
 * @param {string} etiqueta - Título del KPI.
 * @param {string} claveIcono - Clave del icono.
 * @param {string} id - Identificador del KPI (se guarda en data-reintentar).
 * @returns {string} HTML de la tarjeta.
 */
export function tarjetaError(etiqueta, claveIcono, id) {
  return `<article class="tarjeta kpi kpi--error" role="alert">
    <div class="kpi__cabecera"><span class="kpi__etiqueta">${etiqueta}</span>${icono(claveIcono)}</div>
    <div class="kpi__error">
      <span class="kpi__error-texto">No se pudo calcular</span>
      <span class="kpi__error-detalle">Los demás indicadores siguen disponibles.</span>
      <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar="${escaparHtml(id)}">Reintentar</button>
    </div>
  </article>`;
}

/**
 * Generar la tarjeta con el valor del KPI.
 * Colorear la tarjeta según el tono y dibujar la barra solo si se envía "progreso".
 *
 * @param {Object} p
 * @param {string} p.etiqueta - Título del KPI.
 * @param {string} p.claveIcono - Clave del icono.
 * @param {'exito'|'advertencia'|'peligro'|'info'|'neutro'} p.tono - Tono semántico.
 * @param {string|number} p.valor - Valor principal a mostrar.
 * @param {string} [p.unidad] - Unidad junto al valor (%, h, días).
 * @param {string} [p.pista] - Texto descriptivo inferior.
 * @param {number|null} [p.progreso] - Porcentaje 0-100 para la barra; null para omitirla.
 * @returns {string} HTML de la tarjeta.
 */
export function tarjetaValor({ etiqueta, claveIcono, tono, valor, unidad = '', pista = '', progreso = null }) {
  // Construir la barra de progreso limitando el valor entre 0 y 100
  const barra = progreso === null ? '' :
    `<div class="progreso" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progreso}">
       <div class="progreso__barra" style="width:${Math.max(0, Math.min(100, progreso))}%"></div></div>`;

  return `<article class="tarjeta kpi kpi--${tono}">
    <div class="kpi__cabecera"><span class="kpi__etiqueta">${etiqueta}</span>${icono(claveIcono)}</div>
    <div class="kpi__valor">${valor}${unidad ? `<span class="kpi__unidad">${unidad}</span>` : ''}</div>
    ${barra}
    <p class="kpi__pista">${pista}</p>
  </article>`;
}
