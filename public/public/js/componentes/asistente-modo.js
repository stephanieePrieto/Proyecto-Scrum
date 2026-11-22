// Responsable: Alfonso - HU-26: asistente guiado para cambiar un proyecto entre Scrum y flujo continuo.
/**
 * @file asistente-modo.js
 * @description Asistente de la HU-26 para cambiar el modo de trabajo de un proyecto (Scrum <-> continuo).
 *  1. Pide al servidor el resumen previo (tareas abiertas por columna, sprint activo, historias en sprint).
 *  2. Si hay un sprint activo y se quiere pasar a continuo, bloquea el cambio y ofrece ir a Sprints a cerrarlo.
 *  3. Si se puede, exige marcar una casilla de confirmación explícita antes de habilitar el botón.
 *  4. Envía el cambio con la versión que la persona vio: si alguien cambió el proyecto antes, avisa y recarga el resumen.
 *
 * Usa un <dialog> con las clases .eq-dialogo (equipos.css) y estilos propios en modo-flujo.css.
 * Los textos que vienen del usuario (nombres de columnas y sprints) pasan por escaparHtml.
 *
 * Uso:
 *   import { abrirAsistenteModo } from '../componentes/asistente-modo.js';
 *   abrirAsistenteModo({ proyectoId, alCambiar: (resultado) => { ... } });
 *
 * @author Alfonso Mendoza Vasquez
 */

import { api } from '../core/api.js';
import { escaparHtml } from '../core/utils.js';

/** Nombres visibles de cada modo. */
export const NOMBRES_MODO = Object.freeze({ scrum: 'Scrum (con sprints)', continuo: 'Flujo continuo (Kanban)' });

const ID_DIALOGO = 'dialogo-modo-flujo';

/** Estado del asistente abierto. */
let estado = { proyectoId: null, resumen: null, alCambiar: null, enviando: false };

/**
 * Crea el <dialog> la primera vez y lo devuelve.
 * @returns {HTMLDialogElement}
 */
function obtenerDialogo() {
  let dialogo = document.getElementById(ID_DIALOGO);
  if (dialogo) return dialogo;

  dialogo = document.createElement('dialog');
  dialogo.id = ID_DIALOGO;
  dialogo.className = 'eq-dialogo eq-dialogo--ancho';
  dialogo.setAttribute('aria-labelledby', `${ID_DIALOGO}-titulo`);
  dialogo.innerHTML = `
    <h2 class="eq-dialogo__titulo" id="${ID_DIALOGO}-titulo">Cambiar modo de trabajo</h2>
    <div data-modo-cuerpo aria-live="polite"></div>
    <p class="modo-flujo__error" data-modo-error role="alert"></p>
    <div class="eq-dialogo__acciones">
      <button type="button" class="boton boton--secundario" data-modo-cancelar>Cancelar</button>
      <button type="button" class="boton boton--primario" data-modo-confirmar disabled>Cambiar modo</button>
    </div>`;
  document.body.appendChild(dialogo);

  dialogo.querySelector('[data-modo-cancelar]').addEventListener('click', () => dialogo.close());
  dialogo.querySelector('[data-modo-confirmar]').addEventListener('click', enviarCambio);
  dialogo.addEventListener('change', (evento) => {
    if (evento.target.matches('[data-modo-casilla]')) actualizarBoton();
  });
  return dialogo;
}

/** Habilita "Cambiar modo" solo si el cambio está permitido y la casilla está marcada. */
function actualizarBoton() {
  const dialogo = obtenerDialogo();
  const casilla = dialogo.querySelector('[data-modo-casilla]');
  const permitido = estado.resumen?.resultado === 'permitido';
  dialogo.querySelector('[data-modo-confirmar]').disabled = estado.enviando || !permitido || !casilla?.checked;
}

/** Muestra un error dentro del asistente. */
function mostrarError(texto) {
  obtenerDialogo().querySelector('[data-modo-error]').textContent = texto || '';
}

