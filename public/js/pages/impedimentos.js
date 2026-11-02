// Responsable: Diego - HU-11: logica de la pantalla de impedimentos (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de impedimentos:
 *   - Registrar un impedimento (título, severidad, responsable y tarea afectada) y mostrarlo como abierto.
 *   - Resolverlo; si otra persona lo resolvió antes, mostrar "Ya fue resuelto por X".
 *   - Resaltar en rojo los que llevan más de 3 días abiertos.
 *   - Filtrar por estado y severidad, y actualizarse sola con Socket.io.
 */
import { api } from '/js/core/api.js';
import { montarBarraSuperior } from '/js/core/layout.js';
import { escaparHtml, pluralizar } from '/js/core/utils.js';
import { resolverProyecto, conectarTiempoReal, pintarSelectorProyecto } from '/js/pages/ceremonias/proyecto.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
  selectorProyecto: document.getElementById('selector-proyecto'),
  btnNuevo: document.getElementById('btn-nuevo'),
  aviso: document.getElementById('aviso'),
  abiertos: document.getElementById('dato-abiertos'),
  vencidos: document.getElementById('dato-vencidos'),
  etiquetaVencidos: document.getElementById('etiqueta-vencidos'),
  resueltos: document.getElementById('dato-resueltos'),
  filtroEstado: document.getElementById('filtro-estado'),
  filtroSeveridad: document.getElementById('filtro-severidad'),
  lista: document.getElementById('lista'),
  dialogo: document.getElementById('dialogo-nuevo'),
  form: document.getElementById('form-nuevo'),
  titulo: document.getElementById('campo-titulo'),
  severidad: document.getElementById('campo-severidad'),
  responsable: document.getElementById('campo-responsable'),
  tarea: document.getElementById('campo-tarea'),
  errorGeneral: document.getElementById('error-general'),
  btnCancelar: document.getElementById('btn-cancelar'),
  btnCrear: document.getElementById('btn-crear'),
};

const CAMPOS_FORM = ['titulo', 'severidad', 'responsable_id', 'tarea_id'];

const SEVERIDADES = {
  alta: { texto: 'Alta', clase: 'insignia--peligro' },
  media: { texto: 'Media', clase: 'insignia--advertencia' },
  baja: { texto: 'Baja', clase: 'insignia--info' },
};

// Estado de la pantalla
const ctx = { proyectoId: null, datos: null, enviando: false };

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
  el.aviso.className = `imp-aviso alerta alerta--${tono || 'advertencia'}`;
  el.aviso.textContent = texto;
}

/**
 * Convertir horas en un texto corto: "menos de 1 h", "26,5 h" o "3 días 4 h".
 *
 * @param {number} horas
 * @returns {string}
 */
function formatoDuracion(horas) {
  if (horas < 1) return 'menos de 1 h';
  if (horas < 48) return `${horas.toLocaleString('es', { maximumFractionDigits: 1 })} h`;
  const dias = Math.floor(horas / 24);
  const resto = Math.round(horas - dias * 24);
  return `${dias} ${pluralizar(dias, 'día', 'días')}${resto ? ` ${resto} h` : ''}`;
}

/**
 * Dar formato corto a una fecha y hora del servidor.
 *
 * @param {string} iso
 * @returns {string}
 */
const fechaCorta = (iso) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ====================================================================
 * Lista
 * ==================================================================== */

/**
 * Pintar los contadores de arriba (siempre cuentan todo el proyecto, sin importar los filtros).
 *
 * @returns {void}
 */
function pintarResumen() {
  const { resumen, diasParaAlerta } = ctx.datos;
  el.abiertos.textContent = resumen.abiertos;
  el.vencidos.textContent = resumen.vencidos;
  el.resueltos.textContent = resumen.resueltos;
  el.etiquetaVencidos.textContent = `Abiertos por más de ${diasParaAlerta} días`;
}

/**
 * Pintar el HTML de un impedimento. Los abiertos por más de 3 días se resaltan en rojo.
 *
 * @param {Object} i - Impedimento tal como lo devuelve la API.
 * @param {number} yoId - Persona de la sesión.
 * @returns {string}
 */
