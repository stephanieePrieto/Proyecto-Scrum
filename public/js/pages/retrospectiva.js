// Responsable: Diego - HU-13, HU-14: logica de la pantalla de retrospectiva y acciones pendientes (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de retrospectiva:
 *   - Tres columnas: "Qué salió bien", "Qué mejorar" y "Acciones". Cada nota puede publicarse de forma anónima.
 *   - Votar notas (máximo 5 votos por integrante) y ver el contador de cada una.
 *   - Crear acciones con responsable y fecha límite obligatorios; el Scrum Master cierra la retro.
 *   - Aviso "X la está editando" cuando otra persona edita la misma nota (Socket.io).
 *   - Si se cierra la ventana, las notas enviadas persisten y lo que se estaba escribiendo se recupera como borrador.
 *   - Recordatorio de acciones pendientes de retros anteriores (HU-14), con el mismo componente que usa el ciclo.
 *
 * @author Diego Rafael Jimenez Trujano
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, pluralizar } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal } from '../pages/ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';
import { pintarPendientes } from '../componentes/retro-pendientes.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
  subtitulo: document.getElementById('subtitulo'),
  selectorSprint: document.getElementById('selector-sprint'),
  insigniaVotos: document.getElementById('insignia-votos'),
  btnCerrar: document.getElementById('btn-cerrar'),
  aviso: document.getElementById('aviso'),
  pendientes: document.getElementById('pendientes'),
  tablero: document.getElementById('tablero'),
  formsNota: document.querySelectorAll('.retro-form[data-columna]'),
  notas: { bien: document.getElementById('notas-bien'), mejorar: document.getElementById('notas-mejorar') },
  formAccion: document.getElementById('form-accion'),
  accionResponsable: document.getElementById('accion-responsable'),
  accionFecha: document.getElementById('accion-fecha'),
  listaAcciones: document.getElementById('lista-acciones'),
};

const ETIQUETA_SPRINT = { activo: 'activo', cerrado: 'cerrado' };
const INTERVALO_LATIDO_MS = 10 * 1000;

// Estado de la pantalla
const ctx = {
  proyectoId: null,
  sprintId: null,
  datos: null,
  editando: new Map(),   // item → { nombre, temporizador }: notas que OTRA persona está editando
  edicionLocal: null,    // { id, texto, latido }: la nota que yo estoy editando
  borradoresListos: false,
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
  parrafo.hidden = !mensaje;
  parrafo.textContent = mensaje;
}

/**
 * Dar formato corto a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @returns {string}
 */
const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/** La retro seleccionada acepta cambios mientras no esté cerrada. */
const estaAbierta = () => ctx.datos?.retro?.estado === 'abierta';

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

/* ====================================================================
 * Borradores (lo que se estaba escribiendo se recupera al volver)
 * ==================================================================== */

const claveBorrador = (campo) => `retro:borrador:${ctx.proyectoId}:${ctx.datos?.retro?.id}:${ctx.datos?.yo?.id}:${campo}`;

/**
 * Guardar en este dispositivo lo que hay escrito en un campo.
 *
 * @param {string} campo - "bien", "mejorar" o "accion".
 * @param {string} valor
 * @returns {void}
 */
function guardarBorrador(campo, valor) {
  try {
    if (valor) localStorage.setItem(claveBorrador(campo), valor);
    else localStorage.removeItem(claveBorrador(campo));
  } catch { /* almacenamiento lleno o bloqueado: se sigue sin borrador */ }
}

/**
 * Devolver a los campos lo que se había escrito antes de cerrar la ventana (solo la primera vez por carga).
 *
 * @returns {void}
 */
function restaurarBorradores() {
  if (ctx.borradoresListos || !ctx.datos?.retro) return;
  ctx.borradoresListos = true;
  let recuperado = false;
  const poner = (campo, control) => {
    try {
      const guardado = localStorage.getItem(claveBorrador(campo));
      if (guardado && !control.value) { control.value = guardado; recuperado = true; }
    } catch { /* sin borrador */ }
  };
  el.formsNota.forEach((form) => poner(form.dataset.columna, form.elements.texto));
  poner('accion', el.formAccion.elements.texto);
  if (recuperado) mostrarAviso('advertencia', 'Recuperamos lo que estabas escribiendo y no se había enviado.');
}

