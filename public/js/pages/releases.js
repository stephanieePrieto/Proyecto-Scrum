/**
 * @file releases.js
 * @description Pintar la pantalla de releases:
 *   - Línea de tiempo: cada release con sus sprints en orden cronológico y el % de avance del release y de cada sprint.
 *   - El Product Owner crea, edita y elimina releases y les asigna o quita sprints. El resto del equipo solo consulta.
 *   - Un sprint que ya está en otro release no se puede asignar: se muestra la explicación del servidor.
 *   - Eliminar un release pide confirmación y deja sus sprints sin release (no se borra ningún sprint).
 *   - Se actualiza sola con Socket.io cuando alguien cambia un release o inicia/cierra un sprint.
 *
 * @author Diego Rafael Jiménez Trujano
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
  btnNuevo: document.getElementById('btn-nuevo'),
  aviso: document.getElementById('aviso'),
  lista: document.getElementById('lista-releases'),
  sinRelease: document.getElementById('lista-sin-release'),
  dialogo: document.getElementById('dialogo-release'),
  form: document.getElementById('form-release'),
  titulo: document.getElementById('release-titulo'),
  nombre: document.getElementById('campo-nombre'),
  descripcion: document.getElementById('campo-descripcion'),
  fecha: document.getElementById('campo-fecha'),
  campoSprints: document.getElementById('campo-sprints'),
  opcionesSprints: document.getElementById('opciones-sprints'),
  errorRelease: document.getElementById('error-release'),
  btnGuardar: document.getElementById('btn-guardar'),
  dlgEliminar: document.getElementById('dialogo-eliminar'),
  eliminarTexto: document.getElementById('eliminar-texto'),
  errorEliminar: document.getElementById('error-eliminar'),
  btnEliminar: document.getElementById('btn-confirmar-eliminar'),
};

const CAMPOS = ['nombre', 'descripcion', 'fecha_objetivo', 'sprints'];
const ESTADO_SPRINT = {
  planificado: { texto: 'Planificado', insignia: 'insignia--neutro' },
  activo: { texto: 'Activo', insignia: 'insignia--exito' },
  cerrado: { texto: 'Cerrado', insignia: 'insignia--info' },
};

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
 * Dar formato corto a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @returns {string}
 */
const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Pintar una barra de avance (reutiliza la barra de la pantalla de capacidad).
 *
 * @param {number} porcentaje - 0 a 100.
 * @param {string} etiqueta - Texto para lectores de pantalla.
 * @returns {string}
 */
const barra = (porcentaje, etiqueta) => `<div class="resumen__miembro-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"
  aria-valuenow="${porcentaje}" aria-label="${escaparHtml(etiqueta)}"><div class="resumen__miembro-relleno" style="width:${porcentaje}%"></div></div>`;

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
  if (error.estado === 403) return 'Solo el Product Owner puede gestionar los releases.';
  if (error.estado === undefined) return 'Se perdió la conexión. No se cambió nada: vuelve a intentarlo.';
  return error.cuerpo?.mensaje || predeterminado;
}

/* ====================================================================
 * Línea de tiempo
 * ==================================================================== */

/**
 * Pintar un sprint dentro de la línea de tiempo de su release.
 *
 * @param {Object} s - Sprint tal como lo devuelve la API.
 * @param {Object} release
 * @returns {string}
 */
function pintarSprint(s, release) {
  const estado = ESTADO_SPRINT[s.estado] ?? ESTADO_SPRINT.planificado;
  const quitar = ctx.datos.puedeGestionar
    ? `<button class="boton boton--secundario boton--pequeno" type="button" data-quitar="${s.id}" data-release="${release.id}">Quitar</button>`
    : '';
  return `<li class="release-linea__sprint release-linea__sprint--${s.estado}">
    <strong>${escaparHtml(s.nombre)}</strong> <span class="insignia ${estado.insignia}">${estado.texto}</span>
    <div class="ciclo__ayuda">${fechaCorta(s.fecha_inicio)} – ${fechaCorta(s.fecha_fin)}</div>
    ${barra(s.porcentaje, `Avance de ${s.nombre}`)}
    <div>${s.puntosTerminados} de ${s.puntos} pts · ${s.porcentaje}%</div>
    ${quitar}
  </li>`;
}

