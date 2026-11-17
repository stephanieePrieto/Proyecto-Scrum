// Responsable: Alfonso - HU-26: gráfica y tabla de Lead Time y Cycle Time, y aviso de métricas de sprint en modo continuo.
/**
 * @file flujo.js
 * @description Métricas de flujo continuo de la HU-26 para la página de Métricas:
 *  - dibujarFlujo: filtro de periodo, promedio y mediana de Lead Time y Cycle Time, barras por tarjeta
 *    y tabla de detalle de las tarjetas terminadas. Avisa cuántas tarjetas no se pudieron medir.
 *  - dibujarAvisoNoAplica: aviso que reemplaza a Velocity, Burndown y Burnup cuando el proyecto
 *    trabaja en modo continuo (esas métricas dependen de los sprints).
 *
 * Los datos vienen de GET /api/flujo-continuo/proyectos/:proyectoId/tiempos?dias=N (en horas).
 * Todo texto que viene del usuario (títulos, nombres) pasa por escaparHtml antes de insertarse.
 * Los decimales se muestran con punto.
 *
 * @author Alfonso Mendoza Vasquez
 */

import { escaparHtml } from '../../core/utils.js';

/** Periodos que ofrece el filtro, en días. */
export const PERIODOS = Object.freeze([7, 30, 90, 365]);

/** Máximo de tarjetas en la gráfica de barras (la tabla las muestra todas). */
const MAX_BARRAS = 15;

/** Colores de la gráfica, tomados de los tokens de base.css (con respaldo por si no cargan). */
const COLOR_LEAD = 'var(--celeste-500, #0ea5e9)';
const COLOR_CYCLE = 'var(--esmeralda-500, #22c55e)';

/**
 * Formatea una duración en horas: menos de 1 h en minutos, menos de 48 h en horas y a partir de ahí en días.
 * Decimales con punto.
 * @param {number|null} horas
 * @returns {string}
 */
export function formatearDuracion(horas) {
  if (horas === null || horas === undefined || !Number.isFinite(Number(horas))) return '—';
  const valor = Number(horas);
  if (valor < 1) return `${Math.max(1, Math.round(valor * 60))} min`;
  if (valor < 48) return `${valor.toFixed(1)} h`;
  return `${(valor / 24).toFixed(1)} días`;
}

/**
 * Formatea una fecha ISO como DD/MM/AAAA.
 * @param {string} iso
 * @returns {string}
 */
