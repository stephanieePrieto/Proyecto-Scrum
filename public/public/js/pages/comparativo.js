/**
 * @file comparativo.js
 * @description Vista del comparativo de métricas entre equipos (HU-2). Solo el Scrum Master
 * de cada proyecto puede ver sus equipos; el backend responde 403 a cualquier otra persona.
 * La vista muestra una gráfica de barras por equipo y una tabla resumida con el promedio
 * de referencia al pie.
 *
 * @author Dana Carmona Santamaria
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';

const contenedor = document.getElementById('comparativo-contenido');
const seccion = document.getElementById('seccion-comparativo');
const avisoSinAcceso = document.getElementById('aviso-sin-acceso');

/**
 * Métricas que se grafican por equipo y sus colores.
 * Velocity usa el mismo teal del Burndown; avance el azul de acento; desviación ámbar.
 */
const METRICAS_GRAFICA = [
  { clave: 'velocityPct', etiqueta: 'Velocity', color: '#1F5A67' },
  { clave: 'avancePct', etiqueta: 'Avance', color: '#3b82f6' },
  { clave: 'desviacionPct', etiqueta: 'Desviación', color: '#f59e0b' },
];

/**
 * Importar dinámicamente y montar la barra de navegación superior.
 * @returns {Promise<void>}
 */
async function montarLayout() {
  try {
    const layout = await import('../core/layout.js');
    await layout.montarBarraSuperior();
  } catch (error) {
    console.warn('[comparativo] No se pudo montar la barra superior:', error.message);
  }
}

/**
 * Formatear un número como porcentaje con un decimal, o "—" cuando no hay dato.
 * @param {number|null|undefined} valor
 * @returns {string}
 */
function pct(valor) {
  return Number.isFinite(valor) ? `${valor} %` : '—';
}

/**
 * Dibujar la gráfica de barras agrupadas: una barra por métrica en cada equipo con datos.
 * La escala es 0–100 % salvo que algún valor la supere; una desviación negativa se dibuja
 * en 0 (su valor real se sigue viendo en la etiqueta).
 * @param {Array<Object>} equipos Equipos con estado 'ok'.
 * @returns {string} HTML de la leyenda y el SVG.
 */
function graficaComparativo(equipos) {
  if (!equipos.length) {
    return '<p class="comparativo__nota-grafica">Todavía no hay equipos con datos suficientes para graficar.</p>';
  }

  const valores = equipos.flatMap((e) => METRICAS_GRAFICA.map((m) => e[m.clave]));
  const maximo = Math.max(0, ...valores.filter((v) => Number.isFinite(v)));
  const escala = Math.max(100, Math.ceil(maximo / 20) * 20);

  const ancho = 760;
  const alto = 320;
  const mIzq = 44;
  const mDer = 16;
  const mSup = 24;
  const mInf = 44;
  const anchoGrafica = ancho - mIzq - mDer;
  const altoGrafica = alto - mSup - mInf;
  const anchoGrupo = anchoGrafica / equipos.length;
  const anchoBarra = Math.min(34, (anchoGrupo - 24) / METRICAS_GRAFICA.length);
  const paso = escala / 4;

  const lineas = [];
  for (let i = 0; i <= 4; i += 1) {
    const valor = paso * i;
    const y = mSup + altoGrafica - (valor / escala) * altoGrafica;
    lineas.push(`<line x1="${mIzq}" y1="${y.toFixed(1)}" x2="${ancho - mDer}" y2="${y.toFixed(1)}" stroke="${i === 0 ? '#cbd5e1' : '#e2e8f0'}" />`);
    lineas.push(`<text x="${mIzq - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#64748b">${valor} %</text>`);
  }

  const barras = equipos.flatMap((equipo, i) => {
    const centroGrupo = mIzq + anchoGrupo * i + anchoGrupo / 2;
    const inicio = centroGrupo - (anchoBarra * METRICAS_GRAFICA.length + 6 * (METRICAS_GRAFICA.length - 1)) / 2;
    const grupo = METRICAS_GRAFICA.map((metrica, j) => {
      const valor = equipo[metrica.clave];
      const altura = Number.isFinite(valor) ? (Math.max(0, valor) / escala) * altoGrafica : 0;
      const x = inicio + j * (anchoBarra + 6);
      const y = mSup + altoGrafica - altura;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${anchoBarra}" height="${altura.toFixed(1)}" rx="2" fill="${metrica.color}" />`
        + `<text x="${(x + anchoBarra / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="11" fill="#334155">${pct(valor)}</text>`;
    }).join('');
    const etiqueta = `<text x="${centroGrupo.toFixed(1)}" y="${alto - 16}" text-anchor="middle" font-size="12" fill="#475569">${escaparHtml(equipo.equipo)}</text>`;
    return grupo + etiqueta;
  }).join('');

  const leyenda = `<div class="comparativo__leyenda">${METRICAS_GRAFICA.map((m) => `<span><i style="background:${m.color}"></i>${m.etiqueta}</span>`).join('')}</div>`;

  return `${leyenda}<div class="comparativo__grafica"><svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Gráfica de velocity, avance y desviación por equipo">${lineas.join('')}${barras}</svg></div>`;
}