function pintarImpedimento(i, yoId) {
  const sev = SEVERIDADES[i.severidad];
  const abierto = i.estado === 'abierto';
  const clases = ['imp', `imp--${i.severidad}`];
  if (!abierto) clases.push('imp--resuelto');
  if (i.vencido) clases.push('imp--vencido');

  const responsable = i.responsable_nombre
    ? `${escaparHtml(i.responsable_nombre)}${i.responsable_id === yoId ? ' (tú)' : ''}${i.responsable_inactivo ? ' · dado de baja' : ''}`
    : 'Sin responsable';

  const tiempo = abierto
    ? `Abierto hace ${formatoDuracion(i.horas_abierto)}`
    : `Resuelto por ${escaparHtml(i.resuelto_por_nombre || 'otra persona')} · estuvo abierto ${formatoDuracion(i.horas_abierto)}`;

  const aviso = i.vencido
    ? `<p class="imp__aviso" role="alert">Lleva más de ${ctx.datos.diasParaAlerta} días abierto. Hay que atenderlo.</p>`
    : '';

  const accion = abierto
    ? `<button class="boton boton--secundario boton--pequeno" type="button" data-resolver="${i.id}">Marcar como resuelto</button>`
    : '';

  return `<li class="${clases.join(' ')}" data-id="${i.id}">
    <div>
      <div class="imp__titulo">${escaparHtml(i.titulo)}</div>
      <div class="imp__meta">
        <span class="insignia ${sev.clase}">${sev.texto}</span>
        <span>Responsable: ${responsable}</span>
        ${i.tarea_titulo ? `<span>Tarea: ${escaparHtml(i.tarea_titulo)}</span>` : ''}
        <span>Registrado${i.creado_por_nombre ? ` por ${escaparHtml(i.creado_por_nombre)}` : ''} · ${fechaCorta(i.creado_en)}</span>
      </div>
    </div>
    <div class="imp__acciones">
      <span class="imp__tiempo">${tiempo}</span>
      ${accion}
    </div>
    ${aviso}
  </li>`;
}

/**
 * Pintar la lista completa o el mensaje de "no hay nada" según los filtros activos.
 *
 * @returns {void}
 */
function pintarLista() {
  el.lista.removeAttribute('aria-busy');
  const { impedimentos, yo } = ctx.datos;
  if (!impedimentos.length) {
    const hayFiltros = el.filtroEstado.value !== 'abierto' || el.filtroSeveridad.value;
    el.lista.innerHTML = `<li class="imp-vacio">${hayFiltros
      ? 'No hay impedimentos con esos filtros.'
      : 'No hay impedimentos abiertos. ¡Todo fluye!'}</li>`;
    return;
  }
  el.lista.innerHTML = impedimentos.map((i) => pintarImpedimento(i, yo.id)).join('');
}

/**
 * Consultar la lista del proyecto con los filtros elegidos y repintar la pantalla.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  const params = new URLSearchParams({ estado: el.filtroEstado.value });
  if (el.filtroSeveridad.value) params.set('severidad', el.filtroSeveridad.value);
  try {
    ctx.datos = await api(`/impedimentos/proyecto/${ctx.proyectoId}?${params}`);
  } catch (error) {
    el.lista.removeAttribute('aria-busy');
    el.lista.innerHTML = '';
    if (error.estado === 404) mostrarAviso('error', 'No encontramos este proyecto o no tienes acceso a él.');
    else if (error.estado === 401) mostrarAviso('error', 'Tu sesión expiró. Inicia sesión de nuevo.');
    else mostrarAviso('error', 'No pudimos cargar los impedimentos. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  el.btnNuevo.disabled = !ctx.datos.yo.rol;
  pintarResumen();
  pintarLista();
}

el.filtroEstado.addEventListener('change', cargar);
el.filtroSeveridad.addEventListener('change', cargar);

/* ====================================================================
 * Resolver
 * ==================================================================== */

el.lista.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('[data-resolver]');
  if (!boton) return;
  boton.disabled = true;
  try {
    await api(`/impedimentos/${boton.dataset.resolver}/resolver`, { metodo: 'POST' });
    mostrarAviso('exito', 'Impedimento resuelto.');
  } catch (error) {
    if (error.estado === 409) mostrarAviso('advertencia', error.cuerpo?.mensaje || 'Ya fue resuelto por otra persona.');
    else if (error.estado === 403 || error.estado === 404) mostrarAviso('error', 'No tienes permiso para resolver este impedimento.');
    else mostrarAviso('error', 'No pudimos resolver el impedimento. Inténtalo de nuevo.');
  }
  await cargar(); // En ambos casos, mostrar cómo quedó
});