function formatearFecha(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()}`;
}

/** Texto de una tarjeta para la gráfica y la tabla: "HU-5 · Título". */
function nombreTarjeta(tarjeta) {
  return tarjeta.numeroHu ? `HU-${tarjeta.numeroHu} · ${tarjeta.titulo}` : tarjeta.titulo;
}

/** Recorta un texto para que quepa en la etiqueta del eje. */
function recortar(texto, maximo) {
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

/**
 * Tarjeta de indicador (promedio y mediana de una métrica).
 * @param {string} titulo
 * @param {{cantidad: number, promedio: number|null, mediana: number|null}} metrica
 * @param {string} ayuda Definición corta de la métrica.
 * @returns {string} HTML.
 */
function indicador(titulo, metrica, ayuda) {
  return `<div class="flujo__indicador">
      <div class="flujo__indicador-titulo">${escaparHtml(titulo)}</div>
      <div class="flujo__indicador-valor">${formatearDuracion(metrica.promedio)}</div>
      <div class="flujo__indicador-detalle">Promedio · mediana ${formatearDuracion(metrica.mediana)} · ${metrica.cantidad} tarjeta(s)</div>
      <div class="flujo__indicador-detalle">${escaparHtml(ayuda)}</div>
    </div>`;
}

/**
 * Aviso de las tarjetas que no entraron en el cálculo. Nunca es un error: solo informa.
 * @param {{sinHistorial: number, duracionInvalida: number, sinCycle: number}} excluidas
 * @returns {string} HTML, o cadena vacía si no hay nada que avisar.
 */
function avisoExcluidas(excluidas = {}) {
  const partes = [];
  if (excluidas.sinHistorial) {
    partes.push(`${excluidas.sinHistorial} tarjeta(s) terminada(s) no tienen historial de movimientos (se movieron antes de que se registrara) y no se pueden medir`);
  }
  if (excluidas.duracionInvalida) {
    partes.push(`${excluidas.duracionInvalida} tarjeta(s) tienen fechas inconsistentes y se omitieron`);
  }
  if (excluidas.sinCycle) {
    partes.push(`${excluidas.sinCycle} tarjeta(s) cuentan para el Lead Time pero no para el Cycle Time, porque no hay registro de cuándo salieron de la primera columna`);
  }
  if (!partes.length) return '';
  return `<div class="alerta alerta--info flujo__aviso" role="status">${partes.map((p) => `${escaparHtml(p)}.`).join('<br>')}</div>`;
}

/**
 * Barras horizontales por tarjeta: Lead Time y, debajo, Cycle Time.
 * @param {Array<Object>} tarjetas Tarjetas medidas (las más recientes primero).
 * @returns {string} SVG.
 */
function graficaBarras(tarjetas) {
  const filas = tarjetas.slice(0, MAX_BARRAS);
  const ANCHO = 800;
  const MARGEN = { izq: 240, der: 90, arriba: 10, abajo: 10 };
  const ALTO_FILA = 34;
  const ALTO = MARGEN.arriba + MARGEN.abajo + filas.length * ALTO_FILA;
  const anchoUtil = ANCHO - MARGEN.izq - MARGEN.der;
  const maximo = Math.max(...filas.map((t) => Math.max(t.leadHoras || 0, t.cycleHoras || 0)), 1);
  const escala = (horas) => (Math.max(horas || 0, 0) / maximo) * anchoUtil;

  const contenido = filas.map((t, i) => {
    const y = MARGEN.arriba + i * ALTO_FILA;
    const nombre = nombreTarjeta(t);
    const anchoLead = escala(t.leadHoras);
    const anchoCycle = escala(t.cycleHoras);
    return `<g>
        <title>${escaparHtml(nombre)} · Lead ${formatearDuracion(t.leadHoras)} · Cycle ${formatearDuracion(t.cycleHoras)}</title>
        <text x="${MARGEN.izq - 10}" y="${y + 17}" text-anchor="end" font-size="12" fill="currentColor">${escaparHtml(recortar(nombre, 34))}</text>
        <rect x="${MARGEN.izq}" y="${y + 4}" width="${anchoLead}" height="12" rx="2" fill="${COLOR_LEAD}" />
        <text x="${MARGEN.izq + anchoLead + 6}" y="${y + 14}" font-size="11" fill="currentColor">${formatearDuracion(t.leadHoras)}</text>
        ${t.cycleHoras === null ? '' : `<rect x="${MARGEN.izq}" y="${y + 18}" width="${anchoCycle}" height="10" rx="2" fill="${COLOR_CYCLE}" />
        <text x="${MARGEN.izq + anchoCycle + 6}" y="${y + 27}" font-size="11" fill="currentColor">${formatearDuracion(t.cycleHoras)}</text>`}
      </g>`;
  }).join('');

  const nota = tarjetas.length > MAX_BARRAS
    ? `<p class="subtitulo-pagina" style="text-align: center;">La gráfica muestra las ${MAX_BARRAS} tarjetas terminadas más recientes; la tabla las incluye todas.</p>`
    : '';

  return `<svg viewBox="0 0 ${ANCHO} ${ALTO}" width="100%" role="img" aria-label="Lead Time y Cycle Time por tarjeta"
      style="max-width: 760px; display: block; margin: 0 auto; color: var(--texto);">${contenido}</svg>
    <div class="flujo__leyenda">
      <span><span class="flujo__muestra flujo__muestra--lead"></span>Lead Time</span>
      <span><span class="flujo__muestra flujo__muestra--cycle"></span>Cycle Time</span>
    </div>${nota}`;
}

/**
 * Tabla de detalle con todas las tarjetas medidas.
 * @param {Array<Object>} tarjetas
 * @returns {string} HTML.
 */
function tablaDetalle(tarjetas) {
  const filas = tarjetas.map((t) => `<tr>
      <td>${escaparHtml(nombreTarjeta(t))}</td>
      <td>${escaparHtml(t.responsable || 'Sin responsable')}</td>
      <td class="flujo__numero">${formatearFecha(t.terminadaEn)}</td>
      <td class="flujo__numero">${formatearDuracion(t.leadHoras)}</td>
      <td class="flujo__numero">${formatearDuracion(t.cycleHoras)}</td>
    </tr>`).join('');
  return `<div class="flujo__tabla-contenedor">
      <table class="flujo__tabla">
        <caption class="modo-flujo__oculto">Detalle de tiempos por tarjeta terminada</caption>
        <thead><tr>
          <th scope="col">Tarjeta</th>
          <th scope="col">Responsable</th>
          <th scope="col" class="flujo__numero">Terminada</th>
          <th scope="col" class="flujo__numero">Lead Time</th>
          <th scope="col" class="flujo__numero">Cycle Time</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

