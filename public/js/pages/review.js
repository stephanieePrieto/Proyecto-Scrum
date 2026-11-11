// Responsable: Diego - HU-12: logica de la pantalla de Sprint Review (aceptar o rechazar historias) (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de Sprint Review:
 *   - Tarea 1: el Product Owner (o su delegado) acepta o rechaza cada historia terminada; rechazar exige comentario y
 *     aceptar con criterios incompletos (3 de 4) pide confirmación. El resto de los roles solo ve las decisiones.
 *   - Tarea 2: la velocity del sprint se muestra en vivo (puntos aceptados) y se guarda en el servidor con cada decisión.
 *   - Tarea 3: el Scrum Master delega la aceptación en otra persona hasta un día; el delegado ve los botones mientras dure.
 *   - Lo que se estaba escribiendo (comentarios y criterios marcados) se conserva aunque otra persona decida y la pantalla se recargue.
 *
 * @author Diego Rafael Jimenez Trujano
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, pluralizar } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal, mostrarSinProyecto } from './ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
  subtitulo: document.getElementById('subtitulo'),
  selectorSprint: document.getElementById('selector-sprint'),
  insigniaRol: document.getElementById('insignia-rol'),
  aviso: document.getElementById('aviso'),
  banner: document.getElementById('banner-delegacion'),
  contenido: document.getElementById('contenido'),
  resumen: document.getElementById('resumen'),
  ayudaHistorias: document.getElementById('ayuda-historias'),
  listaHistorias: document.getElementById('lista-historias'),
  seccionPendientes: document.getElementById('seccion-pendientes'),
  listaPendientes: document.getElementById('lista-pendientes'),
  panelDelegacion: document.getElementById('panel-delegacion'),
  delegacionActual: document.getElementById('delegacion-actual'),
  formDelegacion: document.getElementById('form-delegacion'),
  delegado: document.getElementById('delegado'),
  delegacionHasta: document.getElementById('delegacion-hasta'),
  historial: document.getElementById('historial-delegaciones'),
  dialogo: document.getElementById('dialogo-criterios'),
  dialogoTexto: document.getElementById('criterios-texto'),
  btnAceptarIgual: document.getElementById('btn-aceptar-igual'),
};

const ETIQUETA_ROL = { scrum_master: 'Scrum Master', product_owner: 'Product Owner', developer: 'Desarrollador' };
const ETIQUETA_SPRINT = { activo: 'activo', cerrado: 'cerrado' };
const DECISION = {
  aceptada: { texto: 'Aceptada', insignia: 'insignia--exito' },
  rechazada: { texto: 'Rechazada', insignia: 'insignia--peligro' },
};
const DIAS_MAXIMOS_DELEGACION = 30;
const CAMPOS_DELEGACION = ['delegado_id', 'hasta', 'motivo'];

// Estado de la pantalla
const ctx = {
  proyectoId: null,
  sprintId: null,
  datos: null,
  borradores: new Map(),  // historia → { comentario, criterios:Set }: lo que se está escribiendo y no se ha enviado
  cambiando: new Set(),   // historias cuya decisión se está reabriendo
  confirmando: null,      // historia que espera confirmación por criterios incompletos
};

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
  el.aviso.className = `daily-aviso alerta alerta--${tono || 'advertencia'}`;
  el.aviso.textContent = texto;
}

/**
 * Mostrar u ocultar el error de un campo por el id de su párrafo.
 *
 * @param {string} id
 * @param {string} [mensaje]
 * @returns {void}
 */
function errorEnCampo(id, mensaje = '') {
  const parrafo = document.getElementById(id);
  if (!parrafo) return;
  parrafo.hidden = !mensaje;
  parrafo.textContent = mensaje;
}

/**
 * Mostrar el mensaje que devolvió la API en un aviso general (con uno propio si no trae mensaje).
 *
 * @param {Error & {estado?: number, cuerpo?: {mensaje?: string}}} error
 * @param {string} respaldo
 * @returns {void}
 */
