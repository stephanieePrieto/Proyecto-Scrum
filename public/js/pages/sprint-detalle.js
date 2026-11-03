// Responsable: Diego - HU-09: logica de la pantalla para iniciar y cerrar un sprint (llama a la API y escucha sockets)
/**
 * Pintar la pantalla del ciclo del sprint:
 *   - Iniciar un sprint planificado confirmando objetivo y capacidad; si falta algo, se indica qué.
 *   - Cerrar el sprint activo mostrando un resumen, la velocity y decidiendo qué pasa con las historias
 *     no terminadas y con las tarjetas en revisión.
 *   - Solo el Scrum Master puede iniciar o cerrar; el resto ve el estado en solo lectura.
 */
import { api } from '/js/core/api.js';
import { montarBarraSuperior } from '/js/core/layout.js';
import { escaparHtml, pluralizar } from '/js/core/utils.js';
import { resolverProyecto, conectarTiempoReal, pintarSelectorProyecto } from '/js/pages/ceremonias/proyecto.js';

montarBarraSuperior();

const el = {
  selectorProyecto: document.getElementById('selector-proyecto'),
  aviso: document.getElementById('aviso'),
  seccionActivo: document.getElementById('seccion-activo'),
  tarjetaActivo: document.getElementById('tarjeta-activo'),
  planificados: document.getElementById('lista-planificados'),
  dlgIniciar: document.getElementById('dialogo-iniciar'),
  formIniciar: document.getElementById('form-iniciar'),
  iniciarResumen: document.getElementById('iniciar-resumen'),
  objetivo: document.getElementById('campo-objetivo'),
  capacidad: document.getElementById('campo-capacidad'),
  iniciarFaltantes: document.getElementById('iniciar-faltantes'),
  iniciarError: document.getElementById('iniciar-error'),
  btnIniciar: document.getElementById('btn-confirmar-iniciar'),
  dlgCerrar: document.getElementById('dialogo-cerrar'),
  formCerrar: document.getElementById('form-cerrar'),
  cerrarContenido: document.getElementById('cerrar-contenido'),
  cerrarError: document.getElementById('cerrar-error'),
  btnCerrar: document.getElementById('btn-confirmar-cerrar'),
};

const ctx = { proyectoId: null, datos: null, sprintEnDialogo: null, resumen: null, enviando: false };

/* ====================================================================
 * Utilidades
 * ==================================================================== */

/**
 * Mostrar un aviso general arriba de la pantalla (o ocultarlo si no hay texto).
 *
 * @param {'exito'|'error'|'advertencia'|''} tono
 * @param {string} texto
 * @returns {void}
 */
function mostrarAviso(tono, texto) {
  el.aviso.hidden = !texto;
  el.aviso.className = `ciclo-aviso alerta alerta--${tono || 'advertencia'}`;
  el.aviso.textContent = texto;
}

/**
 * Dar formato corto a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @returns {string}
 */
const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Mostrar u ocultar el error de un campo por su id (`error-<campo>`).
 *
 * @param {string} campo
 * @param {string} [mensaje]
 * @returns {void}
 */
function errorDeCampo(campo, mensaje = '') {
  const parrafo = document.getElementById(`error-${campo}`);
  if (!parrafo) return;
  parrafo.hidden = !mensaje;
  parrafo.textContent = mensaje;
}

/* ====================================================================
 * Pantalla principal
 * ==================================================================== */

/**
 * Pintar el HTML de los datos de un sprint (fechas, historias, puntos y capacidad).
 *
 * @param {Object} s - Sprint tal como lo devuelve la API.
 * @returns {string}
 */
function datosDeSprint(s) {
  return `<div class="ciclo-sprint__datos">
    <span>${fechaCorta(s.fecha_inicio)} – ${fechaCorta(s.fecha_fin)}</span>
    <span>${s.historias} ${pluralizar(s.historias, 'historia', 'historias')} · ${s.puntos} pts</span>
    <span>Capacidad: ${s.capacidad_horas} h</span>
  </div>
  <p class="ciclo-sprint__objetivo">${s.objetivo ? escaparHtml(s.objetivo) : '<em>Sin objetivo todavía</em>'}</p>`;
}

/**
 * Pintar el sprint activo con su botón de cierre.
 *
 * @returns {void}
 */
