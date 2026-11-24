/**
 * @file burndown.js
 * @description Dibujar la gráfica de Burndown diaria, en horas o en puntos: de UN sprint
 * (con ?sprintId) o acumulada de todo el proyecto (sin sprintId, «Todo el proyecto»).
 * La línea real baja con el quemado registrado cada día (horas reales de registros_horas
 * o puntos aceptados en el Review) y la ideal es diaria, del total inicial a 0 el último
 * día del ámbito. Debajo va el resumen por cierre de sprint de todo el proyecto.
 *
 * @author Dana Carmona Santamaria
 */

import { escaparHtml } from '../../core/utils.js';

/** Formatear un valor: entero sin decimales, con decimal solo si lo necesita. */
function formatearNumero(valor) {
  const n = Number(valor);
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

/** Formatear una fecha YYYY-MM-DD como DD/MM para el eje X. */
function formatearDia(fecha) {
  const [anio, mes, dia] = String(fecha).split('-');
  return dia && mes ? `${dia}/${mes}` : String(fecha);
}

/** Formatear una fecha YYYY-MM-DD como DD/MM/AAAA para el encabezado. */
function formatearFecha(fecha) {
  const [anio, mes, dia] = String(fecha).split('-');
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : String(fecha);
}

/**
 * Dibuja la gráfica de Burndown en el contenedor SVG.
 *
 * @param {HTMLElement} contenedor El elemento que contendrá el SVG del burndown.
 * @param {Object} datos Respuesta de GET /api/metricas/proyectos/:proyectoId/burndown?sprintId=N&unidad=horas|puntos.
 * @param {Object} [opciones]
 * @param {Function} [opciones.alCambiarUnidad] Se llama con 'horas' o 'puntos' al pulsar el cambio de unidad.
 * @param {boolean} [opciones.integranteFiltrado] true si la vista actual filtra por un integrante.
 */
export function dibujarBurndown(contenedor, datos, opciones = {}) {
  const unidad = datos.unidad === 'puntos' ? 'puntos' : 'horas';
  const esPuntos = unidad === 'puntos';
  const sufijo = esPuntos ? 'pts' : 'h';
  const inicial = esPuntos ? datos.puntosIniciales : datos.horasIniciales;
  const sprint = datos.sprint || null;

  const tituloUnidad = esPuntos ? 'Burndown por puntos' : 'Burndown por horas';

  if (datos.vacio || !datos.dias || datos.dias.length === 0) {
    contenedor.innerHTML = `<div class="aviso aviso--vacio">
      <h3 class="aviso__titulo">Aún no hay datos de burndown</h3>
      <p class="aviso__texto">${sprint
        ? `El sprint ${escaparHtml(sprint.nombre)} no tiene ${esPuntos ? 'puntos en sus historias' : 'horas estimadas en sus tareas'}.`
        : 'El proyecto no tiene sprints registrados.'}</p>
    </div>`;
    return;
  }

  const dias = datos.dias;

  // --- Avisos: por qué la línea real puede no bajar, y qué no cuenta en el total ---
  const avisos = [];
  if (!esPuntos && datos.sinHorasReales) {
    avisos.push({ clase: 'imp--media', texto: `Aún no hay horas reales registradas ${sprint ? 'en este sprint' : 'en el proyecto'}: la línea real no baja hasta que se registren horas. Marcar una tarea como Hecho, sin registrar horas, no la mueve.` });
  }
  if (!esPuntos && datos.tareasSinEstimar > 0) {
    avisos.push({ clase: 'imp--baja', texto: `${datos.tareasSinEstimar} ${datos.tareasSinEstimar === 1 ? 'tarea sin horas estimadas no se cuenta' : 'tareas sin horas estimadas no se cuentan'} en el total inicial.` });
  }
  if (esPuntos && datos.historiasSinPuntos > 0) {
    avisos.push({ clase: 'imp--baja', texto: `${datos.historiasSinPuntos} ${datos.historiasSinPuntos === 1 ? 'historia sin puntos no se cuenta' : 'historias sin puntos no se cuentan'} en el total inicial.` });
  }
  if (esPuntos) {
    avisos.push({ clase: 'imp--baja', texto: 'La línea real solo baja con las historias aceptadas en el Review, igual que la velocity. Una historia en Hecho sin Review sigue contando hasta su aceptación.' });
  }
  if (esPuntos && opciones.integranteFiltrado) {
    avisos.push({ clase: 'imp--baja', texto: 'Los puntos son del equipo: el filtro de integrante no aplica a esta gráfica.' });
  }
  const htmlAvisos = avisos.length
    ? `<ul class="imp-lista" style="margin-bottom: 16px;">${avisos.map((a) =>
      `<li class="imp ${a.clase}" role="status"><div class="imp__titulo">${escaparHtml(a.texto)}</div></li>`).join('')}</ul>`
    : '';

  // --- Resumen del sprint: inicial, restante hoy y quemado total ---
  const ultimoReal = [...dias].reverse().find((d) => d.restante !== null && d.restante !== undefined);
  const restanteHoy = ultimoReal ? ultimoReal.restante : null;
  const quemadoTotal = esPuntos ? datos.puntosAceptadosTotales : datos.horasRealesTotales;
  const resumen = [
    `<span><strong>${formatearNumero(inicial)} ${sufijo}</strong> iniciales</span>`,
    restanteHoy !== null ? `<span><strong>${formatearNumero(restanteHoy)} ${sufijo}</strong> restantes hoy</span>` : '',
    quemadoTotal !== null && quemadoTotal !== undefined
      ? `<span><strong>${formatearNumero(quemadoTotal)} ${sufijo}</strong> ${esPuntos ? 'aceptados' : 'reales registradas'}</span>` : '',
    esPuntos ? `<span><strong>${formatearNumero(datos.puntosNoTerminados ?? 0)} ${sufijo}</strong> en historias no terminadas</span>` : '',
  ].filter(Boolean).join(' · ');

  // --- Gráfica diaria ---
  const ANCHO_SVG = 800;
  const ALTO_SVG = 420;
  const MARGEN = { izq: 70, der: 40, arriba: 50, abajo: 80 };
  const ANCHO_GRAFICA = ANCHO_SVG - MARGEN.izq - MARGEN.der;
  const ALTO_GRAFICA = ALTO_SVG - MARGEN.arriba - MARGEN.abajo;

  const maxRestantes = Math.max(...dias.map((d) => d.restante ?? 0), ...dias.map((d) => d.ideal ?? 0), inicial || 0, 10);
  const pasoY = maxRestantes <= 25 ? 5 : maxRestantes <= 100 ? 20 : 50;
  const maxEscala = Math.max(pasoY, Math.ceil(maxRestantes / pasoY) * pasoY);

  // Un punto por día; con sprints largos se etiqueta uno de cada varios días.
  const n = dias.length;
  const cadaEtiqueta = Math.max(1, Math.ceil(n / 10));
  const espacioX = n > 1 ? ANCHO_GRAFICA / (n - 1) : 0;
  const xPos = (i) => (n > 1 ? MARGEN.izq + i * espacioX : MARGEN.izq + ANCHO_GRAFICA / 2);
  const yPos = (valor) => MARGEN.arriba + ALTO_GRAFICA - (valor / maxEscala) * ALTO_GRAFICA;
  const radio = n > 15 ? 3.5 : 5;

  let rejillaY = '';
  for (let v = 0; v <= maxEscala; v += pasoY) {
    const y = yPos(v);
    rejillaY += `<line x1="${MARGEN.izq}" x2="${ANCHO_SVG - MARGEN.der}" y1="${y}" y2="${y}" stroke="#e2e8f0" stroke-width="1" />
      <text x="${MARGEN.izq - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#64748b">${v}</text>`;
  }

  // Línea ideal: punteada, todos los días del sprint (también los futuros).
  const puntosIdeal = dias.map((d, i) => `${xPos(i)},${yPos(d.ideal)}`);
  let textosIdeal = '';
  dias.forEach((d, i) => {
    if (i % cadaEtiqueta !== 0 && i !== n - 1) return;
    textosIdeal += `<text x="${xPos(i)}" y="${yPos(d.ideal) + 18}" text-anchor="middle" font-size="11" fill="#64748b">${formatearNumero(d.ideal)}</text>`;
  });

  // Línea real: solo hasta hoy (los días futuros llevan restante null y no se dibujan).
  const puntosReal = [];
  let circulosReal = '';
  let textosReal = '';
  let etiquetasX = '';
  let ultimoIndiceReal = -1;
  dias.forEach((d, i) => {
    const x = xPos(i);
    etiquetasX += `<line x1="${x}" x2="${x}" y1="${yPos(0)}" y2="${yPos(0) + 6}" stroke="#94a3b8" stroke-width="1.5" />`;
    if (i % cadaEtiqueta === 0 || i === n - 1) {
      etiquetasX += `<text x="${x}" y="${yPos(0) + 24}" text-anchor="middle" font-size="12" fill="#334155">${formatearDia(d.fecha)}</text>`;
    }
    if (d.restante === null || d.restante === undefined) return;
    ultimoIndiceReal = i;
    const y = yPos(Number(d.restante));
    puntosReal.push(`${x},${y}`);
    circulosReal += `<circle cx="${x}" cy="${y}" r="${radio}" fill="#1F5A67" stroke="#ffffff" stroke-width="2">
      <title>${formatearFecha(d.fecha)}: ${formatearNumero(d.restante)} ${sufijo} restantes</title>
    </circle>`;
    if (i % cadaEtiqueta === 0 || i === n - 1) {
      textosReal += `<text x="${x}" y="${y - 10}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1F5A67">${formatearNumero(d.restante)}</text>`;
    }
  });
  // El valor del último día real siempre se muestra, aunque no caiga en una etiqueta.
  if (ultimoIndiceReal >= 0 && ultimoIndiceReal % cadaEtiqueta !== 0 && ultimoIndiceReal !== n - 1) {
    const d = dias[ultimoIndiceReal];
    textosReal += `<text x="${xPos(ultimoIndiceReal)}" y="${yPos(Number(d.restante)) - 10}" text-anchor="middle" font-size="11" font-weight="bold" fill="#1F5A67">${formatearNumero(d.restante)}</text>`;
  }

  const ejeY = `<line x1="${MARGEN.izq}" y1="${MARGEN.arriba}" x2="${MARGEN.izq}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;
  const ejeX = `<line x1="${MARGEN.izq}" y1="${yPos(0)}" x2="${ANCHO_SVG - MARGEN.der}" y2="${yPos(0)}" stroke="#94a3b8" stroke-width="1.5"/>`;
  const centroY = MARGEN.arriba + (ALTO_GRAFICA / 2);
  const tituloEjeY = `<text x="-${centroY}" y="22" transform="rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">${esPuntos ? 'Puntos restantes' : 'Horas restantes'}</text>`;
  const tituloEjeX = `<text x="${MARGEN.izq + (ANCHO_GRAFICA / 2)}" y="${ALTO_SVG - 16}" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">${sprint ? 'Día del sprint' : 'Día del proyecto'}</text>`;

  // --- Vista general: restante por cierre de sprint, en horas y en puntos ---
  const filasPorSprint = (datos.porSprint || []).map((p) => `
    <tr>
      <td style="padding: 6px 12px 6px 0;">${p.id ?? '—'}</td>
      <td style="padding: 6px 12px 6px 0;">${escaparHtml(p.nombre)}</td>
      <td style="padding: 6px 12px;">${escaparHtml(p.estado || '—')}</td>
      <td style="padding: 6px 12px; text-align: right;">${p.horasRestantes === null || p.horasRestantes === undefined ? '—' : `${formatearNumero(p.horasRestantes)} h`}</td>
      <td style="padding: 6px 0 6px 12px; text-align: right;">${p.puntosRestantes === null || p.puntosRestantes === undefined ? '—' : `${formatearNumero(p.puntosRestantes)} pts`}</td>
    </tr>`).join('');
  const htmlPorSprint = filasPorSprint
    ? `<div style="margin-top: 24px;">
      <h3 style="font-size: 15px; margin: 0 0 8px 0;">Resumen por sprint</h3>
      <table style="border-collapse: collapse; font-size: 13px; color: #334155;">
        <thead><tr style="text-align: left; color: #64748b;">
          <th style="padding: 6px 12px 6px 0; font-weight: 600;">ID</th>
          <th style="padding: 6px 12px 6px 0; font-weight: 600;">Sprint</th>
          <th style="padding: 6px 12px; font-weight: 600;">Estado</th>
          <th style="padding: 6px 12px; font-weight: 600; text-align: right;">Horas restantes</th>
          <th style="padding: 6px 0 6px 12px; font-weight: 600; text-align: right;">Puntos restantes</th>
        </tr></thead>
        <tbody>${filasPorSprint}</tbody>
      </table>
    </div>`
    : '';

  contenedor.innerHTML = `
    <div class="metricas__cabecera" style="margin-bottom: 16px;">
      <div>
        <h2 class="metricas__titulo">${tituloUnidad}</h2>
        <p class="subtitulo-pagina">${sprint
          ? `${escaparHtml(sprint.nombre)} · ${formatearFecha(sprint.fechaInicio)} – ${formatearFecha(sprint.fechaFin)} · ${resumen}`
          : `Todo el proyecto · ${formatearFecha(datos.fechaInicio)} – ${formatearFecha(datos.fechaFin)} · ${resumen}`}</p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;" role="group" aria-label="Unidad del burndown">
        <button class="boton ${esPuntos ? 'boton--secundario' : 'boton--primario'} boton--pequeno" type="button" data-unidad-burndown="horas" aria-pressed="${!esPuntos}">Horas</button>
        <button class="boton ${esPuntos ? 'boton--primario' : 'boton--secundario'} boton--pequeno" type="button" data-unidad-burndown="puntos" aria-pressed="${esPuntos}">Puntos</button>
      </div>
    </div>
    ${htmlAvisos}
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
        Línea ideal (${sufijo})
      </span>
      <span style="display: inline-flex; align-items: center; gap: 8px;">
        <span style="width: 24px; height: 12px; display: inline-flex; align-items: center; justify-content: center; position: relative;">
          <span style="width: 24px; height: 3.5px; background: #1F5A67; position: absolute;"></span>
          <span style="width: 8px; height: 8px; background: #1F5A67; border-radius: 50%; z-index: 1;"></span>
        </span>
        Real restante (${sufijo})
      </span>
    </div>
    ${htmlPorSprint}
  `;

  // El cambio de unidad lo gestiona metricas.js (recarga la gráfica con la otra unidad).
  if (opciones.alCambiarUnidad) {
    contenedor.querySelectorAll('[data-unidad-burndown]').forEach((boton) => {
      boton.addEventListener('click', () => {
        if (boton.dataset.unidadBurndown !== unidad) opciones.alCambiarUnidad(boton.dataset.unidadBurndown);
      });
    });
  }
}