/* ====================================================================
 * Registrar
 * ==================================================================== */

/**
 * Pintar los errores por campo del formulario (o limpiarlos).
 *
 * @param {Object<string,string>} [errores] - { campo: mensaje }.
 * @returns {void}
 */
function pintarErrores(errores = {}) {
  for (const campo of CAMPOS_FORM) {
    const parrafo = document.getElementById(`error-${campo}`);
    const mensaje = errores[campo];
    parrafo.hidden = !mensaje;
    parrafo.textContent = mensaje || '';
    const control = el.form.elements[campo];
    if (control) control.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }
}

/**
 * Preparar el diálogo: opciones de responsable y de tarea, y campos vacíos.
 *
 * @returns {void}
 */
function abrirDialogo() {
  const { miembros, tareas, yo } = ctx.datos;
  el.form.reset();
  el.responsable.innerHTML = '<option value="">Elige a una persona…</option>'
    + miembros.map((m) => `<option value="${m.id}">${escaparHtml(m.nombre)}${m.id === yo.id ? ' (tú)' : ''}</option>`).join('');
  el.tarea.innerHTML = '<option value="">Ninguna</option>'
    + tareas.map((t) => `<option value="${t.id}">${escaparHtml(t.titulo)}</option>`).join('');
  pintarErrores();
  el.errorGeneral.hidden = true;
  el.dialogo.showModal();
  el.titulo.focus();
}

el.btnNuevo.addEventListener('click', abrirDialogo);
el.btnCancelar.addEventListener('click', () => el.dialogo.close());

el.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.enviando) return;

  // Validar en el navegador (el servidor repite las reglas): título y responsable son obligatorios
  const errores = {};
  if (!el.titulo.value.trim()) errores.titulo = 'Escribe un título para el impedimento.';
  if (!el.responsable.value) errores.responsable_id = 'Elige quién se encargará de resolverlo.';
  pintarErrores(errores);
  el.errorGeneral.hidden = true;
  if (Object.keys(errores).length) {
    el.form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  ctx.enviando = true;
  el.btnCrear.disabled = true;
  try {
    await api(`/impedimentos/proyecto/${ctx.proyectoId}`, {
      metodo: 'POST',
      cuerpo: {
        titulo: el.titulo.value,
        severidad: el.severidad.value,
        responsable_id: Number(el.responsable.value),
        tarea_id: el.tarea.value ? Number(el.tarea.value) : null,
      },
    });
    el.dialogo.close();
    mostrarAviso('exito', 'Impedimento registrado.');
    el.filtroEstado.value = el.filtroEstado.value === 'resuelto' ? 'abierto' : el.filtroEstado.value;
    await cargar();
  } catch (error) {
    if (error.estado === 400 && error.cuerpo?.detalles) {
      pintarErrores(error.cuerpo.detalles);
      el.form.querySelector('[aria-invalid="true"]')?.focus();
    } else {
      el.errorGeneral.textContent = error.estado === 403 || error.estado === 404
        ? 'No tienes permiso para registrar impedimentos en este proyecto.'
        : 'No pudimos registrar el impedimento. Revisa tu conexión e inténtalo de nuevo.';
      el.errorGeneral.hidden = false;
    }
  } finally {
    ctx.enviando = false;
    el.btnCrear.disabled = false;
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
    el.lista.removeAttribute('aria-busy');
    mostrarAviso('error', 'No pudimos cargar tus proyectos. Revisa tu conexión o inicia sesión de nuevo.');
    return;
  }

  if (!eleccion.id) {
    el.lista.removeAttribute('aria-busy');
    mostrarAviso('advertencia', 'Todavía no perteneces a ningún proyecto.');
    return;
  }

  ctx.proyectoId = eleccion.id;
  pintarSelectorProyecto(el.selectorProyecto, eleccion.proyectos, eleccion.id, escaparHtml, '/pages/impedimentos.html');
  await cargar();

  const socket = conectarTiempoReal(ctx.proyectoId, ['impedimento:creado', 'impedimento:resuelto', 'impedimento:reasignado'], cargar);
  // Aviso personal (por ejemplo, "te asignaron" o "quedó a tu cargo por una baja")
  socket?.on('impedimento:aviso', (aviso) => mostrarAviso('advertencia', aviso.mensaje));
}

iniciar();
