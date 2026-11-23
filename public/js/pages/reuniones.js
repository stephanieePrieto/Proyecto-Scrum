/**
 * @file reuniones.js
 * @description Pintar la pantalla de reuniones Scrum:
 *   - Listado de reuniones (próximas y anteriores) con título, tipo, fecha y hora, participantes y notas; filtro por tipo.
 *   - El Scrum Master crea, edita y elimina reuniones; el Product Owner y los desarrolladores solo las consultan
 *     (el servidor también lo bloquea, no solo se ocultan los botones).
 *   - Sin título o sin fecha no se guarda y se marca el campo.
 *   - Se actualiza sola con Socket.io cuando alguien cambia una reunión.
 *
 * @author Diego Rafael Jiménez Trujano
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, pluralizar, conZonaHoraria } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal, mostrarSinProyecto } from './ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
  btnNueva: document.getElementById('btn-nueva'),
  filtroTipo: document.getElementById('filtro-tipo'),
  aviso: document.getElementById('aviso'),
  proximas: document.getElementById('lista-proximas'),
  anteriores: document.getElementById('lista-anteriores'),
  dialogo: document.getElementById('dialogo-reunion'),
  form: document.getElementById('form-reunion'),
  titulo: document.getElementById('reunion-titulo'),
  campoTitulo: document.getElementById('campo-titulo'),
  tipo: document.getElementById('campo-tipo'),
  fecha: document.getElementById('campo-fecha'),
  horaInicio: document.getElementById('campo-hora-inicio'),
  horaFin: document.getElementById('campo-hora-fin'),
  participantes: document.getElementById('opciones-participantes'),
  notas: document.getElementById('campo-notas'),
  zonaAyuda: document.getElementById('zona-ayuda'),
  errorReunion: document.getElementById('error-reunion'),
  btnGuardar: document.getElementById('btn-guardar'),
  dlgEliminar: document.getElementById('dialogo-eliminar'),
  eliminarTexto: document.getElementById('eliminar-texto'),
  errorEliminar: document.getElementById('error-eliminar'),
  btnEliminar: document.getElementById('btn-confirmar-eliminar'),
};

const CAMPOS = ['titulo', 'tipo', 'fecha', 'hora_inicio', 'hora_fin', 'participantes', 'notas'];
const TIPOS = { planning: 'Planning', daily: 'Daily', review: 'Review', retro: 'Retrospectiva' };

// Estado de la pantalla
const ctx = { proyectoId: null, datos: null, editando: null, eliminando: null, enviando: false };

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
 * Dar formato a la fecha y hora de una reunión en la zona horaria de la persona.
 *
 * @param {string} inicio - ISO.
 * @param {string} fin - ISO.
 * @returns {string}
 */