function pintarActivo() {
  const { activo, puedeGestionar } = ctx.datos;
  el.seccionActivo.hidden = !activo;
  if (!activo) return;
  el.tarjetaActivo.innerHTML = `<article class="tarjeta ciclo-sprint ciclo-sprint--activo">
    <div class="ciclo-sprint__cabecera">
      <h3 class="ciclo-sprint__nombre">${escaparHtml(activo.nombre)} <span class="insignia insignia--exito">Activo</span></h3>
      ${puedeGestionar ? `<button class="boton boton--primario" type="button" data-cerrar-sprint="${activo.id}">Cerrar sprint</button>` : ''}
    </div>
    ${datosDeSprint(activo)}
  </article>`;
}

/**
 * Pintar los sprints planificados, con lo que les falta para iniciarse y su botón.
 *
 * @returns {void}
 */
function pintarPlanificados() {
  el.planificados.removeAttribute('aria-busy');
  const { planificados, puedeGestionar } = ctx.datos;
  if (!planificados.length) {
    el.planificados.innerHTML = '<p class="ciclo-vacio">No hay sprints planificados. Crea uno desde Sprints.</p>';
    return;
  }
  el.planificados.innerHTML = planificados.map((s) => {
    const faltantes = s.faltantes.length
      ? `<ul class="ciclo-faltantes">${s.faltantes.map((f) => `<li>${escaparHtml(f)}</li>`).join('')}</ul>`
      : '';
    const bloqueo = s.bloqueadoPorActivo ? '<p class="ciclo__ayuda">Ya hay un sprint activo: ciérralo antes de iniciar otro.</p>' : '';
    const boton = puedeGestionar
      ? `<button class="boton boton--secundario" type="button" data-iniciar="${s.id}"${s.bloqueadoPorActivo ? ' disabled' : ''}>Iniciar sprint</button>`
      : '';
    return `<article class="tarjeta ciclo-sprint">
      <div class="ciclo-sprint__cabecera">
        <h3 class="ciclo-sprint__nombre">${escaparHtml(s.nombre)} <span class="insignia insignia--neutro">Planificado</span></h3>
        ${boton}
      </div>
      ${datosDeSprint(s)}${faltantes}${bloqueo}
    </article>`;
  }).join('');
}

/**
 * Consultar el ciclo del proyecto y repintar la pantalla.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    ctx.datos = await api(`/ciclo-sprint/proyecto/${ctx.proyectoId}`);
  } catch (error) {
    el.planificados.removeAttribute('aria-busy');
    el.planificados.innerHTML = '';
    mostrarAviso('error', error.estado === 404
      ? 'No encontramos este proyecto o no tienes acceso a él.'
      : 'No pudimos cargar los sprints. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  if (!ctx.datos.puedeGestionar && el.aviso.hidden) {
    mostrarAviso('advertencia', 'Solo el Scrum Master puede iniciar o cerrar sprints. Aquí ves su estado.');
  }
  pintarActivo();
  pintarPlanificados();
}

document.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-cerrar]')) {
    evento.target.closest('dialog').close();
    return;
  }
  const iniciar = evento.target.closest('[data-iniciar]');
  if (iniciar) abrirIniciar(Number(iniciar.dataset.iniciar));
  const cerrar = evento.target.closest('[data-cerrar-sprint]');
  if (cerrar) abrirCerrar(Number(cerrar.dataset.cerrarSprint));
});

/* ====================================================================
 * Iniciar
 * ==================================================================== */

/**
 * Abrir el diálogo para iniciar un sprint, con su objetivo y capacidad actuales.
 *
 * @param {number} sprintId
 * @returns {void}
 */
function abrirIniciar(sprintId) {
  const sprint = ctx.datos.planificados.find((s) => s.id === sprintId);
  if (!sprint) return;
  ctx.sprintEnDialogo = sprint;
  el.iniciarResumen.textContent = `${sprint.nombre}: ${sprint.historias} ${pluralizar(sprint.historias, 'historia', 'historias')} · ${sprint.puntos} pts.`;
  el.objetivo.value = sprint.objetivo ?? '';
  el.capacidad.value = sprint.capacidad_horas || '';
  errorDeCampo('objetivo');
  errorDeCampo('capacidad_horas');
  el.iniciarFaltantes.hidden = true;
  el.iniciarError.hidden = true;
  el.dlgIniciar.showModal();
  el.objetivo.focus();
}