/* ====================================================================
 * Pintado
 * ==================================================================== */

/**
 * Pintar una nota con su contador de votos y sus botones, o su editor si yo la estoy editando.
 *
 * @param {Object} i - Ítem tal como lo devuelve la API.
 * @returns {string}
 */
function pintarNota(i) {
  const { esScrumMaster, votos } = ctx.datos;
  const abierta = estaAbierta();
  const otro = ctx.editando.get(i.id);
  const propia = ctx.edicionLocal?.id === i.id;

  const autor = i.anonimo ? `Anónimo${i.esMio ? ' (tú)' : ''}` : escaparHtml(i.autor ?? 'Alguien');
  const cuerpo = propia
    ? `<textarea class="form-input" data-editor maxlength="500" rows="3" aria-label="Editar nota">${escaparHtml(ctx.edicionLocal.texto)}</textarea>
       <div class="retro-nota__acciones">
         <button class="boton boton--primario boton--pequeno" type="button" data-guardar-edicion="${i.id}">Guardar</button>
         <button class="boton boton--secundario boton--pequeno" type="button" data-cancelar-edicion="${i.id}">Cancelar</button>
       </div>`
    : `<p class="retro-nota__texto">${escaparHtml(i.texto)}</p>`;

  const votar = `<button class="chip retro-nota__voto" type="button" data-votar="${i.id}" aria-pressed="${i.votoMio}"
      ${!abierta || (!i.votoMio && votos.restantes === 0) ? 'disabled' : ''} aria-label="${i.votoMio ? 'Quitar mi voto' : 'Votar'} (${i.votos} ${pluralizar(i.votos, 'voto', 'votos')})">
      ${i.votoMio ? 'Votado' : 'Votar'} · ${i.votos}</button>`;
  const acciones = abierta && !propia
    ? `<button class="boton boton--secundario boton--pequeno" type="button" data-editar="${i.id}">Editar</button>
       ${i.esMio || esScrumMaster ? `<button class="boton boton--secundario boton--pequeno" type="button" data-eliminar="${i.id}">Eliminar</button>` : ''}`
    : '';

  return `<li class="retro-nota" data-item="${i.id}">
    ${cuerpo}
    ${otro ? `<p class="retro-nota__editando" role="status">${escaparHtml(otro.nombre)} la está editando</p>` : ''}
    <div class="retro-nota__pie">
      <span class="retro-nota__autor">${autor}</span>
      <span class="retro-nota__acciones">${votar}${acciones}</span>
    </div>
  </li>`;
}

/**
 * Pintar las dos columnas de notas (sin tocar los formularios, para no perder lo que se escribe).
 *
 * @returns {void}
 */
function pintarNotas() {
  for (const columna of ['bien', 'mejorar']) {
    const items = ctx.datos.columnas[columna];
    el.notas[columna].innerHTML = items.length
      ? items.map(pintarNota).join('')
      : '<li class="retro-vacio">Aún no hay notas.</li>';
  }
}

/**
 * Pintar la columna de acciones.
 *
 * @returns {void}
 */
function pintarAcciones() {
  const { acciones, yo, esScrumMaster } = ctx.datos;
  el.listaAcciones.innerHTML = acciones.length
    ? acciones.map((a) => {
      const puedeCompletar = !a.completada && (a.responsable_id === yo.id || esScrumMaster);
      const estado = a.completada
        ? '<span class="insignia insignia--exito">Completada</span>'
        : a.vencida ? '<span class="insignia insignia--peligro">Vencida</span>' : '';
      return `<li class="retro-nota retro-accion${a.completada ? ' retro-accion--hecha' : ''}${a.vencida ? ' retro-accion--vencida' : ''}">
        <p class="retro-nota__texto">${escaparHtml(a.texto)}</p>
        <div class="retro-nota__pie">
          <span class="retro-nota__autor">${escaparHtml(a.responsable_nombre || 'Sin responsable')} · ${a.fecha_limite ? fechaCorta(a.fecha_limite) : 'sin fecha'}</span>
          <span class="retro-nota__acciones">${estado}
            ${puedeCompletar ? `<button class="boton boton--secundario boton--pequeno" type="button" data-completar="${a.id}">Marcar como completada</button>` : ''}
          </span>
        </div>
      </li>`;
    }).join('')
    : '<li class="retro-vacio">Aún no hay acciones.</li>';
}