/** Mensaje legible para un error de la API. */
function mensajeDeError(error) {
  if (error?.estado === 403) return 'Solo el Scrum Master o quien creó el proyecto puede cambiar el modo de trabajo.';
  if (error?.estado === 404) return 'No encontramos este proyecto.';
  if (!error?.estado) return 'Sin conexión. Inténtalo de nuevo al reconectar.';
  return error.cuerpo?.mensaje || 'No se pudo completar la acción. Inténtalo de nuevo.';
}

/**
 * Qué cambia y qué no, según el modo destino.
 * @param {Object} r Resumen del servidor.
 * @returns {string} HTML.
 */
function textoConsecuencias(r) {
  if (r.destino === 'continuo') {
    const planificados = r.sprintsPlanificados
      ? `<li><span>Los ${r.sprintsPlanificados} sprint(s) planificado(s) se conservan, pero no se usan mientras el proyecto esté en continuo.</span></li>`
      : '';
    return `<p>Al pasar a flujo continuo:</p>
      <ul class="modo-flujo__lista">
        <li><span>El tablero deja de mostrar el sprint, sus fechas y los días restantes.</span></li>
        <li><span>Las tarjetas que no tienen columna se muestran en la primera columna.</span></li>
        <li><span>El Scrum Master puede crear tareas desde el tablero sin asignarlas a un sprint.</span></li>
        <li><span>Velocity, Burndown y Burnup muestran un aviso; se usan Lead Time y Cycle Time.</span></li>
        ${planificados}
      </ul>`;
  }
  return `<p>Al volver a Scrum:</p>
    <ul class="modo-flujo__lista">
      <li><span>El tablero vuelve a mostrar el sprint activo y sus fechas.</span></li>
      <li><span>Las tareas creadas sin sprint se conservan. Para editarlas desde Planificación, asigna su historia a un sprint.</span></li>
      <li><span>Velocity, Burndown y Burnup vuelven a mostrarse con los sprints cerrados.</span></li>
    </ul>`;
}

/**
 * Dibuja el resumen previo y, según la regla del servidor, la confirmación o el bloqueo.
 * @param {Object} r Resumen de GET /flujo-continuo/proyectos/:id/resumen-migracion.
 */
function dibujarResumen(r) {
  const dialogo = obtenerDialogo();
  const destino = NOMBRES_MODO[r.destino] || r.destino;
  dialogo.querySelector(`#${ID_DIALOGO}-titulo`).textContent = `Cambiar a ${destino}`;
  dialogo.querySelector('[data-modo-confirmar]').textContent = r.destino === 'continuo' ? 'Pasar a flujo continuo' : 'Volver a Scrum';

  const columnas = r.tareasPorColumna.map((c) =>
    `<li><span>${escaparHtml(c.nombre)}</span><strong>${c.tareas}</strong></li>`).join('');
  const sinColumna = r.tareasSinColumna
    ? `<li><span>Sin columna (en el backlog)</span><strong>${r.tareasSinColumna}</strong></li>`
    : '';
  const sprint = r.sprintActivo
    ? `${escaparHtml(r.sprintActivo.nombre)} (termina ${escaparHtml(r.sprintActivo.fechaFin || '')})`
    : 'Ninguno';

  const bloqueo = r.resultado === 'bloqueado'
    ? `<div class="modo-flujo__bloqueo" role="alert">
        <strong>No se puede cambiar todavía.</strong> ${escaparHtml(r.mensaje)}
        Cierra el sprint «${escaparHtml(r.sprintActivo?.nombre || '')}» desde
        <a href="/pages/sprint-detalle.html">Ejecución → Ciclo</a> (botón «Cerrar sprint») y vuelve a abrir este asistente.
      </div>`
    : '';

  const confirmar = r.resultado === 'permitido'
    ? `<label class="modo-flujo__confirmar">
        <input type="checkbox" data-modo-casilla />
        <span>Entiendo el cambio y quiero que «${escaparHtml(r.nombre)}» trabaje en ${escaparHtml(destino.toLowerCase())}.</span>
      </label>`
    : '';

  dialogo.querySelector('[data-modo-cuerpo]').innerHTML = `
    <p class="subtitulo-pagina">Modo actual: <strong>${escaparHtml(NOMBRES_MODO[r.modoActual] || r.modoActual)}</strong></p>
    <p style="margin-top: 12px;">Tareas abiertas (${r.tareasAbiertas}) por columna:</p>
    <ul class="modo-flujo__lista">
      ${columnas || '<li><span>El tablero no tiene columnas abiertas.</span></li>'}
      ${sinColumna}
    </ul>
    <ul class="modo-flujo__lista">
      <li><span>Sprint activo</span><strong>${sprint}</strong></li>
      <li><span>Historias en un sprint planificado o activo</span><strong>${r.historiasEnSprint}</strong></li>
      <li><span>Sprints cerrados</span><strong>${r.sprintsCerrados}</strong></li>
    </ul>
    ${bloqueo}
    ${r.resultado === 'bloqueado' ? '' : textoConsecuencias(r)}
    <p class="modo-flujo__garantia">No se borra ni se modifica ninguna tarea, historia, historial ni sprint cerrado.
      Solo cambia el modo del proyecto, y el cambio queda registrado en la bitácora.</p>
    ${confirmar}`;
  actualizarBoton();
}

