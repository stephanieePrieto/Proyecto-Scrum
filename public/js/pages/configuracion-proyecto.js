/**
 * @file configuracion-proyecto.js
 * @description Crear/editar proyecto, Definition of Done y archivado.
 *  - /configuracion-proyecto.html          -> crear
 *  - /configuracion-proyecto.html?id=7     -> editar el proyecto 7
 *
 * NOTA: api.js (BASE) descarta el cuerpo de las respuestas con error, y aquí se necesita para
 * mostrar los errores por campo y las diferencias de versión. Por eso esta página usa su propia
 * función "llamar". Propuesta para el equipo: que api.js guarde el cuerpo en error.cuerpo.
 *
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */
import { montarBarraSuperior } from '../core/layout.js';
import { obtenerTokenCsrf } from '../core/seguridad.js';
import { escaparHtml } from '../core/utils.js';
import { cargarPermisos } from '../core/permisos-ui.js';
import { abrirAsistenteModo, NOMBRES_MODO } from '../componentes/asistente-modo.js';

const $ = (id) => document.getElementById(id);
const CAMPOS = ['nombre', 'vision', 'fecha_inicio', 'fecha_fin', 'definition_of_done', 'github_repo_url'];
const ETIQUETAS = {
  nombre: 'Nombre', vision: 'Visión', fecha_inicio: 'Fecha de inicio',
  fecha_fin: 'Fecha de fin', definition_of_done: 'Definition of Done',
  github_repo_url: 'Repositorio de GitHub',
};

const id = new URLSearchParams(location.search).get('id');
const editando = Boolean(id);
let versionActual = null;
let guardando = false;
let datosPuedeEliminar = false;
let datosPuedeGestionar = false;

// ---------- Utilidades ----------

/**
 * Petición que conserva el cuerpo de la respuesta aunque sea un error.
 * La sesión viaja en la cookie httpOnly; los métodos que modifican datos
 * deben repetir el token CSRF en la cabecera X-CSRF-Token (HU-53).
 */