/**
 * Dibuja las métricas de flujo continuo.
 *
 * @param {HTMLElement} contenedor Elemento donde se dibuja.
 * @param {Object} datos Respuesta de GET /api/flujo-continuo/proyectos/:id/tiempos (campo `datos`).
 * @param {{alCambiarDias?: (dias: number) => void}} [opciones] Se llama cuando la persona elige otro periodo.
 * @returns {void}
 */
export function dibujarFlujo(contenedor, datos, { alCambiarDias } = {}) {
  if (!contenedor) return;
  const dias = Number(datos?.dias) || 30;
  const opciones = PERIODOS.map((p) => `<option value="${p}" ${p === dias ? 'selected' : ''}>Últimos ${p} días</option>`).join('');

  const filtro = `<div class="flujo__filtros">
      <label class="metricas__filtro">Periodo
        <select class="metricas__selector" data-flujo-dias>${opciones}</select>
      </label>
      <span class="subtitulo-pagina">Del ${formatearFecha(datos?.desde)} al ${formatearFecha(datos?.hasta)}</span>
    </div>`;

  const cuerpo = datos?.vacio
    ? `<div class="aviso aviso--vacio">
        <h3 class="aviso__titulo">No hay tarjetas terminadas en este periodo</h3>
        <p class="aviso__texto">Los tiempos aparecen cuando una tarjeta llega a la columna final del tablero. Prueba con un periodo más amplio.</p>
      </div>`
    : `<div class="flujo__resumen">
        ${indicador('Lead Time', datos.lead, 'Desde que se crea la tarjeta hasta que termina.')}
        ${indicador('Cycle Time', datos.cycle, 'Desde que sale de la primera columna hasta que termina.')}
      </div>
      ${graficaBarras(datos.tarjetas)}
      ${tablaDetalle(datos.tarjetas)}`;

  const cabecera = `<div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">Tiempos de flujo</h2>
        <p class="subtitulo-pagina">Lead Time y Cycle Time de las tarjetas que llegaron a la columna final del tablero.</p>
      </div>
    </div>`;

  contenedor.innerHTML = `${cabecera}${filtro}${avisoExcluidas(datos?.excluidas)}${cuerpo}`;

  contenedor.querySelector('[data-flujo-dias]')?.addEventListener('change', (evento) => {
    if (typeof alCambiarDias === 'function') alCambiarDias(Number(evento.target.value));
  });
}

/**
 * Aviso para Velocity, Burndown y Burnup cuando el proyecto trabaja en modo continuo.
 * Ofrece pasar a "Tiempos de flujo", que sí aplica sin sprints.
 *
 * @param {HTMLElement} contenedor Elemento donde se dibuja.
 * @param {string} nombreMetrica Nombre visible de la métrica elegida (por ejemplo, "Velocity").
 * @param {() => void} [irAFlujo] Acción del botón "Ver tiempos de flujo".
 * @returns {void}
 */
export function dibujarAvisoNoAplica(contenedor, nombreMetrica, irAFlujo) {
  if (!contenedor) return;
  contenedor.innerHTML = `<div class="aviso aviso--vacio" role="status">
      <h3 class="aviso__titulo">${escaparHtml(nombreMetrica)} no aplica en modo continuo</h3>
      <p class="aviso__texto">Este proyecto trabaja sin sprints, así que no hay sprints que comparar.
        Para medir el flujo usa Lead Time y Cycle Time. Los sprints cerrados se conservan y vuelven a verse si el proyecto regresa a Scrum.</p>
      <button type="button" class="boton boton--primario" data-flujo-ir style="margin-top: 12px;">Ver tiempos de flujo</button>
    </div>`;
  contenedor.querySelector('[data-flujo-ir]')?.addEventListener('click', () => {
    if (typeof irAFlujo === 'function') irAFlujo();
  });
}