function avisarError(error, respaldo) {
  mostrarAviso('error', error.estado === undefined
    ? 'No hay conexión con el servidor. Inténtalo de nuevo cuando se restablezca.'
    : error.cuerpo?.mensaje || respaldo);
}

const fechaCorta = (valor) => new Date(valor).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const fechaHora = (valor) => new Date(valor).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Último día de una delegación: el servidor guarda el inicio del día siguiente, así que se resta un minuto. */
const ultimoDia = (hasta) => fechaCorta(new Date(new Date(hasta).getTime() - 60 * 1000));

/**
 * Obtener (o crear) lo que la persona lleva escrito para una historia.
 *
 * @param {number} id
 * @returns {{comentario: string, criterios: Set<number>}}
 */
function borrador(id) {
  if (!ctx.borradores.has(id)) ctx.borradores.set(id, { comentario: '', criterios: new Set() });
  return ctx.borradores.get(id);
}

/* ====================================================================
 * Pintado de las historias
 * ==================================================================== */

/**
 * Pintar la lista de criterios solo para leer (quien no puede decidir).
 *
 * @param {Object} h - Historia tal como la devuelve la API.
 * @returns {string}
 */
const pintarCriteriosLectura = (h) => (h.criterios.length
  ? `<ul class="review-criterios-lectura">${h.criterios.map((c) => `<li>${escaparHtml(c)}</li>`).join('')}</ul>`
  : '');

/**
 * Pintar el formulario de decisión: criterios para marcar, comentario y botones.
 *
 * @param {Object} h - Historia tal como la devuelve la API.
 * @returns {string}
 */
function pintarFormulario(h) {
  const b = borrador(h.id);
  const criterios = h.criterios.length
    ? `<fieldset class="review-criterios">
        <legend>Criterios de aceptación: marca los que se cumplen</legend>
        ${h.criterios.map((c, i) => `<label class="review-criterio"><input type="checkbox" data-criterio="${i}"${b.criterios.has(i) ? ' checked' : ''} /> <span>${escaparHtml(c)}</span></label>`).join('')}
        <button class="boton boton--secundario boton--pequeno" type="button" data-marcar-todos="${h.id}">Marcar todos</button>
      </fieldset>`
    : '<p class="daily__ayuda">Esta historia no tiene criterios de aceptación registrados.</p>';
  return `${criterios}
    <div class="form-group">
      <label class="form-label" for="comentario-${h.id}">Comentario <span class="review-opcional">(obligatorio al rechazar)</span></label>
      <textarea class="form-input" id="comentario-${h.id}" data-comentario="${h.id}" rows="2" maxlength="500">${escaparHtml(b.comentario)}</textarea>
      <p class="daily-form__error" id="error-comentario-${h.id}" hidden></p>
    </div>
    <div class="review-acciones">
      <button class="boton boton--primario boton--pequeno" type="button" data-decidir="aceptada" data-historia="${h.id}">Aceptar</button>
      <button class="boton boton--secundario boton--peligro boton--pequeno" type="button" data-decidir="rechazada" data-historia="${h.id}">Rechazar</button>
      ${h.decision ? `<button class="boton boton--secundario boton--pequeno" type="button" data-cancelar-cambio="${h.id}">Cancelar</button>` : ''}
    </div>`;
}

/**
 * Pintar la decisión ya tomada: quién, cuándo, criterios cumplidos y comentario.
 *
 * @param {Object} h - Historia con `decision`.
 * @returns {string}
 */
function pintarDecision(h) {
  const d = h.decision;
  const cambiar = h.puedeDecidir && !ctx.cambiando.has(h.id)
    ? `<button class="boton boton--secundario boton--pequeno" type="button" data-cambiar="${h.id}">Cambiar decisión</button>`
    : '';
  return `<div class="review-decision">
    <p><span class="insignia ${DECISION[d.decision].insignia}">${DECISION[d.decision].texto}</span>
      por <strong>${escaparHtml(d.decididoPor || 'una persona que ya no está en el proyecto')}</strong>${d.comoDelegado ? ' (como delegado del Product Owner)' : ''} · ${fechaHora(d.decididoEn)}</p>
    ${d.criteriosTotal ? `<p class="review-detalle">${d.criteriosCumplidos} de ${d.criteriosTotal} ${pluralizar(d.criteriosTotal, 'criterio cumplido', 'criterios cumplidos')}</p>` : ''}
    ${d.comentario ? `<p class="retro-nota__texto">${escaparHtml(d.comentario)}</p>` : ''}
    ${cambiar}
  </div>`;
}