async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (metodo !== 'GET') headers['X-CSRF-Token'] = obtenerTokenCsrf();
  const respuesta = await fetch(`/api${ruta}`, {
    method: metodo,
    credentials: 'same-origin',
    headers,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let datos = {};
  try { datos = await respuesta.json(); } catch { /* respuesta sin JSON */ }
  if (respuesta.status === 401) { location.href = '/pages/login.html'; }   // Sin sesión: ir al login
  // Sin aviso vigente aceptado: ir a aceptarlo antes de seguir, como hace api.js
  if (respuesta.status === 403 && datos?.detalles?.codigo === 'AVISO_PENDIENTE'
    && !window.location.pathname.endsWith('/privacidad.html')) {
    location.href = '/pages/privacidad.html?pendiente=1';
  }
  return { ok: respuesta.ok, estado: respuesta.status, datos };
}

/** Mostrar un aviso general. tipo: 'exito' | 'error'. */
function avisar(texto, tipo) {
  const caja = $('mensaje');
  caja.textContent = texto;
  caja.className = `mensaje--${tipo}`;
  caja.hidden = false;
}

function limpiarErrores() {
  document.querySelectorAll('.proy-error, .eq-error').forEach((p) => { p.textContent = ''; });
  CAMPOS.concat('equipo_id', 'nombre_equipo_nuevo').forEach((c) => $(c)?.removeAttribute('aria-invalid'));
  $('mensaje').hidden = true;
}

/** Pintar los errores por campo que devuelve el servidor y enfocar el primero. */
function mostrarErroresCampos(campos = {}) {
  let primero = null;
  Object.entries(campos).forEach(([campo, texto]) => {
    const caja = $(`error-${campo}`);
    if (!caja) return;
    caja.textContent = texto;
    $(campo)?.setAttribute('aria-invalid', 'true');
    primero ??= $(campo);
  });
  primero?.focus();
}

function leerFormulario() {
  const datos = Object.fromEntries(CAMPOS.map((c) => [c, $(c).value]));

  if (!editando) {
    datos.equipo_id = $('equipo_id').value;
    if (datos.equipo_id === 'nuevo') datos.nombre_equipo_nuevo = $('nombre_equipo_nuevo').value;
    datos.miembros = Array.from(document.querySelectorAll('.rol-miembro'))
      .filter(select => select.value !== "")
      .map(select => ({
        usuario_id: parseInt(select.dataset.usuario),
        rol: select.value
      }));
  } else {
    datos.version = versionActual;
  }
  return datos;
}

function rellenarFormulario(p) {
  CAMPOS.forEach((c) => { $(c).value = p[c] ?? ''; });
  versionActual = p.version;
}

// ---------- Carga inicial ----------

async function cargarEquipos() {
  const { ok, estado, datos } = await llamar('/proyectos/equipos-disponibles');
  if (!ok) { const e = new Error('equipos'); e.estado = estado; throw e; }
  const select = $('equipo_id');
  select.innerHTML = '<option value="">Selecciona un equipo</option>' +
    datos.equipos.map((e) => `<option value="${e.id}"></option>`).join('');
  // Asignar el texto con textContent (nunca con innerHTML) para evitar XSS
  datos.equipos.forEach((e, i) => { select.options[i + 1].textContent = e.nombre; });
  select.add(new Option('Crear equipo nuevo', 'nuevo'));
  if (!editando) $('definition_of_done').value = datos.dod_base;
}

async function cargarProyecto() {
  const { ok, estado, datos } = await llamar(`/proyectos/${encodeURIComponent(id)}`);
  if (!ok) {
    avisar(estado === 404 ? 'No encontramos este proyecto.' : 'No se pudo cargar el proyecto. Recarga la página.', 'error');
    return null;
  }
  if (!datos.puede_gestionar && !datos.puede_eliminar) {
    avisar('No tienes permisos para administrar este proyecto.', 'error');
    return null;
  }
  const p = datos.proyecto;
  datosPuedeEliminar = datos.puede_eliminar === true;
  datosPuedeGestionar = datos.puede_gestionar === true;
  rellenarFormulario(p);
  const select = $('equipo_id');
  select.innerHTML = '<option></option>';
  select.options[0].textContent = p.equipo_nombre;   // el equipo no se cambia al editar
  select.disabled = true;
  return p;
}

async function iniciar() {
  montarBarraSuperior();

  // No permitir fechas anteriores a hoy al crear un proyecto.
  if (!editando) {
    const hoy = new Date();
    const fechaLocal = [
      hoy.getFullYear(),
      String(hoy.getMonth() + 1).padStart(2, '0'),
      String(hoy.getDate()).padStart(2, '0')
    ].join('-');

    $('fecha_inicio').min = fechaLocal;
  }

  try {
    if (editando) {
      $('titulo').textContent = 'Editar proyecto';
      // Permisos del proyecto que se está editando
      cargarPermisos(Number(id)).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
      const proyecto = await cargarProyecto();
      if (!proyecto) return;
      if (proyecto.archivado) {
        avisar('Este proyecto está archivado y no se puede editar.', 'error');
        return;
      }
      if (datosPuedeGestionar) $('zona-archivar').hidden = false;
      if (datosPuedeEliminar) $('zona-eliminar').hidden = false;
      mostrarModo(proyecto);
      cargarTransferencia().catch(() => { /* sin rol que transferir: la sección queda oculta */ });
    } else {
      await cargarEquipos();
    }
    $('formulario').hidden = editando && !datosPuedeGestionar;
  } catch (error) {
    avisar(error.estado === 403
      ? 'Solo un administrador puede crear o editar proyectos.'
      : 'No se pudo cargar el formulario. Revisa tu conexión y recarga la página.', 'error');
  }
}

// ---------- Guardar ----------

async function guardar(datos) {
  if (guardando) return;
  guardando = true;
  const boton = $('guardar');
  boton.disabled = true;
  limpiarErrores();

  try {
    const res = editando
      ? await llamar(`/proyectos/${encodeURIComponent(id)}`, { metodo: 'PUT', cuerpo: datos })
      : await llamar('/proyectos', { metodo: 'POST', cuerpo: datos });

    if (res.ok) {
      if (!editando) {
        const nuevoId = res.datos.proyecto?.id;
        if (nuevoId) localStorage.setItem('proyectoActivo', nuevoId);
        location.href = nuevoId ? `/pages/dashboard.html?proyecto=${nuevoId}` : '/pages/dashboard.html';
        return;
      }
      rellenarFormulario(res.datos.proyecto);
      avisar('Cambios guardados.', 'exito');
    } else if (res.estado === 409 && res.datos.detalles?.conflicto) {
      abrirConflicto(datos, res.datos.detalles.actual);
    } else if (res.datos.detalles?.campos) {
      mostrarErroresCampos(res.datos.detalles.campos);
    } else if (res.estado === 403) {
      avisar('No tienes permiso para guardar este proyecto.', 'error');
    } else {
      avisar('No se pudo guardar. Tus datos siguen en el formulario; inténtalo de nuevo.', 'error');
    }
  } catch {
    avisar('Sin conexión. Tus datos siguen en el formulario; inténtalo de nuevo al reconectar.', 'error');
  } finally {
    guardando = false;
    boton.disabled = false;
  }
}

$('equipo_id').addEventListener('change', async (e) => {
  const equipoId = e.target.value;
  const nuevo = !editando && equipoId === 'nuevo';
  $('seccion-equipo-nuevo').hidden = !nuevo;
  $('nombre_equipo_nuevo').required = nuevo;
  const seccion = $('seccion-miembros-proyecto');
  const lista = $('lista-miembros-equipo');

  if (!equipoId || editando || nuevo) {
    seccion.hidden = true;
    return;
  }

  lista.innerHTML = '<p>Cargando integrantes...</p>';
  seccion.hidden = false;

  const { ok, datos } = await llamar(`/equipos/${equipoId}`);
  if (ok && datos.equipo && datos.equipo.miembros.length) {
    lista.innerHTML = datos.equipo.miembros.map(m => `
            <div class="eq-fila" style="padding: 12px; border: 1px solid var(--borde); border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong style="display: block; font-size: 0.9rem;">${escaparHtml(m.nombre)}</strong>
                    <small style="color: var(--texto-secundario);">${escaparHtml(m.correo)}</small>
                </div>
                <select class="form-select rol-miembro" data-usuario="${m.id}" style="width: auto; padding: 4px 8px; font-size: 0.9rem;">
                    <option value="">No invitar aún</option>
                    <option value="developer">Developer</option>
                    <option value="scrum_master">Scrum Master</option>
                    <option value="product_owner">Product Owner</option>
                </select>
            </div>
        `).join('');
  } else {
    lista.innerHTML = '<p>No hay otros integrantes en este equipo.</p>';
  }
});


$('formulario').addEventListener('submit', (evento) => {
  evento.preventDefault();

  const datos = leerFormulario();

  // Validar la fecha de inicio solamente al crear proyectos.
  if (!editando) {
    const fechaMinima = $('fecha_inicio').min;

    if (datos.fecha_inicio && datos.fecha_inicio < fechaMinima) {
      limpiarErrores();
      mostrarErroresCampos({
        fecha_inicio: 'La fecha de inicio no puede ser anterior a hoy.'
      });
      return;
    }
  }

  guardar(datos);
});


// ---------- Conflicto de versión ----------

let versionServidor = null;

function abrirConflicto(mia, actual) {
  versionServidor = actual;
  const filas = CAMPOS
    .filter((c) => String(mia[c] ?? '') !== String(actual[c] ?? ''))
    .map((c) => `<tr><th scope="row"></th><td></td><td></td></tr>`);
  const cuerpo = $('conflicto-filas');
  cuerpo.innerHTML = filas.join('');
  // textContent en cada celda: nada de lo escrito por usuarios se interpreta como HTML
  CAMPOS.filter((c) => String(mia[c] ?? '') !== String(actual[c] ?? '')).forEach((c, i) => {
    const celdas = cuerpo.rows[i].cells;
    celdas[0].textContent = ETIQUETAS[c];
    celdas[1].textContent = mia[c];
    celdas[2].textContent = actual[c];
  });
  if (!cuerpo.rows.length) {
    cuerpo.innerHTML = '<tr><td colspan="3">Los datos son iguales; solo cambió el número de versión.</td></tr>';
  }
  $('dialogo-conflicto').showModal();
}

$('conflicto-seguir').addEventListener('click', () => {
  versionActual = versionServidor.version;      // al reintentar se guarda sobre la versión nueva, ya vista
  $('dialogo-conflicto').close();
});
$('conflicto-aceptar').addEventListener('click', () => {
  rellenarFormulario(versionServidor);
  $('dialogo-conflicto').close();
  avisar('Se cargó la versión guardada por el otro administrador.', 'exito');
});
$('conflicto-conservar').addEventListener('click', () => {
  $('dialogo-conflicto').close();
  guardar({ ...leerFormulario(), version: versionServidor.version });
});

// ---------- Modo de trabajo (HU-26) ----------

/** Muestra el modo actual del proyecto en la sección "Modo de trabajo". */
function mostrarModo(proyecto) {
  $('modo-actual').textContent = NOMBRES_MODO[proyecto.modo_flujo] || NOMBRES_MODO.scrum;
  $('zona-modo').hidden = false;
}

$('cambiar-modo').addEventListener('click', () => abrirAsistenteModo({
  proyectoId: id,
  alCambiar: async (resultado) => {
    // El cambio aumenta la versión del proyecto: se toma la nueva para que "Guardar" no choque con un conflicto falso.
    // No se rellena el formulario, para no perder lo que la persona esté editando.
    versionActual = resultado.version;
    mostrarModo({ modo_flujo: resultado.modo });
    avisar(`Listo: el proyecto ahora trabaja en ${(NOMBRES_MODO[resultado.modo] || resultado.modo).toLowerCase()}.`, 'exito');
  },
}));

// ---------- Transferir mi rol (Scrum Master o Product Owner) ----------

/**
 * Muestra la sección de transferencia solo a quien tiene rol de Scrum Master o Product Owner en el proyecto,
 * con las personas del equipo que pueden recibirlo.
 */
async function cargarTransferencia() {
  const permisos = await llamar(`/miembros/proyecto/${encodeURIComponent(id)}/mis-permisos`);
  if (!permisos.ok || !['scrum_master', 'product_owner'].includes(permisos.datos.rol)) return;

  const matriz = await llamar(`/miembros/proyecto/${encodeURIComponent(id)}`);
  if (!matriz.ok) return;

  const select = $('transferir-destino');
  select.replaceChildren();
  (matriz.datos.candidatos_transferencia ?? []).forEach((persona) => {
    const opcion = document.createElement('option');
    opcion.value = persona.id;
    opcion.textContent = persona.rol ? `${persona.nombre} (Developer)` : persona.nombre;
    select.appendChild(opcion);
  });
  $('transferir-confirmar').disabled = select.options.length === 0;
  $('zona-transferir').hidden = false;
}

$('transferir-confirmar').addEventListener('click', async () => {
  const destino = $('transferir-destino').value;
  $('error-transferir').hidden = true;
  if (!destino) return;
  if (!window.confirm('¿Transferir tu rol a la persona seleccionada? Dejarás de tener ese rol en este proyecto.')) return;

  $('transferir-confirmar').disabled = true;
  const res = await llamar(`/miembros/proyecto/${encodeURIComponent(id)}/transferir`, {
    metodo: 'POST',
    cuerpo: { destino_usuario_id: Number(destino) },
  });
  if (res.ok) {
    $('zona-transferir').hidden = true;
    avisar('Transferiste tu rol. El proyecto mantiene su Scrum Master o Product Owner.', 'exito');
    return;
  }
  $('error-transferir').textContent = res.datos?.mensaje || 'No se pudo transferir el rol. Inténtalo de nuevo.';
  $('error-transferir').hidden = false;
  $('transferir-confirmar').disabled = false;
});

// ---------- Archivar ----------

$('archivar').addEventListener('click', () => $('dialogo-archivar').showModal());
$('archivar-cancelar').addEventListener('click', () => $('dialogo-archivar').close());

$('archivar-confirmar').addEventListener('click', async () => {
  $('dialogo-archivar').close();
  $('error-archivar').textContent = '';
  try {
    const res = await llamar(`/proyectos/${encodeURIComponent(id)}/archivar`, { metodo: 'POST' });
    if (res.ok) { location.href = '/pages/dashboard.html'; return; }
    $('error-archivar').textContent = res.estado === 409
      ? 'Este proyecto tiene un sprint activo. Ciérralo desde Sprints y vuelve a intentarlo.'
      : 'No se pudo archivar el proyecto. Inténtalo de nuevo.';
  } catch {
    $('error-archivar').textContent = 'Sin conexión. Inténtalo de nuevo al reconectar.';
  }
});

iniciar();
// ---------- HU-64: eliminación definitiva ----------
$('eliminar').addEventListener('click', () => $('dialogo-eliminar').showModal());
$('eliminar-cancelar').addEventListener('click', () => $('dialogo-eliminar').close());
$('eliminar-confirmar').addEventListener('click', async () => {
  const boton = $('eliminar-confirmar');
  boton.disabled = true;
  $('error-eliminar').textContent = '';
  try {
    const res = await llamar(`/proyectos/${encodeURIComponent(id)}`, { metodo: 'DELETE' });
    if (res.ok) { location.href = '/pages/dashboard.html'; return; }
    $('error-eliminar').textContent = res.datos?.mensaje || 'No se pudo eliminar el proyecto.';
  } catch {
    $('error-eliminar').textContent = 'Sin conexión. No se pudo confirmar la eliminación.';
  } finally {
    boton.disabled = false;
  }
});
