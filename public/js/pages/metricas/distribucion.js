/**
 * @file distribucion.js
 * @description HU-32: Gráfica de dona para la distribución del tiempo, con leyenda interactiva
 * y agrupación automática de categorías pequeñas en "Otros".
 * @author Dana Carmona Santamaria
 */
import { escaparHtml } from '../../core/utils.js';

const COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];
const COLOR_OTROS = '#94a3b8';
const MAX_PRINCIPALES = 5;  // Máximo de categorías con color propio
const UMBRAL = 0.05;        // Una categoría con menos del 5% del total se agrupa en "Otros"

/** Redondear a un decimal (evita mostrar 3.3000000000000003). */
const redondear = (v) => Math.round(v * 10) / 10;

/**
 * Dibujar la dona y la leyenda dentro del contenedor.
 *
 * @param {HTMLElement} contenedor Elemento donde se pinta la gráfica.
 * @param {{esScrumMaster: boolean, datos: Array}} payload Respuesta de /distribucion.
 */
export function dibujarDistribucion(contenedor, payload) {
  // Sin horas registradas: mostrar el mensaje y terminar
  if (!payload.datos || payload.datos.length === 0) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">
      <h3 class="aviso__titulo">No hay datos de tiempo</h3>
      <p class="aviso__texto">El equipo no ha registrado horas reales en este proyecto.</p>
    </div>`;
    return;
  }

  // Estado local para interactuar sin volver a pedir datos al servidor
  let agrupacionActual = payload.esScrumMaster ? 'persona' : 'actividad';
  const ocultas = new Set(); // Claves de la leyenda que el usuario ocultó con clic

  /**
   * Sumar las horas por la dimensión elegida y agrupar las categorías pequeñas en "Otros".
   * La clasificación usa TODAS las categorías (también las ocultas) para que los colores
   * y el grupo "Otros" no cambien al ocultar o mostrar elementos.
   *
   * @returns {{entradas: Array, total: number}} Entradas de la leyenda y total general de horas.
   */
  function calcularEntradas() {
    const mapa = new Map();
    payload.datos.forEach((f) => {
      const clave = f[agrupacionActual] || 'Sin especificar';
      mapa.set(clave, (mapa.get(clave) || 0) + Number(f.horas));
    });

    const ordenadas = Array.from(mapa, ([clave, valor]) => ({ clave, valor })).sort((a, b) => b.valor - a.valor);
    const total = ordenadas.reduce((s, it) => s + it.valor, 0);

    const principales = [];
    const pequenas = [];
    ordenadas.forEach((it, i) => {
      (i < MAX_PRINCIPALES && it.valor >= total * UMBRAL ? principales : pequenas).push(it);
    });
    // Una sola categoría pequeña no se agrupa: "Otros" solo tiene sentido con 2 o más
    if (pequenas.length === 1) principales.push(pequenas.pop());

    principales.forEach((it, i) => { it.color = COLORES[i % COLORES.length]; });
    const entradas = [...principales];
    if (pequenas.length > 0) {
      entradas.push({
        clave: 'Otros',
        valor: pequenas.reduce((s, it) => s + it.valor, 0),
        color: COLOR_OTROS,
        nombres: pequenas.map((p) => p.clave), // para el tooltip de la leyenda
      });
    }
    return { entradas, total };
  }

  /** Pintar la gráfica completa; se llama al abrir y tras cada cambio del usuario. */
  function renderizar(claveConFoco = null) {
    const { entradas, total } = calcularEntradas();
    const visibles = entradas.filter((e) => !ocultas.has(e.clave));
    const totalVisible = visibles.reduce((s, it) => s + it.valor, 0);

    // 1. Segmentos de la dona (circunferencia = 100 con radio 15.9155)
    let svgContent = '';
    if (totalVisible === 0) {
      svgContent = `<text x="21" y="21" font-size="3" text-anchor="middle" alignment-baseline="middle" fill="#94a3b8">Sin datos</text>`;
    } else {
      let acumulado = 0;
      visibles.forEach((item) => {
        const pct = (item.valor / totalVisible) * 100;
        svgContent += `<circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="${item.color}"
          stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${100 - acumulado}"
          style="transition: all 0.3s ease;">
          <title>${escaparHtml(item.clave)}: ${redondear(item.valor)}h (${Math.round(pct)}%)</title>
        </circle>`;
        acumulado += pct;
      });
    }

    // 2. Leyenda interactiva: una entrada por segmento, incluida "Otros"
    const htmlLeyenda = entradas.map((item) => {
      const oculta = ocultas.has(item.clave);
      const etiqueta = item.nombres ? `Otros (${item.nombres.length} categorías)` : item.clave;
      const detalle = item.nombres ? item.nombres.join(', ') : item.clave;
      const pct = Math.round((item.valor / total) * 100);
      return `
        <button type="button" class="leyenda__item ${oculta ? 'leyenda__item--oculta' : ''}"
          data-clave="${escaparHtml(item.clave)}" title="${escaparHtml(detalle)}" aria-pressed="${!oculta}"
          style="background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:8px; opacity:${oculta ? 0.4 : 1}; text-align:left;">
          <span style="width:12px; height:12px; border-radius:50%; background:${item.color}; flex-shrink:0;"></span>
          <span style="color: var(--texto-suave); font-size: 13px;">${escaparHtml(etiqueta)} <strong>(${redondear(item.valor)}h · ${pct}%)</strong></span>
        </button>`;
    }).join('');

    // 3. Selector de agrupación ("Miembros" solo para el Scrum Master)
    const opcion = (valor, texto) =>
      `<option value="${valor}" ${agrupacionActual === valor ? 'selected' : ''}>${texto}</option>`;
    const opciones = (payload.esScrumMaster ? opcion('persona', 'Miembros del equipo') : '')
      + opcion('historia', 'Historia de Usuario')
      + opcion('epica', 'Épica')
      + opcion('actividad', 'Tipo de actividad');

    contenedor.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; gap: 32px; align-items: center; justify-content: center;">
        <div style="flex: 0 1 240px; position: relative;">
          <svg viewBox="0 0 42 42" width="100%" height="100%" role="img"
            aria-label="Distribución de horas por ${escaparHtml(agrupacionActual)}"
            style="transform: rotate(-90deg); overflow: visible;">
            <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#f1f5f9" stroke-width="6"></circle>
            ${svgContent}
          </svg>
          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
            <span style="display: block; font-size: 24px; font-weight: 700; color: var(--texto); line-height: 1;">${Math.round(totalVisible)}h</span>
            <span style="font-size: 12px; color: var(--texto-suave);">Total visible</span>
          </div>
        </div>
        <div style="flex: 1; min-width: 250px; display: flex; flex-direction: column; gap: 16px;">
          <label class="metricas__filtro">Agrupar horas por:
            <select id="distribucion-agrupacion" class="metricas__selector" style="width: 100%; margin-top: 8px;">${opciones}</select>
          </label>
          <div style="display: flex; flex-direction: column; gap: 10px; max-height: 200px; overflow-y: auto; padding-right: 8px;">
            ${htmlLeyenda}
          </div>
        </div>
      </div>`;

    // Cambiar la dimensión: se muestran de nuevo todas las categorías
    contenedor.querySelector('#distribucion-agrupacion').addEventListener('change', (e) => {
      agrupacionActual = e.target.value;
      ocultas.clear();
      renderizar();
    });

    // Clic en la leyenda: ocultar o mostrar esa categoría (o todo el grupo "Otros")
    contenedor.querySelectorAll('.leyenda__item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const clave = e.currentTarget.dataset.clave;
        if (ocultas.has(clave)) ocultas.delete(clave);
        else ocultas.add(clave);
        renderizar(clave);
      });
    });

    // Devolver el foco al botón pulsado (accesibilidad con teclado)
    if (claveConFoco !== null) {
      Array.from(contenedor.querySelectorAll('.leyenda__item'))
        .find((b) => b.dataset.clave === claveConFoco)?.focus();
    }
  }

  renderizar();
}