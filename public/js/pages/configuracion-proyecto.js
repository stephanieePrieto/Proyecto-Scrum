// Responsable: Jetz - HU-01: logica de la pantalla de editar, archivar y Definition of Done del proyecto (llama a la API y escucha sockets)

/**
 * HU-01 · Crear/editar proyecto, Definition of Done y archivado.
 *  - /configuracion-proyecto.html          -> crear
 *  - /configuracion-proyecto.html?id=7     -> editar el proyecto 7
 *
 * NOTA: api.js (BASE) descarta el cuerpo de las respuestas con error, y aquí se necesita para
 * mostrar los errores por campo y las diferencias de versión. Por eso esta página usa su propia
 * función "llamar". Propuesta para el equipo: que api.js guarde el cuerpo en error.cuerpo.
 */
import { montarBarraSuperior } from '../core/layout.js';
import { obtenerTokenCsrf } from '../core/seguridad.js';

const $ = (id) => document.getElementById(id);
const CAMPOS = ['nombre', 'vision', 'fecha_inicio', 'fecha_fin', 'definition_of_done'];
const ETIQUETAS = {
  nombre: 'Nombre', vision: 'Visión', fecha_inicio: 'Fecha de inicio',
  fecha_fin: 'Fecha de fin', definition_of_done: 'Definition of Done',
};

const id = new URLSearchParams(location.search).get('id');
const editando = Boolean(id);
let versionActual = null;
let guardando = false;

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
  document.querySelectorAll('.proy-error').forEach((p) => { p.textContent = ''; });
  CAMPOS.concat('equipo_id').forEach((c) => $(c)?.removeAttribute('aria-invalid'));
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
  if (!editando) datos.equipo_id = $('equipo_id').value;
  else datos.version = versionActual;
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
  if (!editando) $('definition_of_done').value = datos.dod_base;
}

async function cargarProyecto() {
  const { ok, estado, datos } = await llamar(`/proyectos/${encodeURIComponent(id)}`);
  if (!ok) {
    avisar(estado === 404 ? 'No encontramos este proyecto.' : 'No se pudo cargar el proyecto. Recarga la página.', 'error');
    return null;
  }
  if (!datos.puede_gestionar) {
    avisar('Solo un administrador puede crear o editar proyectos.', 'error');
    return null;
  }
  const p = datos.proyecto;
  rellenarFormulario(p);
  const select = $('equipo_id');
  select.innerHTML = '<option></option>';
  select.options[0].textContent = p.equipo_nombre;   // el equipo no se cambia al editar
  select.disabled = true;
  return p;
}

async function iniciar() {
  montarBarraSuperior();

  try {
    if (editando) {
      $('titulo').textContent = 'Editar proyecto';
      const proyecto = await cargarProyecto();
      if (!proyecto) return;
      if (proyecto.archivado) {
        avisar('Este proyecto está archivado y no se puede editar.', 'error');
        return;
      }
      $('zona-archivar').hidden = false;
    } else {
      await cargarEquipos();
    }
    $('formulario').hidden = false;
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

$('formulario').addEventListener('submit', (evento) => {
  evento.preventDefault();
  guardar(leerFormulario());
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