/**
 * Pintar un release con su avance, su línea de tiempo y (para el PO) sus acciones.
 *
 * @param {Object} r - Release tal como lo devuelve la API.
 * @returns {string}
 */
function pintarRelease(r) {
  const { puedeGestionar, sinRelease } = ctx.datos;
  const p = r.progreso;
  const acciones = puedeGestionar
    ? `<span>
        <button class="boton boton--secundario" type="button" data-editar="${r.id}">Editar</button>
        <button class="boton boton--secundario boton--peligro" type="button" data-eliminar="${r.id}">Eliminar</button>
      </span>`
    : '';
  const periodo = r.inicio ? `${fechaCorta(r.inicio)} – ${fechaCorta(r.fin)}` : 'Sin sprints todavía';
  const linea = r.sprints.length
    ? `<ol class="release-linea" aria-label="Sprints de ${escaparHtml(r.nombre)}">${r.sprints.map((s) => pintarSprint(s, r)).join('')}</ol>`
    : '<p class="ciclo__ayuda">Este release todavía no tiene sprints.</p>';
  const agregar = puedeGestionar && sinRelease.length
    ? `<div class="release-avance">
        <label class="solo-lectores" for="agregar-${r.id}">Sprint para agregar a ${escaparHtml(r.nombre)}</label>
        <select class="form-input" id="agregar-${r.id}" data-sprint-para="${r.id}">
          <option value="">Agregar un sprint…</option>
          ${sinRelease.map((s) => `<option value="${s.id}">${escaparHtml(s.nombre)} (${fechaCorta(s.fecha_inicio)})</option>`).join('')}
        </select>
        <button class="boton boton--secundario" type="button" data-agregar="${r.id}">Agregar</button>
      </div>`
    : '';

  return `<article class="tarjeta ciclo-sprint" data-id="${r.id}">
    <div class="ciclo-sprint__cabecera">
      <h3 class="ciclo-sprint__nombre">${escaparHtml(r.nombre)} <span class="insignia insignia--info">${p.porcentaje}%</span></h3>
      ${acciones}
    </div>
    <div class="ciclo-sprint__datos">
      <span>${periodo}</span>
      ${r.fecha_objetivo ? `<span>Fecha objetivo: ${fechaCorta(r.fecha_objetivo)}</span>` : ''}
      <span>${p.terminados} de ${p.puntos} pts terminados</span>
      <span>${p.sprintsCerrados} de ${p.sprintsTotal} ${pluralizar(p.sprintsTotal, 'sprint cerrado', 'sprints cerrados')}</span>
    </div>
    <div class="release-avance">${barra(p.porcentaje, `Avance del release ${r.nombre}`)}<strong>${p.porcentaje}%</strong></div>
    ${r.descripcion ? `<p class="ciclo-sprint__objetivo">${escaparHtml(r.descripcion)}</p>` : ''}
    ${linea}
    ${agregar}
  </article>`;
}

/**
 * Pintar los sprints que no pertenecen a ningún release.
 *
 * @returns {void}
 */
function pintarSinRelease() {
  const { sinRelease } = ctx.datos;
  el.sinRelease.innerHTML = sinRelease.length
    ? `<ol class="release-linea">${sinRelease.map((s) => {
      const estado = ESTADO_SPRINT[s.estado] ?? ESTADO_SPRINT.planificado;
      return `<li class="release-linea__sprint release-linea__sprint--${s.estado}">
        <strong>${escaparHtml(s.nombre)}</strong> <span class="insignia ${estado.insignia}">${estado.texto}</span>
        <div class="ciclo__ayuda">${fechaCorta(s.fecha_inicio)} – ${fechaCorta(s.fecha_fin)}</div>
        <div>${s.puntos} pts</div>
      </li>`;
    }).join('')}</ol>`
    : '<p class="ciclo-vacio">Todos los sprints están agrupados en un release.</p>';
}

/**
 * Consultar los releases del proyecto y repintar la pantalla.
 *
 * @returns {Promise<void>}
 */