/**
 * Pintar la tarjeta de una historia terminada según el rol: formulario para quien decide, solo lectura para el resto.
 *
 * @param {Object} h - Historia tal como la devuelve la API.
 * @returns {string}
 */
function pintarHistoria(h) {
  const decision = h.decision?.decision;
  const abierta = h.puedeDecidir && (!h.decision || ctx.cambiando.has(h.id));
  const insignia = decision
    ? `<span class="insignia ${DECISION[decision].insignia}">${DECISION[decision].texto}</span>`
    : '<span class="insignia insignia--advertencia">Por revisar</span>';
  const cuerpo = [
    h.decision ? pintarDecision(h) : '',
    abierta ? pintarFormulario(h) : (!h.decision ? pintarCriteriosLectura(h) : ''),
  ].join('');
  return `<li class="retro-nota review-historia${decision ? ` review-historia--${decision}` : ''}" data-id="${h.id}">
    <div class="review-cabecera">
      <span><span class="review-id">HU-${h.numeroHu}</span> <strong>${escaparHtml(h.titulo)}</strong></span>
      <span class="review-meta">
        <span class="insignia insignia--neutro">${h.puntos ?? 0} pts</span>${insignia}
      </span>
    </div>
    <p class="review-detalle">${h.tareasHechas} de ${h.tareas} ${pluralizar(h.tareas, 'tarea', 'tareas')} en Hecho</p>
    ${cuerpo}
  </li>`;
}

/**
 * Pintar una historia que todavía no está en Hecho (solo se muestra, no se decide).
 *
 * @param {Object} h
 * @returns {string}
 */
const pintarPendiente = (h) => `<li class="retro-nota">
  <div class="review-cabecera">
    <span><span class="review-id">HU-${h.numeroHu}</span> <strong>${escaparHtml(h.titulo)}</strong></span>
    <span class="review-meta"><span class="insignia insignia--neutro">${h.puntos ?? 0} pts</span></span>
  </div>
  <p class="review-detalle">${h.tareasHechas} de ${h.tareas} ${pluralizar(h.tareas, 'tarea', 'tareas')} en Hecho</p>
</li>`;

/**
 * Pintar el resumen del sprint. La velocity son solo los puntos ACEPTADOS.
 *
 * @returns {void}
 */
function pintarResumen() {
  const { resumen: r } = ctx.datos;
  el.resumen.innerHTML = `
    <div><strong>${r.velocity}</strong><span>Velocity (puntos aceptados)</span></div>
    <div><strong>${r.aceptadas} / ${r.rechazadas}</strong><span>Aceptadas / rechazadas</span></div>
    <div><strong>${r.porRevisar}</strong><span>Por revisar (${r.puntosPorRevisar} pts)</span></div>`;
}

/**
 * Repintar la lista de historias sin perder el foco ni la posición del cursor de lo que se estaba escribiendo.
 *
 * @returns {void}
 */