el.formIniciar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.enviando) return;
  ctx.enviando = true;
  el.btnIniciar.disabled = true;
  errorDeCampo('objetivo');
  errorDeCampo('capacidad_horas');
  el.iniciarFaltantes.hidden = true;
  el.iniciarError.hidden = true;

  try {
    await api(`/ciclo-sprint/sprint/${ctx.sprintEnDialogo.id}/iniciar`, {
      metodo: 'POST',
      cuerpo: { objetivo: el.objetivo.value, capacidad_horas: Number(el.capacidad.value) },
    });
    el.dlgIniciar.close();
    mostrarAviso('exito', 'Sprint iniciado. El tablero ya está habilitado.');
    await cargar();
  } catch (error) {
    const d = error.cuerpo?.detalles;
    if (error.estado === 400 && d) {
      errorDeCampo('objetivo', d.objetivo);
      errorDeCampo('capacidad_horas', d.capacidad_horas);
      if (d.faltantes?.length) {
        el.iniciarFaltantes.innerHTML = d.faltantes.map((f) => `<li>${escaparHtml(f)}</li>`).join('');
        el.iniciarFaltantes.hidden = false;
      }
    } else {
      el.iniciarError.textContent = error.cuerpo?.mensaje
        || 'No pudimos iniciar el sprint. Revisa tu conexión e inténtalo de nuevo.';
      el.iniciarError.hidden = false;
      if (error.estado === 409) await cargar(); // Otra persona ya lo inició: mostrar el estado real
    }
  } finally {
    ctx.enviando = false;
    el.btnIniciar.disabled = false;
  }
});

/* ====================================================================
 * Cerrar
 * ==================================================================== */

/**
 * Pintar el contenido del diálogo de cierre: resumen, velocity y decisiones pendientes.
 *
 * @returns {void}
 */
function pintarCierre() {
  const r = ctx.resumen;
  const revision = r.enRevision.length
    ? `<fieldset class="ciclo-decision">
        <legend>Hay tarjetas en revisión</legend>
        <ul>${r.enRevision.map((h) => `<li>HU-${h.numero_hu} ${escaparHtml(h.titulo)} (${h.tarjetas} ${pluralizar(h.tarjetas, 'tarjeta', 'tarjetas')})</li>`).join('')}</ul>
        <label><input type="radio" name="revision" value="hecho" /> Darlas por terminadas</label>
        <label><input type="radio" name="revision" value="pendiente" /> Dejarlas pendientes</label>
        <p class="ciclo-error" id="error-revision" hidden></p>
      </fieldset>`
    : '';
  const sinSiguiente = !r.siguiente;
  const destino = r.noTerminadas > 0 || r.enRevision.length
    ? `<fieldset class="ciclo-decision">
        <legend>Historias sin terminar</legend>
        <label><input type="radio" name="destino" value="backlog" /> Volver al backlog</label>
        <label><input type="radio" name="destino" value="siguiente"${sinSiguiente ? ' disabled' : ''} /> Pasar al siguiente sprint${r.siguiente ? ` (${escaparHtml(r.siguiente.nombre)})` : ''}</label>
        ${sinSiguiente ? '<p class="ciclo__ayuda">No existe un sprint siguiente. Créalo primero en Sprints para poder elegir esta opción.</p>' : ''}
        <p class="ciclo-error" id="error-destino" hidden></p>
      </fieldset>`
    : '';
  el.cerrarContenido.innerHTML = `
    <div class="ciclo-resumen">
      <div><strong>${r.terminadas}</strong><span>de ${r.total} ${pluralizar(r.total, 'historia terminada', 'historias terminadas')}</span></div>
      <div><strong>${r.velocity}</strong><span>velocity (pts)</span></div>
      <div><strong>${r.puntosTotales}</strong><span>pts comprometidos</span></div>
    </div>
    ${r.noTerminadas > 0 ? `<ul class="ciclo-lista-historias">${r.historias.filter((h) => !h.terminada).map((h) => `<li>HU-${h.numero_hu} ${escaparHtml(h.titulo)}</li>`).join('')}</ul>` : '<p class="ciclo__ayuda">Todas las historias están terminadas.</p>'}
    ${revision}${destino}`;
  el.btnCerrar.disabled = false;
}