async function cargar() {
  try {
    ctx.datos = await api(`/releases/proyecto/${ctx.proyectoId}`);
  } catch (error) {
    el.lista.removeAttribute('aria-busy');
    el.lista.innerHTML = '';
    el.sinRelease.innerHTML = '';
    mostrarAviso('error', error.estado === 404
      ? 'No encontramos este proyecto o no tienes acceso a él.'
      : 'No pudimos cargar los releases. Revisa tu conexión e inténtalo de nuevo.');
    return;
  }
  el.lista.removeAttribute('aria-busy');
  el.lista.innerHTML = ctx.datos.releases.length
    ? ctx.datos.releases.map(pintarRelease).join('')
    : `<p class="ciclo-vacio">${ctx.datos.puedeGestionar
      ? 'Todavía no hay releases. Crea uno y asígnale sprints.'
      : 'Todavía no hay releases. El Product Owner puede crearlos.'}</p>`;
  pintarSinRelease();
}

/* ====================================================================
 * Crear y editar
 * ==================================================================== */

/**
 * Abrir el diálogo para crear (sin release) o editar un release.
 *
 * @param {Object|null} release
 * @returns {void}
 */
function abrirDialogo(release = null) {
  ctx.editando = release;
  el.form.reset();
  CAMPOS.forEach((campo) => errorDeCampo(campo));
  el.errorRelease.hidden = true;
  el.titulo.textContent = release ? 'Editar release' : 'Nuevo release';
  el.nombre.value = release?.nombre ?? '';
  el.descripcion.value = release?.descripcion ?? '';
  el.fecha.value = release?.fecha_objetivo ?? '';
  // Al crear se pueden elegir de una vez los sprints que todavía no tienen release
  const libres = ctx.datos.sinRelease;
  el.campoSprints.hidden = Boolean(release) || !libres.length;
  el.opcionesSprints.innerHTML = libres.map((s) => `<label><input type="checkbox" name="sprints" value="${s.id}" /> ${escaparHtml(s.nombre)}
    <span class="ciclo__ayuda">(${fechaCorta(s.fecha_inicio)} – ${fechaCorta(s.fecha_fin)})</span></label>`).join('');
  el.dialogo.showModal();
  el.nombre.focus();
}

el.btnNuevo.addEventListener('click', () => { if (ctx.datos) abrirDialogo(); });

el.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (ctx.enviando) return;
  CAMPOS.forEach((campo) => errorDeCampo(campo));
  el.errorRelease.hidden = true;

  // Validar en el navegador (el servidor repite las reglas): el nombre es obligatorio
  if (!el.nombre.value.trim()) {
    errorDeCampo('nombre', 'Escribe un nombre para el release.');
    el.nombre.focus();
    return;
  }

  const cuerpo = { nombre: el.nombre.value, descripcion: el.descripcion.value, fecha_objetivo: el.fecha.value || null };
  if (!ctx.editando) cuerpo.sprints = [...el.form.querySelectorAll('input[name="sprints"]:checked')].map((c) => Number(c.value));

  ctx.enviando = true;
  el.btnGuardar.disabled = true;
  try {
    if (ctx.editando) await api(`/releases/${ctx.editando.id}`, { metodo: 'PUT', cuerpo });
    else await api(`/releases/proyecto/${ctx.proyectoId}`, { metodo: 'POST', cuerpo });
    el.dialogo.close();
    mostrarAviso('exito', ctx.editando ? 'Release actualizado.' : 'Release creado.');
    await cargar();
  } catch (error) {
    const d = error.cuerpo?.detalles;
    if (d && (error.estado === 400 || (error.estado === 409 && d.nombre))) {
      Object.entries(d).forEach(([campo, mensaje]) => errorDeCampo(campo, mensaje));
    } else {
      el.errorRelease.textContent = mensajeDeError(error, 'No pudimos guardar el release. Inténtalo de nuevo.');
      el.errorRelease.hidden = false;
    }
  } finally {
    ctx.enviando = false;
    el.btnGuardar.disabled = false;
  }
});