function pintarHistorias() {
  const { historias, puedeDecidir } = ctx.datos;
  const terminadas = historias.filter((h) => h.terminada);
  const pendientes = historias.filter((h) => !h.terminada);

  const activo = document.activeElement;
  const foco = el.listaHistorias.contains(activo) ? { id: activo.id, inicio: activo.selectionStart, fin: activo.selectionEnd } : null;

  el.ayudaHistorias.textContent = puedeDecidir
    ? 'Marca los criterios que se cumplen y acepta o rechaza cada historia. Rechazar exige un comentario.'
    : 'Estas son las historias terminadas del sprint. Solo el Product Owner, o quien tenga su delegación, puede decidir.';
  el.listaHistorias.innerHTML = terminadas.length
    ? terminadas.map(pintarHistoria).join('')
    : '<li class="retro-vacio">Todavía no hay historias en Hecho para revisar.</li>';
  el.seccionPendientes.hidden = !pendientes.length;
  el.listaPendientes.innerHTML = pendientes.map(pintarPendiente).join('');

  if (foco?.id) {
    const nuevo = document.getElementById(foco.id);
    nuevo?.focus();
    if (nuevo && foco.inicio !== null && nuevo.setSelectionRange) nuevo.setSelectionRange(foco.inicio, foco.fin);
  }
}

/* ====================================================================
 * Rol, banner y panel de delegación
 * ==================================================================== */

/**
 * Mostrar con qué autoridad decide la persona (o que solo puede leer).
 *
 * @returns {void}
 */
function pintarRol() {
  const { decideComo, yo } = ctx.datos;
  el.insigniaRol.hidden = false;
  el.insigniaRol.className = `insignia ${decideComo ? 'insignia--primario' : 'insignia--neutro'}`;
  el.insigniaRol.textContent = decideComo === 'product_owner'
    ? 'Decides como Product Owner'
    : decideComo === 'delegado' ? 'Decides como delegado' : `Solo lectura · ${ETIQUETA_ROL[yo.rol] ?? 'Sin rol'}`;
}

/**
 * Avisar de la delegación vigente a quien participa en ella (el servidor solo se la envía al Scrum Master,
 * al Product Owner y al delegado).
 *
 * @returns {void}
 */
function pintarBanner() {
  const { delegacion, decideComo } = ctx.datos;
  el.banner.hidden = !delegacion;
  if (!delegacion) return;
  el.banner.className = 'daily-aviso alerta alerta--advertencia';
  el.banner.textContent = decideComo === 'delegado'
    ? `Decides como delegado del Product Owner hasta el ${ultimoDia(delegacion.hasta)}. Cada decisión queda en la bitácora.`
    : `${delegacion.delegado_nombre} puede aceptar o rechazar historias en lugar del Product Owner hasta el ${ultimoDia(delegacion.hasta)}.`;
}

/**
 * Estado de una delegación del historial.
 *
 * @param {Object} d
 * @returns {string}
 */
const estadoDelegacion = (d) => (d.vigente ? '<span class="insignia insignia--exito">Vigente</span>'
  : d.revocada_en ? '<span class="insignia insignia--neutro">Revocada</span>' : '<span class="insignia insignia--neutro">Vencida</span>');

/**
 * Pintar el panel del Scrum Master: delegación vigente, formulario para crear una y su historial.
 *
 * @returns {void}
 */