/**
 * Llenar el selector de sprints y el de responsables sin perder la elección actual.
 *
 * @returns {void}
 */
function pintarSelectores() {
  const { sprints, sprint, miembros, hoy } = ctx.datos;
  el.selectorSprint.disabled = !sprints.length;
  el.selectorSprint.innerHTML = sprints.length
    ? sprints.map((s) => `<option value="${s.id}"${s.id === sprint?.id ? ' selected' : ''}>${escaparHtml(s.nombre)} · ${ETIQUETA_SPRINT[s.estado] ?? s.estado}</option>`).join('')
    : '<option value="">Sin sprints</option>';

  const elegido = el.accionResponsable.value;
  el.accionResponsable.innerHTML = '<option value="">Elige al responsable</option>'
    + miembros.map((m) => `<option value="${m.id}">${escaparHtml(m.nombre)}</option>`).join('');
  el.accionResponsable.value = elegido;
  el.accionFecha.min = hoy;
}

/**
 * Repintar toda la pantalla con los datos del servidor.
 *
 * @returns {void}
 */
function pintar() {
  const { sprint, retro, votos } = ctx.datos;
  pintarSelectores();

  if (!sprint || !retro) {
    el.tablero.hidden = true;
    el.btnCerrar.hidden = true;
    el.insigniaVotos.hidden = true;
    el.subtitulo.textContent = 'Qué salió bien, qué mejorar y qué haremos al respecto.';
    mostrarAviso('advertencia', 'Todavía no hay un sprint activo ni cerrado. La retrospectiva se abre junto con el sprint.');
    return;
  }

  const abierta = estaAbierta();
  el.tablero.hidden = false;
  el.tablero.removeAttribute('aria-busy');
  el.subtitulo.textContent = `${sprint.nombre}${abierta ? '' : ' · retrospectiva cerrada'}`;
  el.btnCerrar.hidden = !abierta;
  el.insigniaVotos.hidden = !abierta;
  el.insigniaVotos.textContent = `${votos.restantes} de ${votos.maximo} votos disponibles`;
  el.formsNota.forEach((form) => { form.hidden = !abierta; });
  el.formAccion.hidden = !abierta;
  if (!abierta) mostrarAviso('advertencia', 'Esta retrospectiva está cerrada: las notas quedan en solo lectura.');
  else if (el.aviso.textContent.startsWith('Esta retrospectiva está cerrada')) mostrarAviso('', '');

  pintarNotas();
  pintarAcciones();
  restaurarBorradores();
}

/* ====================================================================
 * Carga de datos
 * ==================================================================== */

/**
 * Consultar la retro del sprint elegido y repintar. No pisa la nota que se está editando ni lo escrito en los formularios.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    const consulta = ctx.sprintId ? `?sprint=${encodeURIComponent(ctx.sprintId)}` : '';
    ctx.datos = await api(`/retros/proyecto/${ctx.proyectoId}${consulta}`);
  } catch (error) {
    el.tablero.hidden = true;
    mostrarAviso('error', error.estado === 404
      ? 'No encontramos este proyecto o sprint, o no tienes acceso a él.'
      : error.estado === 401 ? 'Tu sesión expiró. Inicia sesión de nuevo.' : 'No pudimos cargar la retrospectiva. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  ctx.sprintId = ctx.datos.sprint?.id ?? null;
  pintar();
  pintarPendientes(el.pendientes, ctx.proyectoId);
}

el.selectorSprint.addEventListener('change', () => {
  ctx.sprintId = Number(el.selectorSprint.value) || null;
  ctx.borradoresListos = false;
  cargar();
});

/* ====================================================================
 * Notas: publicar, votar, editar y eliminar
 * ==================================================================== */

