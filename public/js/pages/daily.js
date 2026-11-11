// Responsable: Diego - HU-10: logica de la pantalla de Daily Scrum (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de Daily Scrum:
 *   - Registrar o editar MI Daily de hoy (ayer, hoy, impedimentos) y vincular tareas como chips.
 *   - Scrum Master: ver el estado de todo el equipo (Registrado, Tarde, Ausente o Pendiente).
 *     Los demás roles solo registran y ven su propio registro.
 *   - Los chips de tareas solo muestran las tareas asignadas a quien registra.
 *   - Consultar días anteriores en solo lectura.
 *   - Si falla la conexión al guardar, conservar el texto como borrador local.
 *   - Actualizarse sola cuando otra persona registra su Daily (Socket.io).
 *
 * @author Diego Rafael Jimenez Trujano
 * @author Citlaly Morales Viveros
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, pluralizar } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal, mostrarSinProyecto } from '../pages/ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
  subtitulo: document.getElementById('subtitulo'),
  selectorFecha: document.getElementById('selector-fecha'),
  btnHoy: document.getElementById('btn-hoy'),
  aviso: document.getElementById('aviso'),
  contenido: document.getElementById('contenido'),
  tarjetaMia: document.getElementById('tarjeta-mia'),
  ayudaMia: document.getElementById('ayuda-mia'),
  form: document.getElementById('form-daily'),
  ayer: document.getElementById('campo-ayer'),
  hoy: document.getElementById('campo-hoy'),
  impedimentos: document.getElementById('campo-impedimentos'),
  chips: document.getElementById('chips-tareas'),
  btnGuardar: document.getElementById('btn-guardar'),
  enlaceImpedimentos: document.getElementById('enlace-impedimentos'),
  estadoForm: document.getElementById('estado-form'),
  tituloEquipo: document.getElementById('titulo-equipo'),
  ayudaEquipo: document.getElementById('ayuda-equipo'),
  resumen: document.getElementById('resumen'),
  lista: document.getElementById('lista-equipo'),
};

const CAMPOS = ['ayer', 'hoy', 'impedimentos', 'tareas'];

const ETIQUETA_ROL = { scrum_master: 'Scrum Master', product_owner: 'Product Owner', developer: 'Desarrollador' };

const ESTADOS = {
  registrado: { texto: 'Registrado', clase: 'insignia--exito' },
  tarde: { texto: 'Tarde', clase: 'insignia--advertencia' },
  pendiente: { texto: 'Pendiente', clase: 'insignia--neutro' },
  ausente: { texto: 'Ausente', clase: 'insignia--info' },
};