function pintarPanelDelegacion() {
  const { puedeDelegar, candidatos, delegacion, delegaciones, hoy } = ctx.datos;
  el.panelDelegacion.hidden = !puedeDelegar;
  if (!puedeDelegar) return;

  const elegido = el.delegado.value;
  el.delegado.innerHTML = '<option value="">Elige a quién delegar</option>'
    + candidatos.map((c) => `<option value="${c.id}">${escaparHtml(c.nombre)} · ${ETIQUETA_ROL[c.rol] ?? c.rol}</option>`).join('');
  el.delegado.value = elegido;

  const limite = new Date(`${hoy}T12:00:00`);
  limite.setDate(limite.getDate() + DIAS_MAXIMOS_DELEGACION);
  el.delegacionHasta.min = hoy;
  el.delegacionHasta.max = limite.toISOString().slice(0, 10);

  // Solo puede haber una delegación vigente: si la hay, se muestra con su botón para revocarla
  el.formDelegacion.hidden = Boolean(delegacion);
  el.delegacionActual.innerHTML = delegacion
    ? `<div class="retro-nota review-delegacion-actual">
        <p class="retro-nota__texto"><strong>${escaparHtml(delegacion.delegado_nombre)}</strong> decide en lugar del Product Owner hasta el ${ultimoDia(delegacion.hasta)}.${delegacion.motivo ? ` Motivo: ${escaparHtml(delegacion.motivo)}` : ''}</p>
        <div class="retro-nota__pie">
          <span class="retro-nota__autor">Creada por ${escaparHtml(delegacion.creada_por_nombre || 'alguien que ya no está')} · ${fechaHora(delegacion.desde)}</span>
          <button class="boton boton--secundario boton--peligro boton--pequeno" type="button" data-revocar="${delegacion.id}">Revocar delegación</button>
        </div>
      </div>`
    : '<p class="daily__ayuda">No hay ninguna delegación vigente: solo el Product Owner puede decidir.</p>';

  el.historial.innerHTML = delegaciones.length
    ? delegaciones.map((d) => `<li class="retro-nota">
        <p class="retro-nota__texto">${escaparHtml(d.delegado_nombre)} · hasta el ${ultimoDia(d.hasta)}${d.motivo ? ` · ${escaparHtml(d.motivo)}` : ''}</p>
        <div class="retro-nota__pie"><span class="retro-nota__autor">Creada por ${escaparHtml(d.creada_por_nombre || 'alguien que ya no está')} · ${fechaHora(d.desde)}</span>${estadoDelegacion(d)}</div>
      </li>`).join('')
    : '<li class="retro-vacio">Aún no se ha delegado la aceptación.</li>';
}

/**
 * Llenar el selector de sprints sin perder la elección actual.
 *
 * @returns {void}
 */
function pintarSelector() {
  const { sprints, sprint } = ctx.datos;
  el.selectorSprint.disabled = !sprints.length;
  el.selectorSprint.innerHTML = sprints.length
    ? sprints.map((s) => `<option value="${s.id}"${s.id === sprint?.id ? ' selected' : ''}>${escaparHtml(s.nombre)} · ${ETIQUETA_SPRINT[s.estado] ?? s.estado}</option>`).join('')
    : '<option value="">Sin sprints</option>';
}

/**
 * Repintar toda la pantalla con los datos del servidor.
 *
 * @returns {void}
 */
function pintar() {
  const { sprint } = ctx.datos;
  pintarSelector();
  pintarRol();
  pintarBanner();
  pintarPanelDelegacion();

  if (!sprint) {
    el.contenido.hidden = true;
    el.subtitulo.textContent = 'El Product Owner acepta o rechaza cada historia terminada.';
    mostrarAviso('advertencia', 'Todavía no hay un sprint activo ni cerrado. La Review se abre junto con el sprint.');
    return;
  }

  el.contenido.hidden = false;
  el.contenido.removeAttribute('aria-busy');
  el.subtitulo.textContent = `${sprint.nombre}${sprint.estado === 'cerrado' ? ' · sprint cerrado' : ' · sprint activo'}`;
  if (el.aviso.textContent.startsWith('Todavía no hay un sprint')) mostrarAviso('', '');
  // Una decisión que ya no existe (otra persona la deshizo) no debe quedar "en cambio"
  for (const id of [...ctx.cambiando]) if (!ctx.datos.historias.some((h) => h.id === id && h.decision)) ctx.cambiando.delete(id);
  pintarResumen();
  pintarHistorias();
}

/* ====================================================================
 * Carga de datos
 * ==================================================================== */

/**
 * Consultar la Review del sprint elegido y repintar.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    const consulta = ctx.sprintId ? `?sprint=${encodeURIComponent(ctx.sprintId)}` : '';
    ctx.datos = await api(`/reviews/proyecto/${ctx.proyectoId}${consulta}`);
  } catch (error) {
    el.contenido.hidden = true;
    mostrarAviso('error', error.estado === 404
      ? 'No encontramos este proyecto o sprint, o no tienes acceso a él.'
      : error.estado === 401 ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'No pudimos cargar la Review. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  ctx.sprintId = ctx.datos.sprint?.id ?? null;
  pintar();
}

el.selectorSprint.addEventListener('change', () => {
  ctx.sprintId = Number(el.selectorSprint.value) || null;
  cargar();
});

/* ====================================================================
 * Aceptar o rechazar
 * ==================================================================== */