el.formsNota.forEach((form) => {
  const columna = form.dataset.columna;
  form.elements.texto.addEventListener('input', () => guardarBorrador(columna, form.elements.texto.value));

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    errorEnCampo(`error-${columna}`);
    if (!form.elements.texto.value.trim()) {
      errorEnCampo(`error-${columna}`, 'Escribe el ítem antes de publicarlo.');
      form.elements.texto.focus();
      return;
    }
    try {
      await api(`/retros/${ctx.datos.retro.id}/items`, {
        metodo: 'POST',
        cuerpo: { columna, texto: form.elements.texto.value, anonimo: form.elements.anonimo.checked },
      });
      form.reset();
      guardarBorrador(columna, '');
      await cargar();
    } catch (error) {
      if (error.estado === 400 && error.cuerpo?.detalles) errorEnCampo(`error-${columna}`, error.cuerpo.detalles.texto || error.cuerpo.detalles.columna);
      else avisarError(error, 'No pudimos publicar la nota. Tu texto quedó como borrador.');
    }
  });
});

/**
 * Terminar mi edición: apagar el latido y avisar al servidor (que lo difunde al resto).
 *
 * @param {boolean} [avisar=true] - Falso cuando el servidor ya liberó la nota (al guardar).
 * @returns {void}
 */
function terminarEdicionLocal(avisar = true) {
  if (!ctx.edicionLocal) return;
  clearInterval(ctx.edicionLocal.latido);
  if (avisar) api(`/retros/items/${ctx.edicionLocal.id}/edicion`, { metodo: 'DELETE' }).catch(() => { /* el aviso caduca solo */ });
  ctx.edicionLocal = null;
}

/**
 * Abrir el editor de una nota. Si otra persona ya la edita, el servidor responde "X la está editando".
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
async function iniciarEdicion(id) {
  const item = [...ctx.datos.columnas.bien, ...ctx.datos.columnas.mejorar].find((i) => i.id === id);
  if (!item) return;
  try {
    await api(`/retros/items/${id}/edicion`, { metodo: 'PUT' });
  } catch (error) {
    avisarError(error, 'No pudimos abrir la nota para editarla.');
    return;
  }
  terminarEdicionLocal();
  ctx.edicionLocal = {
    id,
    texto: item.texto,
    // Mientras siga editando, se renueva el aviso para que no caduque
    latido: setInterval(() => api(`/retros/items/${id}/edicion`, { metodo: 'PUT' }).catch(() => {}), INTERVALO_LATIDO_MS),
  };
  pintarNotas();
  document.querySelector(`[data-item="${id}"] [data-editor]`)?.focus();
}

/**
 * Guardar el texto editado de la nota abierta.
 *
 * @returns {Promise<void>}
 */
async function guardarEdicion() {
  const { id, texto } = ctx.edicionLocal;
  try {
    await api(`/retros/items/${id}`, { metodo: 'PATCH', cuerpo: { texto } });
    terminarEdicionLocal(false);
    mostrarAviso('', '');
    await cargar();
  } catch (error) {
    if (error.estado === 400 && error.cuerpo?.detalles?.texto) mostrarAviso('error', error.cuerpo.detalles.texto);
    else avisarError(error, 'No pudimos guardar la nota.');
  }
}

/**
 * Votar o quitar el voto de una nota.
 *
 * @param {number} id
 * @param {boolean} yaVotado
 * @returns {Promise<void>}
 */
async function votar(id, yaVotado) {
  try {
    await api(`/retros/items/${id}/voto`, { metodo: yaVotado ? 'DELETE' : 'PUT' });
    mostrarAviso('', '');
  } catch (error) {
    avisarError(error, 'No pudimos registrar tu voto.');
  }
  await cargar();
}

el.tablero.addEventListener('input', (evento) => {
  if (evento.target.matches('[data-editor]') && ctx.edicionLocal) ctx.edicionLocal.texto = evento.target.value;
});

el.tablero.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('button');
  if (!boton) return;
  if (boton.dataset.votar) {
    await votar(Number(boton.dataset.votar), boton.getAttribute('aria-pressed') === 'true');
  } else if (boton.dataset.editar) {
    await iniciarEdicion(Number(boton.dataset.editar));
  } else if (boton.dataset.guardarEdicion) {
    await guardarEdicion();
  } else if (boton.dataset.cancelarEdicion) {
    terminarEdicionLocal();
    pintarNotas();
  } else if (boton.dataset.eliminar) {
    try {
      await api(`/retros/items/${boton.dataset.eliminar}`, { metodo: 'DELETE' });
      await cargar();
    } catch (error) {
      avisarError(error, 'No pudimos eliminar la nota.');
    }
  } else if (boton.dataset.completar) {
    try {
      await api(`/retros/acciones/${boton.dataset.completar}/completar`, { metodo: 'POST' });
      await cargar();
    } catch (error) {
      avisarError(error, 'No pudimos marcar la acción como completada.');
    }
  }
});