// Estado de la pantalla
const ctx = {
  proyectoId: null,
  datos: null,            // Última respuesta del servidor
  tareasVinculadas: new Set(),
  sucio: false,           // La persona escribió algo que aún no se guarda
  guardando: false,
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
 * Mostrar el estado junto al botón de guardar.
 *
 * @param {'exito'|'error'|'info'} tono
 * @param {string} texto
 * @returns {void}
 */
function mostrarEstadoForm(tono, texto) {
  el.estadoForm.className = `daily-form__estado daily-form__estado--${tono}`;
  el.estadoForm.textContent = texto;
}

/**
 * Dar formato largo a una fecha "AAAA-MM-DD" (por ejemplo "lunes, 26 de octubre").
 *
 * @param {string} fecha
 * @returns {string}
 */
function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Indicar si un error de la API es un corte de conexión (la petición ni siquiera llegó al servidor).
 *
 * @param {Error & {estado?: number}} error
 * @returns {boolean}
 */
const esFalloDeRed = (error) => error.estado === undefined;

/* ====================================================================
 * Borrador local (si se pierde la conexión mientras se escribe)
 * ==================================================================== */

const claveBorrador = () => `daily:borrador:${ctx.proyectoId}:${ctx.datos?.yo?.id}:${ctx.datos?.hoy}`;

/**
 * Guardar en este dispositivo lo que hay escrito en el formulario.
 *
 * @returns {void}
 */
function guardarBorrador() {
  try {
    localStorage.setItem(claveBorrador(), JSON.stringify({
      ayer: el.ayer.value,
      hoy: el.hoy.value,
      impedimentos: el.impedimentos.value,
      tareas: [...ctx.tareasVinculadas],
    }));
  } catch { /* almacenamiento lleno o bloqueado: se sigue sin borrador */ }
}

/**
 * Leer el borrador guardado de este día, si existe.
 *
 * @returns {{ayer: string, hoy: string, impedimentos: string, tareas: number[]}|null}
 */
function leerBorrador() {
  try { return JSON.parse(localStorage.getItem(claveBorrador())); } catch { return null; }
}

/**
 * Borrar el borrador (después de guardar con éxito).
 *
 * @returns {void}
 */
function borrarBorrador() {
  try { localStorage.removeItem(claveBorrador()); } catch { /* nada que borrar */ }
}

/* ====================================================================
 * Formulario
 * ==================================================================== */

/**
 * Pintar los errores por campo que devuelve la validación (o limpiarlos).
 *
 * @param {Object<string,string>} [errores] - { campo: mensaje }.
 * @returns {void}
 */
function pintarErrores(errores = {}) {
  for (const campo of CAMPOS) {
    const parrafo = document.getElementById(`error-${campo}`);
    const mensaje = errores[campo];
    parrafo.hidden = !mensaje;
    parrafo.textContent = mensaje || '';
    const control = el[campo];
    if (control && 'setAttribute' in control) control.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
  }
}

/**
 * Pintar los chips de tareas del sprint: se activan y desactivan para vincularlas.
 *
 * @returns {void}
 */
function pintarChips() {
  const tareas = ctx.datos?.tareas ?? [];
  if (!tareas.length) {
    el.chips.innerHTML = '<span class="daily__ayuda">No tienes tareas asignadas en este sprint.</span>';
    return;
  }
  el.chips.innerHTML = tareas.map((t) => {
    const activo = ctx.tareasVinculadas.has(t.id);
    return `<button class="chip" type="button" data-tarea="${t.id}" aria-pressed="${activo}" title="${escaparHtml(t.titulo)}">
      <span class="chip__texto">${escaparHtml(t.titulo)}</span>
      ${t.columna ? `<span class="chip__columna">${escaparHtml(t.columna)}</span>` : ''}
    </button>`;
  }).join('');
}

/**
 * Llenar el formulario con la Daily guardada o con el borrador local (el borrador manda si existe).
 *
 * @returns {void}
 */
function llenarFormulario() {
  const mia = ctx.datos.miembros.find((m) => m.usuarioId === ctx.datos.yo.id)?.daily;
  const borrador = leerBorrador();
  const base = borrador ?? {
    ayer: mia?.ayer ?? '',
    hoy: mia?.hoy ?? '',
    impedimentos: mia?.impedimentos ?? '',
    tareas: mia?.tareas.map((t) => t.id) ?? [],
  };
  el.ayer.value = base.ayer;
  el.hoy.value = base.hoy;
  el.impedimentos.value = base.impedimentos;
  ctx.tareasVinculadas = new Set(base.tareas);
  ctx.sucio = Boolean(borrador);
  if (borrador) mostrarEstadoForm('info', 'Recuperamos un borrador que no se había guardado.');
  else mostrarEstadoForm('info', '');
  pintarErrores();
  pintarChips();
}

/**
 * Dejar el formulario vacío después de registrar. Se marca como "sucio" para que la recarga que sigue
 * al guardado no lo vuelva a llenar con lo recién registrado.
 *
 * @returns {void}
 */
function limpiarFormulario() {
  el.form.reset();
  ctx.tareasVinculadas = new Set();
  ctx.sucio = true;
  pintarErrores();
}

/**
 * Mostrar u ocultar el formulario según lo que la persona pueda hacer hoy.
 *
 * @returns {void}
 */
function actualizarTarjetaMia() {
  const { puedeRegistrar, sprint, soloLectura, yo, horaCorte, corteDelCalendario } = ctx.datos;
  el.form.hidden = !puedeRegistrar;
  el.enlaceImpedimentos.href = `/pages/impedimentos.html?proyecto=${ctx.proyectoId}`;

  if (puedeRegistrar) {
    const ya = ctx.datos.miembros.find((m) => m.usuarioId === yo.id)?.daily;
    el.ayudaMia.textContent = `${ya ? 'Ya registraste tu Daily de hoy; puedes editarla. ' : ''}`
      + `Lo que se guarde después de ${horaCorte}${corteDelCalendario ? ' (fin de la Daily del calendario)' : ''} se marca como tarde.`;
  } else if (!sprint) {
    el.ayudaMia.textContent = 'Cuando el sprint esté activo podrás registrar tu Daily.';
  } else if (soloLectura) {
    el.ayudaMia.textContent = 'Los días anteriores solo se pueden consultar.';
  } else {
    el.ayudaMia.textContent = 'No tienes un rol en este proyecto, por eso no puedes registrar una Daily.';
  }
}

el.form.addEventListener('input', () => {
  ctx.sucio = true;
  guardarBorrador();
});

el.chips.addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-tarea]');
  if (!boton) return;
  const id = Number(boton.dataset.tarea);
  if (ctx.tareasVinculadas.has(id)) ctx.tareasVinculadas.delete(id);
  else ctx.tareasVinculadas.add(id);
  boton.setAttribute('aria-pressed', String(ctx.tareasVinculadas.has(id)));
  ctx.sucio = true;
  guardarBorrador();
});