/**
 * Enviar la decisión del Product Owner (o su delegado) sobre una historia.
 *
 * @param {number} id - Historia.
 * @param {'aceptada'|'rechazada'} decision
 * @param {boolean} [confirmar=false] - Aceptar aunque falten criterios por cumplir.
 * @returns {Promise<void>}
 */
async function decidir(id, decision, confirmar = false) {
  const h = ctx.datos.historias.find((x) => x.id === id);
  if (!h) return;
  const b = borrador(id);
  errorEnCampo(`error-comentario-${id}`);
  if (decision === 'rechazada' && !b.comentario.trim()) {
    errorEnCampo(`error-comentario-${id}`, 'Explica por qué la rechazas: el comentario es obligatorio.');
    document.getElementById(`comentario-${id}`)?.focus();
    return;
  }

  const botones = el.listaHistorias.querySelectorAll(`[data-decidir][data-historia="${id}"]`);
  botones.forEach((boton) => { boton.disabled = true; });
  try {
    await api(`/reviews/sprints/${ctx.datos.sprint.id}/historias/${id}/decision`, {
      metodo: 'POST',
      cuerpo: {
        decision,
        comentario: b.comentario,
        ...(h.criterios.length ? { criterios_cumplidos: b.criterios.size } : {}),
        confirmar,
        cambiar: ctx.cambiando.has(id),
      },
    });
    ctx.borradores.delete(id);
    ctx.cambiando.delete(id);
    mostrarAviso('exito', decision === 'aceptada'
      ? `HU-${h.numeroHu} aceptada: sus ${h.puntos ?? 0} puntos se suman a la velocity.`
      : `HU-${h.numeroHu} rechazada: se avisó al equipo con tu comentario.`);
    await cargar();
  } catch (error) {
    const detalles = error.cuerpo?.detalles;
    if (error.estado === 409 && detalles?.codigo === 'CRITERIOS_INCOMPLETOS') {
      ctx.confirmando = id;
      el.dialogoTexto.textContent = `HU-${h.numeroHu} cumple ${detalles.cumplidos} de ${detalles.total} criterios de aceptación. ¿Quieres aceptarla de todas formas?`;
      el.dialogo.showModal();
    } else if (error.estado === 400 && detalles?.comentario) {
      errorEnCampo(`error-comentario-${id}`, detalles.comentario);
    } else {
      // 409 "prevalece la primera decisión", historia que cambió de estado, permisos que cambiaron…
      avisarError(error, 'No pudimos guardar la decisión.');
      if (error.estado !== undefined) await cargar();
    }
  } finally {
    botones.forEach((boton) => { boton.disabled = false; });
  }
}

el.btnAceptarIgual.addEventListener('click', () => {
  const id = ctx.confirmando;
  ctx.confirmando = null;
  el.dialogo.close();
  if (id) decidir(id, 'aceptada', true);
});

el.dialogo.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-cerrar]')) el.dialogo.close();
});

el.listaHistorias.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button');
  if (!boton) return;
  const id = Number(boton.dataset.historia || boton.dataset.cambiar || boton.dataset.cancelarCambio || boton.dataset.marcarTodos);
  if (boton.dataset.decidir) {
    decidir(id, boton.dataset.decidir);
  } else if (boton.dataset.cambiar) {
    ctx.cambiando.add(id);
    pintarHistorias();
    document.getElementById(`comentario-${id}`)?.focus();
  } else if (boton.dataset.cancelarCambio) {
    ctx.cambiando.delete(id);
    ctx.borradores.delete(id);
    pintarHistorias();
  } else if (boton.dataset.marcarTodos) {
    const h = ctx.datos.historias.find((x) => x.id === id);
    borrador(id).criterios = new Set(h.criterios.map((_, i) => i));
    pintarHistorias();
  }
});