/** Pide el resumen al servidor y lo dibuja. */
async function cargarResumen() {
  const dialogo = obtenerDialogo();
  dialogo.querySelector('[data-modo-cuerpo]').innerHTML = '<p class="subtitulo-pagina">Revisando el proyecto…</p>';
  estado.resumen = null;
  actualizarBoton();
  try {
    const respuesta = await api(`/flujo-continuo/proyectos/${estado.proyectoId}/resumen-migracion`);
    estado.resumen = respuesta.datos;
    dibujarResumen(estado.resumen);
  } catch (error) {
    dialogo.querySelector('[data-modo-cuerpo]').innerHTML = '';
    mostrarError(mensajeDeError(error));
  }
}

/** Envía el cambio de modo con la versión que la persona vio y la confirmación explícita. */
async function enviarCambio() {
  const r = estado.resumen;
  const casilla = obtenerDialogo().querySelector('[data-modo-casilla]');
  if (estado.enviando || !r || r.resultado !== 'permitido' || !casilla?.checked) return;

  estado.enviando = true;
  mostrarError('');
  actualizarBoton();
  try {
    const respuesta = await api(`/flujo-continuo/proyectos/${estado.proyectoId}/modo`, {
      metodo: 'POST',
      cuerpo: { modo: r.destino, version: r.version, confirmar: true },
    });
    obtenerDialogo().close();
    if (typeof estado.alCambiar === 'function') estado.alCambiar(respuesta.datos);
  } catch (error) {
    const motivo = error?.cuerpo?.detalles?.motivo;
    if (error?.estado === 409 && (motivo === 'conflicto_version' || motivo === 'sprint_activo')) {
      // Alguien cambió el proyecto o inició un sprint: se vuelve a mostrar el resumen actualizado
      await cargarResumen();
      mostrarError(motivo === 'conflicto_version'
        ? 'Otra persona modificó el proyecto mientras revisabas. Este es el resumen actualizado; revísalo y confirma de nuevo.'
        : error.cuerpo.mensaje);
    } else {
      mostrarError(mensajeDeError(error));
    }
  } finally {
    estado.enviando = false;
    actualizarBoton();
  }
}

/**
 * Abre el asistente para un proyecto.
 * @param {Object} opciones
 * @param {number|string} opciones.proyectoId Proyecto a cambiar.
 * @param {(resultado: {cambio: boolean, proyectoId: number, modo: string, version: number}) => void} [opciones.alCambiar]
 *   Se llama después de un cambio exitoso.
 * @returns {Promise<void>}
 */
export async function abrirAsistenteModo({ proyectoId, alCambiar } = {}) {
  const dialogo = obtenerDialogo();
  estado = { proyectoId: Number(proyectoId), resumen: null, alCambiar, enviando: false };
  mostrarError('');
  if (!dialogo.open) dialogo.showModal();
  await cargarResumen();
}