/**
 * Validar el formulario en el navegador (el servidor repite estas reglas).
 *
 * @returns {Object<string,string>} { campo: mensaje }; vacío si todo es válido.
 */
function validar() {
  const errores = {};
  if (!el.ayer.value.trim()) errores.ayer = 'Cuenta qué hiciste ayer.';
  if (!el.hoy.value.trim()) errores.hoy = 'Cuenta qué harás hoy.';
  return errores;
}

el.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.guardando) return;

  const errores = validar();
  pintarErrores(errores);
  if (Object.keys(errores).length) {
    mostrarEstadoForm('error', 'Completa los campos marcados para guardar.');
    el.form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  guardarBorrador(); // Por si algo falla, el texto ya está a salvo
  ctx.guardando = true;
  el.btnGuardar.disabled = true;
  mostrarEstadoForm('info', 'Guardando…');

  try {
    if (!navigator.onLine) throw new Error('sin conexión'); // Cae en el mismo manejo que un corte de red
    const respuesta = await api(`/daily/proyecto/${ctx.proyectoId}`, {
      metodo: 'PUT',
      cuerpo: {
        ayer: el.ayer.value,
        hoy: el.hoy.value,
        impedimentos: el.impedimentos.value,
        tareas: [...ctx.tareasVinculadas],
      },
    });
    borrarBorrador();
    limpiarFormulario();
    mostrarEstadoForm('exito', respuesta.mensaje);
    await cargar();
  } catch (error) {
    if (esFalloDeRed(error)) {
      mostrarEstadoForm('error', 'No hay conexión con el servidor. Tu texto quedó guardado como borrador en este dispositivo; vuelve a guardar cuando se restablezca.');
    } else if (error.estado === 400 && error.cuerpo?.detalles) {
      pintarErrores(error.cuerpo.detalles);
      mostrarEstadoForm('error', 'Revisa los campos marcados.');
    } else if (error.estado === 409 || error.estado === 403) {
      mostrarEstadoForm('error', error.cuerpo?.mensaje || 'No se pudo guardar tu Daily.');
    } else if (error.estado === 401) {
      mostrarEstadoForm('error', 'Tu sesión expiró. Inicia sesión de nuevo; tu texto quedó como borrador.');
    } else {
      mostrarEstadoForm('error', 'No pudimos guardar tu Daily. Tu texto quedó como borrador; inténtalo de nuevo.');
    }
  } finally {
    ctx.guardando = false;
    el.btnGuardar.disabled = false;
  }
});

window.addEventListener('online', () => {
  if (ctx.sucio) mostrarEstadoForm('info', 'Se restableció la conexión. Ya puedes guardar tu Daily.');
});
window.addEventListener('offline', () => {
  if (ctx.sucio) mostrarEstadoForm('error', 'Sin conexión. Lo que escribas se conserva como borrador en este dispositivo.');
});

/* ====================================================================
 * Estado del equipo
 * ==================================================================== */

/**
 * Pintar el resumen de contadores y la tarjeta de cada integrante.
 *
 * @returns {void}
 */