/**
 * Abrir el diálogo de cierre y cargar el resumen actual del sprint.
 *
 * @param {number} sprintId
 * @returns {Promise<void>}
 */
async function abrirCerrar(sprintId) {
  ctx.sprintEnDialogo = { id: sprintId };
  el.cerrarContenido.innerHTML = '<p class="ciclo__ayuda">Calculando el resumen…</p>';
  el.cerrarError.hidden = true;
  el.btnCerrar.disabled = true;
  el.dlgCerrar.showModal();
  try {
    ctx.resumen = await api(`/ciclo-sprint/sprint/${sprintId}/resumen`);
    pintarCierre();
  } catch {
    el.cerrarContenido.innerHTML = '<p class="ciclo-error">No pudimos calcular el resumen. Cierra e inténtalo de nuevo.</p>';
  }
}

el.formCerrar.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.enviando) return;

  const valor = (nombre) => el.formCerrar.querySelector(`input[name="${nombre}"]:checked`)?.value;
  const cuerpo = { revision: valor('revision'), destino: valor('destino'), siguienteSprintId: ctx.resumen.siguiente?.id };

  // Validar en el navegador (el servidor repite las reglas)
  let faltan = false;
  if (ctx.resumen.enRevision.length && !cuerpo.revision) {
    errorDeCampo('revision', 'Decide qué hacer con las tarjetas en revisión.');
    faltan = true;
  }
  const hayPendientes = ctx.resumen.noTerminadas > 0 || (ctx.resumen.enRevision.length && cuerpo.revision === 'pendiente');
  if (hayPendientes && !cuerpo.destino) {
    errorDeCampo('destino', 'Elige si vuelven al backlog o pasan al siguiente sprint.');
    faltan = true;
  }
  if (faltan) return;

  ctx.enviando = true;
  el.btnCerrar.disabled = true;
  el.cerrarError.hidden = true;
  try {
    const r = await api(`/ciclo-sprint/sprint/${ctx.sprintEnDialogo.id}/cerrar`, { metodo: 'POST', cuerpo });
    el.dlgCerrar.close();
    mostrarAviso('exito', r.yaCerrado
      ? 'Este sprint ya estaba cerrado.'
      : `Sprint cerrado. Velocity: ${r.velocity} pts.${r.trasladadas ? ` ${r.trasladadas} ${pluralizar(r.trasladadas, 'historia pasó', 'historias pasaron')} a ${r.destino === 'backlog' ? 'el backlog' : r.destino}.` : ''}`);
    await cargar();
  } catch (error) {
    const d = error.cuerpo?.detalles;
    if (error.estado === 400 && d) {
      errorDeCampo('revision', d.revision);
      errorDeCampo('destino', d.destino ?? d.siguiente);
    } else {
      // El cierre es todo o nada: si falló, no cambió nada y se puede reintentar sin duplicar
      el.cerrarError.textContent = error.estado === undefined
        ? 'Se perdió la conexión. No se cambió nada: vuelve a intentarlo cuando se restablezca.'
        : error.cuerpo?.mensaje || 'No pudimos cerrar el sprint. No se cambió nada; inténtalo de nuevo.';
      el.cerrarError.hidden = false;
    }
    el.btnCerrar.disabled = false;
  } finally {
    ctx.enviando = false;
  }
});

/* ====================================================================
 * INICIO
 * ==================================================================== */

async function iniciar() {
  let eleccion;
  try {
    eleccion = await resolverProyecto();
  } catch {
    el.planificados.removeAttribute('aria-busy');
    mostrarAviso('error', 'No pudimos cargar tus proyectos. Revisa tu conexión o inicia sesión de nuevo.');
    return;
  }
  if (!eleccion.id) {
    el.planificados.removeAttribute('aria-busy');
    mostrarAviso('advertencia', 'Todavía no perteneces a ningún proyecto.');
    return;
  }
  ctx.proyectoId = eleccion.id;
  pintarSelectorProyecto(el.selectorProyecto, eleccion.proyectos, eleccion.id, escaparHtml, '/pages/sprint-detalle.html');
  await cargar();
  conectarTiempoReal(ctx.proyectoId, ['sprint:iniciado', 'sprint:cerrado'], cargar);
}

iniciar();