/* ====================================================================
 * Acciones y cierre
 * ==================================================================== */

const CAMPOS_ACCION = ['texto', 'responsable_id', 'fecha_limite'];

el.formAccion.elements.texto.addEventListener('input', () => guardarBorrador('accion', el.formAccion.elements.texto.value));

el.formAccion.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  CAMPOS_ACCION.forEach((campo) => errorEnCampo(`error-accion-${campo}`));

  // Validar en el navegador (el servidor repite las reglas)
  const f = el.formAccion.elements;
  const errores = {};
  if (!f.texto.value.trim()) errores.texto = 'Describe la acción de mejora.';
  if (!f.responsable_id.value) errores.responsable_id = 'Elige quién será el responsable.';
  if (!f.fecha_limite.value) errores.fecha_limite = 'Indica la fecha límite.';
  else if (f.fecha_limite.value < ctx.datos.hoy) errores.fecha_limite = 'La fecha límite no puede ser anterior a hoy.';
  if (Object.keys(errores).length) {
    CAMPOS_ACCION.forEach((campo) => errorEnCampo(`error-accion-${campo}`, errores[campo]));
    return;
  }

  try {
    await api(`/retros/${ctx.datos.retro.id}/acciones`, {
      metodo: 'POST',
      cuerpo: { texto: f.texto.value, responsable_id: Number(f.responsable_id.value), fecha_limite: f.fecha_limite.value },
    });
    el.formAccion.reset();
    guardarBorrador('accion', '');
    await cargar();
  } catch (error) {
    if (error.estado === 400 && error.cuerpo?.detalles) {
      CAMPOS_ACCION.forEach((campo) => errorEnCampo(`error-accion-${campo}`, error.cuerpo.detalles[campo]));
    } else {
      avisarError(error, 'No pudimos crear la acción.');
    }
  }
});

el.btnCerrar.addEventListener('click', async () => {
  el.btnCerrar.disabled = true;
  try {
    await api(`/retros/${ctx.datos.retro.id}/cerrar`, { metodo: 'POST' });
    mostrarAviso('exito', 'Retrospectiva cerrada. Las acciones pendientes se recordarán en el siguiente sprint.');
    await cargar();
  } catch (error) {
    avisarError(error, 'No pudimos cerrar la retrospectiva.');
  } finally {
    el.btnCerrar.disabled = false;
  }
});

/* ====================================================================
 * Tiempo real: "X la está editando"
 * ==================================================================== */

/**
 * Mostrar u ocultar el aviso de que otra persona edita una nota. El aviso caduca solo si deja de renovarse.
 *
 * @param {{item_id: number, nombre: (string|null), segundos?: number}} aviso
 * @returns {void}
 */
function alEditar({ item_id: id, nombre, segundos = 20 }) {
  clearTimeout(ctx.editando.get(id)?.temporizador);
  if (!nombre || ctx.edicionLocal?.id === id) {
    ctx.editando.delete(id);
  } else {
    const temporizador = setTimeout(() => { ctx.editando.delete(id); if (ctx.datos) pintarNotas(); }, (segundos + 2) * 1000);
    ctx.editando.set(id, { nombre, temporizador });
  }
  if (ctx.datos?.retro) pintarNotas();
}

// Si se cierra la ventana en plena edición, liberar la nota (si no llega, el aviso caduca solo)
window.addEventListener('pagehide', () => terminarEdicionLocal());

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
    mostrarAviso('advertencia', 'Todavía no perteneces a ningún proyecto.');
    return;
  }

  ctx.proyectoId = eleccion.id;
  // Permisos del proyecto, para mostrar solo lo que le toca a su rol (cerrar la retro es del Scrum Master)
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
  await cargar();
  const socket = conectarTiempoReal(ctx.proyectoId, ['retro:actualizada'], cargar);
  if (socket) {
    escucharCambiosDeRol(socket);
    socket.on('retro:editando', alEditar);
  }
}

iniciar();