function pintarEquipo() {
  const { miembros, resumen, sprint, yo, fecha, verEquipo } = ctx.datos;

  el.tituloEquipo.textContent = verEquipo ? 'Estado del equipo' : 'Mi registro';
  el.resumen.hidden = !verEquipo;
  if (!sprint) {
    el.ayudaEquipo.textContent = '';
    el.resumen.innerHTML = '';
    el.lista.innerHTML = '';
    return;
  }

  el.ayudaEquipo.textContent = `${sprint.nombre} · ${fechaLarga(fecha)}`;
  el.resumen.innerHTML = !verEquipo ? '' : ['registrado', 'tarde', 'ausente', 'pendiente'].map((estado) => {
    const n = resumen[estado];
    const textos = {
      registrado: pluralizar(n, 'registrado', 'registrados'),
      tarde: 'tarde',
      ausente: pluralizar(n, 'ausente', 'ausentes'),
      pendiente: pluralizar(n, 'pendiente', 'pendientes'),
    };
    return `<span class="insignia ${ESTADOS[estado].clase}">${n} ${textos[estado]}</span>`;
  }).join('');

  el.lista.innerHTML = miembros.map((m) => {
    const estado = ESTADOS[m.estado];
    let cuerpo;
    if (m.daily) {
      const chips = m.daily.tareas.length
        ? `<div class="chips integrante__chips">${m.daily.tareas.map((t) => `<span class="chip chip--fijo"><span class="chip__texto">${escaparHtml(t.titulo)}</span></span>`).join('')}</div>`
        : '';
      cuerpo = `<dl class="integrante__preguntas">
          <div><dt>Ayer</dt><dd>${escaparHtml(m.daily.ayer)}</dd></div>
          <div><dt>Hoy</dt><dd>${escaparHtml(m.daily.hoy)}</dd></div>
          <div><dt>Impedimentos</dt><dd>${m.daily.impedimentos ? escaparHtml(m.daily.impedimentos) : 'Sin impedimentos'}</dd></div>
        </dl>${chips}`;
    } else if (m.estado === 'ausente') {
      cuerpo = '<p class="integrante__vacio">Tiene una ausencia registrada este día. No cuenta como pendiente.</p>';
    } else {
      const propio = m.usuarioId === yo.id;
      cuerpo = `<p class="integrante__vacio">${ctx.datos.soloLectura
        ? (propio ? 'No registraste tu Daily este día.' : 'No registró su Daily este día.')
        : (propio ? 'Aún no registras tu Daily.' : 'Aún no registra su Daily.')}</p>`;
    }
    return `<li class="integrante${m.usuarioId === yo.id ? ' integrante--yo' : ''}">
      <div class="integrante__cabecera">
        <span><span class="integrante__nombre">${escaparHtml(m.nombre)}${m.usuarioId === yo.id ? ' (tú)' : ''}</span><span class="integrante__rol">${escaparHtml(ETIQUETA_ROL[m.rol] ?? '')}</span></span>
        <span class="insignia ${estado.clase}">${estado.texto}</span>
      </div>
      ${cuerpo}
    </li>`;
  }).join('');
}

/* ====================================================================
 * Carga de datos
 * ==================================================================== */

/**
 * Consultar la Daily del día elegido y repintar la pantalla.
 * Si la persona está escribiendo, su formulario no se pisa con datos del servidor.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  const fecha = el.selectorFecha.value;
  const consulta = fecha && fecha !== ctx.datos?.hoy ? `?fecha=${encodeURIComponent(fecha)}` : '';
  try {
    ctx.datos = await api(`/daily/proyecto/${ctx.proyectoId}${consulta}`);
  } catch (error) {
    el.contenido.removeAttribute('aria-busy');
    if (error.estado === 404) mostrarAviso('error', 'No encontramos este proyecto o no tienes acceso a él.');
    else if (error.estado === 401) mostrarAviso('error', 'Tu sesión expiró. Inicia sesión de nuevo.');
    else if (error.estado === 400) mostrarAviso('error', error.cuerpo?.mensaje || 'La fecha elegida no es válida.');
    else mostrarAviso('error', 'No pudimos cargar la Daily. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }

  el.contenido.removeAttribute('aria-busy');
  const d = ctx.datos;
  el.selectorFecha.max = d.hoy;
  if (!el.selectorFecha.value) el.selectorFecha.value = d.fecha;
  el.subtitulo.textContent = d.sprint ? `${d.sprint.nombre}${d.sprint.objetivo ? ` · ${d.sprint.objetivo}` : ''}` : 'Qué hice, qué haré y qué me estorba.';

  if (!d.sprint) mostrarAviso('advertencia', 'Este proyecto no tiene un sprint activo. La Daily se registra mientras el sprint está en curso.');
  else if (d.soloLectura) mostrarAviso('advertencia', `Estás viendo el ${fechaLarga(d.fecha)}: solo lectura.`);
  else mostrarAviso('', '');

  actualizarTarjetaMia();
  if (d.puedeRegistrar && !ctx.sucio) llenarFormulario();
  else if (d.puedeRegistrar) pintarChips();
  pintarEquipo();
}

el.selectorFecha.addEventListener('change', () => {
  if (!el.selectorFecha.value) el.selectorFecha.value = ctx.datos?.hoy ?? '';
  cargar();
});

el.btnHoy.addEventListener('click', () => {
  el.selectorFecha.value = ctx.datos?.hoy ?? '';
  cargar();
});

/* ====================================================================
 * INICIO
 * ==================================================================== */

async function iniciar() {
  let eleccion;
  try {
    eleccion = await resolverProyecto();
  } catch {
    el.contenido.removeAttribute('aria-busy');
    mostrarAviso('error', 'No pudimos cargar tus proyectos. Revisa tu conexión o inicia sesión de nuevo.');
    return;
  }

  if (!eleccion.id) {
    mostrarSinProyecto(!eleccion.proyectos.length);
    return;
  }

  ctx.proyectoId = eleccion.id;
  // Permisos del proyecto elegido, para mostrar solo lo que le toca a su rol
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
  await cargar();
  const socket = conectarTiempoReal(ctx.proyectoId, ['daily:registrada'], cargar);
  if (socket) escucharCambiosDeRol(socket);
}

iniciar();
