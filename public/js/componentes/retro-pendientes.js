// Responsable: Diego - HU-14: recordatorio de acciones pendientes de la retro (lo usan la retrospectiva y el ciclo del sprint)
/**
 * Pintar el recordatorio de acciones de retros anteriores que siguen sin completar.
 *   - Se muestra solo si hay un sprint activo y acciones pendientes; si no, el contenedor queda oculto.
 *   - Cada acción lleva su responsable y fecha; las vencidas se resaltan (el servidor las escala al Scrum Master).
 *   - El responsable (o el Scrum Master) la marca como completada y sale de los pendientes.
 *   - El Scrum Master ve las de todo el equipo; los demás roles solo las suyas (lo decide el servidor).
 *
 * @author Diego Rafael Jimenez Trujano
 */
import { api } from '../core/api.js';
import { escaparHtml, pluralizar } from '../core/utils.js';

/**
 * Dar formato corto a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @returns {string}
 */
const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Pintar una acción pendiente.
 *
 * @param {Object} a - Acción tal como la devuelve la API.
 * @returns {string}
 */
function pintarAccion(a) {
  const retraso = a.vencida
    ? `<span class="insignia insignia--peligro">Vencida hace ${a.diasRetraso} ${pluralizar(a.diasRetraso, 'día', 'días')}</span>`
    : '';
  return `<li class="retro-pendiente${a.vencida ? ' retro-pendiente--vencida' : ''}">
    <div class="retro-pendiente__texto">
      <span>${escaparHtml(a.texto)}</span>
      <span class="retro-pendiente__meta">${escaparHtml(a.responsable_nombre || 'Sin responsable')} · límite ${a.fecha_limite ? fechaCorta(a.fecha_limite) : 'sin fecha'} · de ${escaparHtml(a.sprint_origen)}</span>
    </div>
    ${retraso}
    <button class="boton boton--secundario boton--pequeno" type="button" data-completar="${a.id}">Marcar como completada</button>
  </li>`;
}

/**
 * Consultar y pintar el recordatorio dentro de un contenedor. Las acciones del contenedor se manejan por
 * delegación, así que es seguro llamarla varias veces sobre el mismo contenedor.
 *
 * @param {HTMLElement} contenedor
 * @param {number} proyectoId
 * @returns {Promise<{sprint: (Object|null), verTodas: boolean, acciones: Array}|null>} null si no se pudo consultar.
 */
export async function pintarPendientes(contenedor, proyectoId) {
  contenedor.dataset.proyecto = String(proyectoId);
  if (!contenedor.dataset.listo) {
    contenedor.dataset.listo = 'true';
    contenedor.addEventListener('click', async (evento) => {
      const boton = evento.target.closest('[data-completar]');
      if (!boton) return;
      boton.disabled = true;
      try {
        await api(`/retros/acciones/${boton.dataset.completar}/completar`, { metodo: 'POST' });
      } catch { /* si falla, la lista se vuelve a pintar tal como está en el servidor */ }
      await pintarPendientes(contenedor, Number(contenedor.dataset.proyecto));
    });
  }

  let datos;
  try {
    datos = await api(`/retros/proyecto/${proyectoId}/pendientes`);
  } catch {
    contenedor.hidden = true;
    contenedor.innerHTML = '';
    return null;
  }

  contenedor.hidden = datos.acciones.length === 0;
  contenedor.innerHTML = datos.acciones.length
    ? `<section class="tarjeta retro-pendientes" aria-labelledby="retro-pendientes-titulo">
        <h2 class="daily__titulo" id="retro-pendientes-titulo">Compromisos pendientes de retros anteriores</h2>
        <p class="daily__ayuda">${datos.verTodas ? 'Acciones del equipo que siguen sin completar en' : 'Tus acciones sin completar en'} ${escaparHtml(datos.sprint.nombre)}. Las vencidas se escalan al Scrum Master.</p>
        <ul class="retro-pendientes__lista">${datos.acciones.map(pintarAccion).join('')}</ul>
      </section>`
    : '';
  return datos;
}