// Conservar lo escrito y los criterios marcados aunque la pantalla se repinte
el.listaHistorias.addEventListener('input', (evento) => {
  if (evento.target.matches('[data-comentario]')) borrador(Number(evento.target.dataset.comentario)).comentario = evento.target.value;
});

el.listaHistorias.addEventListener('change', (evento) => {
  if (!evento.target.matches('[data-criterio]')) return;
  const id = Number(evento.target.closest('[data-id]').dataset.id);
  const indice = Number(evento.target.dataset.criterio);
  const { criterios } = borrador(id);
  if (evento.target.checked) criterios.add(indice);
  else criterios.delete(indice);
});

/* ====================================================================
 * Delegación temporal
 * ==================================================================== */

el.formDelegacion.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  CAMPOS_DELEGACION.forEach((campo) => errorEnCampo(`error-delegacion-${campo}`));

  // Validar en el navegador (el servidor repite las reglas)
  const f = el.formDelegacion.elements;
  const errores = {};
  if (!f.delegado_id.value) errores.delegado_id = 'Elige a la persona que decidirá en lugar del Product Owner.';
  if (!f.hasta.value) errores.hasta = 'Indica hasta qué día dura la delegación.';
  else if (f.hasta.value < ctx.datos.hoy) errores.hasta = 'La fecha no puede ser anterior a hoy.';
  if (Object.keys(errores).length) {
    CAMPOS_DELEGACION.forEach((campo) => errorEnCampo(`error-delegacion-${campo}`, errores[campo]));
    return;
  }

  try {
    await api(`/reviews/proyecto/${ctx.proyectoId}/delegaciones`, {
      metodo: 'POST',
      cuerpo: { delegado_id: Number(f.delegado_id.value), hasta: f.hasta.value, motivo: f.motivo.value },
    });
    el.formDelegacion.reset();
    mostrarAviso('exito', 'Aceptación delegada. Quedó registrada en la bitácora y se avisó al delegado.');
    await cargar();
  } catch (error) {
    if (error.estado === 400 && error.cuerpo?.detalles) {
      CAMPOS_DELEGACION.forEach((campo) => errorEnCampo(`error-delegacion-${campo}`, error.cuerpo.detalles[campo]));
    } else {
      avisarError(error, 'No pudimos crear la delegación.');
      if (error.estado === 409) await cargar();
    }
  }
});

// Revocar pide una segunda pulsación para confirmar (evita revocar por accidente)
el.delegacionActual.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('[data-revocar]');
  if (!boton) return;
  if (!boton.dataset.confirmar) {
    boton.dataset.confirmar = 'true';
    boton.textContent = '¿Seguro? Pulsa de nuevo para revocar';
    setTimeout(() => { delete boton.dataset.confirmar; boton.textContent = 'Revocar delegación'; }, 4000);
    return;
  }
  boton.disabled = true;
  try {
    await api(`/reviews/delegaciones/${boton.dataset.revocar}`, { metodo: 'DELETE' });
    mostrarAviso('exito', 'Delegación revocada: solo el Product Owner puede decidir.');
    await cargar();
  } catch (error) {
    avisarError(error, 'No pudimos revocar la delegación.');
    boton.disabled = false;
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
    mostrarAviso('error', 'No pudimos cargar tus proyectos. Revisa tu conexión o inicia sesión de nuevo.');
    return;
  }
  if (!eleccion.id) {
    mostrarSinProyecto(!eleccion.proyectos.length);
    return;
  }

  ctx.proyectoId = eleccion.id;
  // Permisos del proyecto, para mostrar solo lo que le toca a su rol (delegar es del Scrum Master)
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, lo restringido sigue oculto */ });
  await cargar();
  // Otra persona decide, se delega o se inicia/cierra un sprint: la pantalla se actualiza sola
  const socket = conectarTiempoReal(ctx.proyectoId, ['review:actualizada', 'sprint:iniciado', 'sprint:cerrado'], cargar);
  if (socket) escucharCambiosDeRol(socket);
}

iniciar();