/* ====================================================================
 * Asignar, quitar y eliminar
 * ==================================================================== */

/**
 * Ejecutar una acción sobre un release y recargar; si falla, mostrar la explicación del servidor.
 *
 * @param {Function} accion - Devuelve la promesa de la petición.
 * @param {string} exito - Aviso cuando sale bien.
 * @param {string} fallo - Aviso cuando falla sin explicación.
 * @returns {Promise<void>}
 */
async function ejecutar(accion, exito, fallo) {
  try {
    await accion();
    mostrarAviso('exito', exito);
  } catch (error) {
    // 409: el sprint ya pertenece a otro release (la explicación viene del servidor)
    mostrarAviso(error.estado === 409 ? 'advertencia' : 'error', mensajeDeError(error, fallo));
  }
  await cargar();
}

el.lista.addEventListener('click', (evento) => {
  const boton = evento.target.closest('button');
  if (!boton || !ctx.datos) return;
  const buscar = (id) => ctx.datos.releases.find((r) => r.id === Number(id));

  if (boton.dataset.editar) {
    abrirDialogo(buscar(boton.dataset.editar));
  } else if (boton.dataset.eliminar) {
    const release = buscar(boton.dataset.eliminar);
    if (!release) return;
    ctx.eliminando = release;
    const n = release.sprints.length;
    el.eliminarTexto.textContent = `Se eliminará «${release.nombre}». ${n
      ? `Sus ${n} ${pluralizar(n, 'sprint se conserva', 'sprints se conservan')} y ${pluralizar(n, 'queda', 'quedan')} sin release.`
      : 'No tiene sprints.'}`;
    el.errorEliminar.hidden = true;
    el.dlgEliminar.showModal();
  } else if (boton.dataset.agregar) {
    const select = el.lista.querySelector(`[data-sprint-para="${boton.dataset.agregar}"]`);
    if (!select?.value) {
      mostrarAviso('advertencia', 'Elige el sprint que quieres agregar al release.');
      select?.focus();
      return;
    }
    boton.disabled = true;
    ejecutar(
      () => api(`/releases/${boton.dataset.agregar}/sprints`, { metodo: 'POST', cuerpo: { sprint_id: Number(select.value) } }),
      'Sprint agregado al release.',
      'No pudimos agregar el sprint. Inténtalo de nuevo.',
    );
  } else if (boton.dataset.quitar) {
    boton.disabled = true;
    ejecutar(
      () => api(`/releases/${boton.dataset.release}/sprints/${boton.dataset.quitar}`, { metodo: 'DELETE' }),
      'Sprint quitado del release. El sprint se conserva.',
      'No pudimos quitar el sprint. Inténtalo de nuevo.',
    );
  }
});

el.btnEliminar.addEventListener('click', async () => {
  if (!ctx.eliminando || ctx.enviando) return;
  ctx.enviando = true;
  el.btnEliminar.disabled = true;
  try {
    const r = await api(`/releases/${ctx.eliminando.id}`, { metodo: 'DELETE' });
    el.dlgEliminar.close();
    const n = r.sprintsLiberados?.length ?? 0;
    mostrarAviso('exito', `Release eliminado.${n ? ` ${n} ${pluralizar(n, 'sprint quedó', 'sprints quedaron')} sin release.` : ''}`);
    await cargar();
  } catch (error) {
    el.errorEliminar.textContent = mensajeDeError(error, 'No pudimos eliminar el release. Inténtalo de nuevo.');
    el.errorEliminar.hidden = false;
  } finally {
    ctx.enviando = false;
    el.btnEliminar.disabled = false;
  }
});

document.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-cerrar]')) evento.target.closest('dialog').close();
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
    mostrarSinProyecto(!eleccion.proyectos.length);
    return;
  }
  ctx.proyectoId = eleccion.id;
  // Permisos del proyecto elegido, para mostrar solo lo que le toca a su rol
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
  await cargar();
  const socket = conectarTiempoReal(ctx.proyectoId, ['release:actualizado', 'sprint:iniciado', 'sprint:cerrado'], cargar);
  if (socket) escucharCambiosDeRol(socket);
}

iniciar();