function horario(inicio, fin) {
  const dia = new Date(inicio).toLocaleDateString('es', conZonaHoraria({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const hora = (iso) => new Date(iso).toLocaleTimeString('es', conZonaHoraria({ hour: '2-digit', minute: '2-digit' }));
  return `${dia} · ${hora(inicio)} a ${hora(fin)}`;
}

/**
 * Mostrar u ocultar el error de un campo del formulario por su id (`error-<campo>`).
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
  const control = el.form.elements[campo];
  if (control?.setAttribute) control.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
}

/**
 * Mensaje para un error de la API que no es de un campo.
 *
 * @param {Object} error
 * @param {string} predeterminado
 * @returns {string}
 */
function mensajeDeError(error, predeterminado) {
  if (error.estado === 403) return 'Solo el Scrum Master puede crear, editar o eliminar reuniones.';
  if (error.estado === undefined) return 'Se perdió la conexión. No se cambió nada: vuelve a intentarlo.';
  return error.cuerpo?.mensaje || predeterminado;
}

/* ====================================================================
 * Listado
 * ==================================================================== */

/**
 * Pintar una reunión. Los botones de editar y eliminar solo se pintan para el Scrum Master.
 *
 * @param {Object} r - Reunión tal como la devuelve la API.
 * @returns {string}
 */
function pintarReunion(r) {
  const acciones = ctx.datos.puedeGestionar
    ? `<span>
        <button class="boton boton--secundario" type="button" data-editar="${r.id}">Editar</button>
        <button class="boton boton--secundario boton--peligro" type="button" data-eliminar="${r.id}">Eliminar</button>
      </span>`
    : '';
  const participantes = r.participantes.length
    ? r.participantes.map((p) => escaparHtml(p.nombre)).join(', ')
    : 'Sin participantes indicados';
  return `<article class="tarjeta ciclo-sprint" data-id="${r.id}">
    <div class="ciclo-sprint__cabecera">
      <h3 class="ciclo-sprint__nombre"><span class="punto ev--${r.tipo}" aria-hidden="true"></span> ${escaparHtml(r.titulo)}
        <span class="insignia insignia--neutro">${TIPOS[r.tipo] ?? r.tipo}</span></h3>
      ${acciones}
    </div>
    <div class="ciclo-sprint__datos">
      <span>${horario(r.iniciaEn, r.terminaEn)}</span>
      <span>${pluralizar(r.participantes.length, 'Participante', 'Participantes')}: ${participantes}</span>
    </div>
    ${r.notas ? `<p class="ciclo-sprint__objetivo">${escaparHtml(r.notas)}</p>` : ''}
    <p class="ciclo__ayuda">Creada por ${escaparHtml(r.creadoPorNombre || 'una persona que ya no está en el proyecto')}${r.actualizadoEn ? ' · editada' : ''}</p>
  </article>`;
}

/**
 * Pintar el listado según el filtro de tipo: próximas (de la más cercana a la más lejana) y anteriores (la más reciente primero).
 *
 * @returns {void}
 */
function pintar() {
  el.proximas.removeAttribute('aria-busy');
  const tipo = el.filtroTipo.value;
  const lista = ctx.datos.reuniones.filter((r) => !tipo || r.tipo === tipo);
  const ahora = Date.now();
  const proximas = lista.filter((r) => new Date(r.terminaEn).getTime() >= ahora);
  const anteriores = lista.filter((r) => new Date(r.terminaEn).getTime() < ahora).reverse();
  const vacio = (texto) => `<p class="ciclo-vacio">${texto}</p>`;
  el.proximas.innerHTML = proximas.length
    ? proximas.map(pintarReunion).join('')
    : vacio(ctx.datos.puedeGestionar ? 'No hay reuniones próximas. Crea una con «Nueva reunión».' : 'No hay reuniones próximas.');
  el.anteriores.innerHTML = anteriores.length ? anteriores.map(pintarReunion).join('') : vacio('No hay reuniones anteriores.');
}

/**
 * Consultar las reuniones del proyecto y repintar.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    ctx.datos = await api(`/calendario/proyecto/${ctx.proyectoId}/reuniones`);
  } catch (error) {
    el.proximas.removeAttribute('aria-busy');
    el.proximas.innerHTML = '';
    el.anteriores.innerHTML = '';
    mostrarAviso('error', error.estado === 404
      ? 'No encontramos este proyecto o no tienes acceso a él.'
      : 'No pudimos cargar las reuniones. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  pintar();
}

el.filtroTipo.addEventListener('change', () => { if (ctx.datos) pintar(); });

/* ====================================================================
 * Crear y editar (solo Scrum Master)
 * ==================================================================== */

/**
 * Abrir el diálogo para crear (sin reunión) o editar una reunión.
 *
 * @param {Object|null} reunion
 * @returns {void}
 */
function abrirDialogo(reunion = null) {
  ctx.editando = reunion;
  el.form.reset();
  CAMPOS.forEach((campo) => errorDeCampo(campo));
  el.errorReunion.hidden = true;
  el.titulo.textContent = reunion ? 'Editar reunión' : 'Nueva reunión';
  el.campoTitulo.value = reunion?.titulo ?? '';
  el.tipo.value = reunion?.tipo ?? (el.filtroTipo.value || 'planning');
  el.fecha.value = reunion?.fecha ?? '';
  el.horaInicio.value = reunion?.horaInicio ?? '';
  el.horaFin.value = reunion?.horaFin ?? '';
  el.notas.value = reunion?.notas ?? '';
  const elegidos = new Set((reunion?.participantes ?? []).map((p) => p.id));
  el.participantes.innerHTML = ctx.datos.miembros.length
    ? ctx.datos.miembros.map((m) => `<label><input type="checkbox" name="participantes" value="${m.id}"${elegidos.has(m.id) ? ' checked' : ''} />
        ${escaparHtml(m.nombre)}</label>`).join('')
    : '<p class="ciclo__ayuda">El proyecto no tiene integrantes activos.</p>';
  el.zonaAyuda.textContent = `La fecha y las horas se guardan en tu zona horaria (${ctx.datos.zona}); cada persona las ve en la suya.`;
  el.dialogo.showModal();
  el.campoTitulo.focus();
}

el.btnNueva.addEventListener('click', () => { if (ctx.datos) abrirDialogo(); });

el.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.enviando) return;
  CAMPOS.forEach((campo) => errorDeCampo(campo));
  el.errorReunion.hidden = true;

  // Validar en el navegador (el servidor repite las reglas): título y fecha son obligatorios
  const errores = {};
  if (!el.campoTitulo.value.trim()) errores.titulo = 'Escribe un título para la reunión.';
  if (!el.fecha.value) errores.fecha = 'Indica la fecha de la reunión.';
  if (Object.keys(errores).length) {
    Object.entries(errores).forEach(([campo, mensaje]) => errorDeCampo(campo, mensaje));
    el.form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  const cuerpo = {
    titulo: el.campoTitulo.value,
    tipo: el.tipo.value,
    fecha: el.fecha.value,
    hora_inicio: el.horaInicio.value || null,
    hora_fin: el.horaFin.value || null,
    participantes: [...el.form.querySelectorAll('input[name="participantes"]:checked')].map((c) => Number(c.value)),
    notas: el.notas.value,
  };

  ctx.enviando = true;
  el.btnGuardar.disabled = true;
  try {
    if (ctx.editando) await api(`/calendario/reuniones/${ctx.editando.id}`, { metodo: 'PUT', cuerpo });
    else await api(`/calendario/proyecto/${ctx.proyectoId}/reuniones`, { metodo: 'POST', cuerpo });
    el.dialogo.close();
    mostrarAviso('exito', ctx.editando ? 'Reunión actualizada.' : 'Reunión creada.');
    await cargar();
  } catch (error) {
    const d = error.cuerpo?.detalles;
    if (error.estado === 400 && d) {
      Object.entries(d).forEach(([campo, mensaje]) => errorDeCampo(campo, mensaje));
      el.form.querySelector('[aria-invalid="true"]')?.focus();
    } else {
      el.errorReunion.textContent = mensajeDeError(error, 'No pudimos guardar la reunión. Inténtalo de nuevo.');
      el.errorReunion.hidden = false;
      if (error.estado === 404) await cargar();
    }
  } finally {
    ctx.enviando = false;
    el.btnGuardar.disabled = false;
  }
});

/* ====================================================================
 * Eliminar (solo Scrum Master)
 * ==================================================================== */

document.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-cerrar]')) {
    evento.target.closest('dialog').close();
    return;
  }
  const boton = evento.target.closest('[data-editar], [data-eliminar]');
  if (!boton || !ctx.datos) return;
  const reunion = ctx.datos.reuniones.find((r) => r.id === Number(boton.dataset.editar || boton.dataset.eliminar));
  if (!reunion) return;
  if (boton.dataset.editar) {
    abrirDialogo(reunion);
    return;
  }
  ctx.eliminando = reunion;
  el.eliminarTexto.textContent = `Se eliminará «${reunion.titulo}» (${horario(reunion.iniciaEn, reunion.terminaEn)}). Esta acción no se puede deshacer.`;
  el.errorEliminar.hidden = true;
  el.dlgEliminar.showModal();
});

el.btnEliminar.addEventListener('click', async () => {
  if (!ctx.eliminando || ctx.enviando) return;
  ctx.enviando = true;
  el.btnEliminar.disabled = true;
  try {
    await api(`/calendario/reuniones/${ctx.eliminando.id}`, { metodo: 'DELETE' });
    el.dlgEliminar.close();
    mostrarAviso('exito', 'Reunión eliminada.');
    await cargar();
  } catch (error) {
    el.errorEliminar.textContent = mensajeDeError(error, 'No pudimos eliminar la reunión. Inténtalo de nuevo.');
    el.errorEliminar.hidden = false;
    if (error.estado === 404) await cargar();
  } finally {
    ctx.enviando = false;
    el.btnEliminar.disabled = false;
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
    el.proximas.removeAttribute('aria-busy');
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
  const socket = conectarTiempoReal(ctx.proyectoId, ['calendario:actualizado'], cargar);
  if (socket) escucharCambiosDeRol(socket);
}

iniciar();