/**
 * Dibujar la gráfica, la tabla con un equipo por fila y el promedio de referencia al pie.
 * @param {Object} datos Respuesta de GET /api/comparativo/resumen.
 * @returns {void}
 */
function dibujarComparativo(datos) {
  const filas = datos.equipos.map((e) => {
    if (e.estado === 'datos_insuficientes') {
      return `<tr class="comparativo__fila--sin-datos">
        <td>${escaparHtml(e.equipo)}</td>
        <td>${escaparHtml(e.proyecto)}</td>
        <td colspan="3"><span class="insignia insignia--aviso">Datos insuficientes</span>
          <span class="comparativo__nota">Este equipo todavía no tiene sprints cerrados.</span></td>
        <td>${e.sprintsCerrados} sprint(s) cerrado(s)</td>
      </tr>`;
    }
    return `<tr>
      <td><strong>${escaparHtml(e.equipo)}</strong></td>
      <td>${escaparHtml(e.proyecto)}</td>
      <td>${pct(e.velocityPct)}</td>
      <td>${pct(e.avancePct)}</td>
      <td>${pct(e.desviacionPct)}</td>
      <td>${e.sprintsCerrados} sprint(s) cerrado(s)</td>
    </tr>`;
  }).join('');

  const conDatos = datos.equipos.filter((e) => e.estado === 'ok');
  const avisoComparable = datos.comparable ? '' : `<ul class="imp-lista" style="margin-bottom: 16px;">
    <li class="imp imp--baja" role="status"><div class="imp__titulo">Para comparar hacen falta al menos ${datos.minimoEquipos} equipos con datos suficientes. Ahora mismo solo hay
    ${conDatos.length}. Los equipos sin sprints cerrados no entran en el promedio.</div></li>
  </ul>`;

  const notaGrafica = conDatos.length && datos.equipos.length > conDatos.length
    ? '<p class="comparativo__nota-grafica">Solo se grafican los equipos con datos suficientes.</p>'
    : '';

  const referencia = datos.referencia || {};
  const pie = Number.isFinite(referencia.velocity)
    ? `<p class="comparativo__referencia">Promedio de los equipos con datos: velocity ${referencia.velocity} pts ·
      avance ${pct(referencia.avancePct)} · desviación ${pct(referencia.desviacionPct)}.</p>`
    : '';

  contenedor.innerHTML = `
    ${avisoComparable}
    ${graficaComparativo(conDatos)}
    ${notaGrafica}
    <div class="comparativo__tabla-contenedor">
      <table class="comparativo__tabla">
        <thead>
          <tr>
            <th>Equipo</th>
            <th>Proyecto</th>
            <th>Velocity</th>
            <th>Avance</th>
            <th>Desviación</th>
            <th>Sprints cerrados</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    ${pie}
  `;
}

/**
 * Mostrar el aviso de acceso denegado cuando el backend responde 403.
 * @returns {void}
 */
function mostrarSinAcceso() {
  if (seccion) seccion.hidden = true;
  if (avisoSinAcceso) avisoSinAcceso.hidden = false;
}

/**
 * Cargar el comparativo y dibujarlo, con reintento si la carga falla.
 * @returns {Promise<void>}
 */
async function cargarComparativo() {
  contenedor.innerHTML = '<span class="esqueleto metricas__esqueleto"></span>';
  try {
    const datos = await api('/comparativo/resumen');
    dibujarComparativo(datos);
  } catch (error) {
    if (error.estado === 403) return mostrarSinAcceso();
    contenedor.innerHTML = `<div class="alerta alerta--error metricas__error" role="alert">
      <span>${escaparHtml(error.cuerpo?.mensaje || 'No se pudo cargar el comparativo.')}</span>
      <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar="comparativo">Reintentar</button>
    </div>`;
  }
}

/**
 * Función principal de arranque.
 * @returns {Promise<void>}
 */
async function iniciar() {
  await montarLayout();

  document.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-reintentar="comparativo"]');
    if (boton) cargarComparativo();
  });

  await cargarComparativo();
}

iniciar();
