// Responsable: Diego - HU-44: logica de la pantalla de capacidad individual (horas por dia y ausencias) (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de capacidad individual:
 *   - Cargar y guardar las horas por día, las notas y las ausencias de la persona (solo la propia).
 *   - Tras guardar, limpiar los campos para poder agregar más datos; lo ya guardado se muestra aparte.
 *   - Validar el formulario antes de enviarlo y mostrar el error junto a cada campo.
 *   - Scrum Master: elegir un sprint y ver la capacidad del equipo en sus fechas (la pantalla las detecta sola).
 *
 * @author Diego Rafael Jimenez Trujano
 * @author Citlaly Morales Viveros
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, iniciales, pluralizar } from '../core/utils.js';
import { cargarPermisos, tienePermiso } from '../core/permisos-ui.js';
import { resolverProyecto } from './ceremonias/proyecto.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const formulario = document.getElementById('form-capacidad');
const campoHoras = document.getElementById('horas');
const campoNotas = document.getElementById('notas');
const horasActuales = document.getElementById('horas-actuales');
const listaAusencias = document.getElementById('lista-ausencias');
const ausenciasGuardadas = document.getElementById('ausencias-guardadas');
const avisoSinAusencias = document.getElementById('ausencias-vacio');
const btnAgregar = document.getElementById('btn-agregar');
const btnGuardar = document.getElementById('btn-guardar');
const estado = document.getElementById('estado');
const selectorSprint = document.getElementById('sprint');
const ayudaSprint = document.getElementById('ayuda-sprint');
const resumen = document.getElementById('resumen');

/**
 * Preguntar al servidor quién es la persona de la sesión.
 * (La sesión viaja en cookies httpOnly: no se lee nada de localStorage.)
 *
 * @returns {Promise<{usuario: {id: number, nombre: string}}|null>} null si no se pudo consultar.
 */
async function cargarContexto() {
  try {
    return await api('/capacidad/yo');
  } catch {
    return null;
  }
}

const contexto = await cargarContexto();
const usuarioId = contexto?.usuario.id ?? null;

// Mostrar quién edita su capacidad
const nombrePersona = contexto?.usuario.nombre ?? '';
document.getElementById('avatar').textContent = iniciales(nombrePersona);
document.getElementById('rol-persona').textContent = nombrePersona;

// Lo ya guardado (horas, ausencias), las filas nuevas en pantalla y los errores de validación por campo
let guardado = { horasPorDia: null, notas: '', ausencias: [] };
let filas = [];
let errores = {};
let contadorFilas = 0;

/**
 * Crear una fila de ausencia con una clave única para identificarla en pantalla.
 *
 * @param {Object} [datos]
 * @returns {{clave: number, tipo: string, fechaInicio: string, fechaFin: string}}
 */
function nuevaFila(datos = {}) {
  contadorFilas += 1;
  return { clave: contadorFilas, tipo: 'ausencia', fechaInicio: '', fechaFin: '', ...datos };
}

/**
 * Mostrar un mensaje de estado bajo el formulario.
 *
 * @param {'exito'|'aviso'|'error'|'info'} tono - Color del mensaje.
 * @param {string} texto - Mensaje a mostrar.
 * @returns {void}
 */
function mostrarEstado(tono, texto) {
  estado.className = `capacidad__estado capacidad__estado--${tono}`;
  estado.textContent = texto;
}

/**
 * Traducir un error de la API en un mensaje para la persona.
 *
 * @param {Error & {estado?: number}} error
 * @returns {string}
 */
function mensajeDeError(error) {
  if (error.estado === 400) return 'Revisa los campos marcados e inténtalo de nuevo.';
  if (error.estado === 401) return 'Tu sesión expiró. Inicia sesión de nuevo.';
  if (error.estado === 403) return 'Solo puedes editar tu propia capacidad.';
  return 'No pudimos completar la acción. Inténtalo de nuevo.';
}

/**
 * Dar formato corto a una fecha "AAAA-MM-DD".
 *
 * @param {string} fecha
 * @returns {string}
 */
const fechaCorta = (fecha) => new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

/* ====================================================================
 * FORMULARIO
 * ==================================================================== */

/**
 * Pintar los errores del campo de horas y de notas, y marcarlos como inválidos.
 *
 * @returns {void}
 */
function pintarErroresSimples() {
  const pares = [['horas', campoHoras, 'error-horas'], ['notas', campoNotas, 'error-notas']];
  for (const [clave, campo, idError] of pares) {
    const mensaje = errores[clave];
    const parrafo = document.getElementById(idError);
    parrafo.hidden = !mensaje;
    parrafo.textContent = mensaje || '';
    campo.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
    if (mensaje) campo.setAttribute('aria-describedby', idError);
    else campo.removeAttribute('aria-describedby');
  }
}

/**
 * Pintar las ausencias ya guardadas (con botón para quitarlas) y las filas nuevas por llenar.
 * Escapar los valores antes de insertarlos como HTML.
 *
 * @returns {void}
 */
function pintarAusencias() {
  avisoSinAusencias.hidden = guardado.ausencias.length > 0 || filas.length > 0;
  ausenciasGuardadas.innerHTML = guardado.ausencias.map((a, i) => `<div class="ausencia" data-guardada="${i}">
      <span>${a.tipo === 'vacaciones' ? 'Vacaciones' : 'Ausencia'}</span>
      <span>${fechaCorta(a.fechaInicio)}</span>
      <span>${fechaCorta(a.fechaFin)}</span>
      <button class="ausencia__quitar" type="button" data-quitar-guardada aria-label="Quitar la ausencia guardada ${i + 1}">×</button>
    </div>`).join('');

  listaAusencias.innerHTML = filas.map((f, i) => {
    const errorInicio = errores[`ausencia-${f.clave}-inicio`];
    const errorFin = errores[`ausencia-${f.clave}-fin`];
    const mensaje = errorInicio || errorFin;
    const n = i + 1;
    return `<div class="ausencia" data-clave="${f.clave}">
      <select class="campo__control ausencia__tipo" data-campo="tipo" aria-label="Tipo de la ausencia nueva ${n}">
        <option value="ausencia"${f.tipo === 'ausencia' ? ' selected' : ''}>Ausencia</option>
        <option value="vacaciones"${f.tipo === 'vacaciones' ? ' selected' : ''}>Vacaciones</option>
      </select>
      <input class="campo__control" type="date" data-campo="fechaInicio" aria-label="Inicio de la ausencia nueva ${n}"
        value="${escaparHtml(f.fechaInicio)}" aria-invalid="${errorInicio ? 'true' : 'false'}" />
      <input class="campo__control" type="date" data-campo="fechaFin" aria-label="Fin de la ausencia nueva ${n}"
        value="${escaparHtml(f.fechaFin)}" aria-invalid="${errorFin ? 'true' : 'false'}" />
      <button class="ausencia__quitar" type="button" data-quitar aria-label="Quitar la ausencia nueva ${n}">×</button>
      ${mensaje ? `<p class="ausencia__error" role="alert">${escaparHtml(mensaje)}</p>` : ''}
    </div>`;
  }).join('');
}

/**
 * Recibir lo guardado en el servidor y dejar el formulario limpio, listo para agregar más datos.
 * Lo que ya está guardado se muestra como referencia, no dentro de los campos.
 *
 * @param {{horasPorDia: (number|null), notas: string, ausencias: Array}} datos
 * @returns {void}
 */
function aplicarDatos(datos) {
  guardado = { horasPorDia: datos.horasPorDia ?? null, notas: datos.notas ?? '', ausencias: datos.ausencias ?? [] };
  campoHoras.value = '';
  campoNotas.value = '';
  campoHoras.placeholder = guardado.horasPorDia === null ? 'Ej. 6' : `Actual: ${guardado.horasPorDia}`;
  campoNotas.placeholder = guardado.notas ? `Actual: ${guardado.notas}` : 'Ej. Disponible para apoyo en QA';
  horasActuales.textContent = guardado.horasPorDia === null
    ? 'Aún no has capturado tus horas por día.'
    : `Guardado: ${guardado.horasPorDia} h por día. Déjalo vacío para conservarlo.`;
  filas = [];
  errores = {};
  pintarErroresSimples();
  pintarAusencias();
}

/**
 * Validar el formulario antes de enviarlo (el servidor repite estas reglas).
 * Las horas solo son obligatorias mientras no haya unas guardadas.
 *
 * @returns {Object} Mapa campo → mensaje; vacío si todo es válido.
 */
function validar() {
  const encontrados = {};
  const vacias = campoHoras.value.trim() === '';
  const horas = vacias ? NaN : Number(campoHoras.value);
  if (vacias && guardado.horasPorDia === null) encontrados.horas = 'Escribe las horas que trabajas por día.';
  else if (!vacias && (!Number.isFinite(horas) || horas < 0 || horas > 24)) encontrados.horas = 'Las horas por día deben estar entre 0 y 24.';

  for (const f of filas) {
    if (!f.fechaInicio) encontrados[`ausencia-${f.clave}-inicio`] = 'Elige una fecha de inicio.';
    if (!f.fechaFin) encontrados[`ausencia-${f.clave}-fin`] = 'Elige una fecha de fin.';
    if (f.fechaInicio && f.fechaFin && f.fechaFin < f.fechaInicio) {
      encontrados[`ausencia-${f.clave}-fin`] = 'La fecha de fin no puede ser anterior a la de inicio.';
    }
  }
  if (campoNotas.value.length > 500) encontrados.notas = 'Las notas admiten hasta 500 caracteres.';
  return encontrados;
}

/**
 * Cargar la capacidad guardada de la persona.
 *
 * @returns {Promise<void>}
 */
async function cargarFormulario() {
  mostrarEstado('info', 'Cargando capacidad…');
  formulario.setAttribute('aria-busy', 'true');
  try {
    aplicarDatos(await api(`/capacidad/usuarios/${usuarioId}`));
    mostrarEstado('info', '');
  } catch (error) {
    mostrarEstado('error', mensajeDeError(error));
  } finally {
    formulario.removeAttribute('aria-busy');
  }
}

/**
 * Enviar la capacidad al servidor, limpiar el formulario y refrescar el resumen del equipo (Scrum Master).
 * Las ausencias que se envían son las ya guardadas más las nuevas: el servidor reemplaza la lista completa.
 *
 * @param {{horasPorDia: string, notas: string, ausencias: Array}} cuerpo
 * @returns {Promise<void>}
 */
async function enviar(cuerpo) {
  btnGuardar.disabled = true;
  mostrarEstado('info', 'Guardando…');
  try {
    const respuesta = await api(`/capacidad/usuarios/${usuarioId}`, { metodo: 'PUT', cuerpo });
    aplicarDatos(respuesta);
    mostrarEstado(respuesta.fusionadas > 0 ? 'aviso' : 'exito', respuesta.mensaje);
    cargarResumen();
  } catch (error) {
    mostrarEstado('error', mensajeDeError(error));
  } finally {
    btnGuardar.disabled = false;
  }
}

// Actualizar la fila al editar sus campos (sin repintar para no perder el foco)
listaAusencias.addEventListener('input', (evento) => {
  const fila = filas.find((f) => f.clave === Number(evento.target.closest('.ausencia')?.dataset.clave));
  const campo = evento.target.dataset.campo;
  if (fila && campo) fila[campo] = evento.target.value;
});

// Quitar una fila nueva (aún sin guardar)
listaAusencias.addEventListener('click', (evento) => {
  if (!evento.target.matches('[data-quitar]')) return;
  const clave = Number(evento.target.closest('.ausencia').dataset.clave);
  filas = filas.filter((f) => f.clave !== clave);
  pintarAusencias();
});

// Quitar una ausencia ya guardada: se guarda de inmediato sin tocar lo que haya en los campos
ausenciasGuardadas.addEventListener('click', (evento) => {
  if (!evento.target.matches('[data-quitar-guardada]')) return;
  const indice = Number(evento.target.closest('.ausencia').dataset.guardada);
  enviar({ horasPorDia: '', notas: '', ausencias: guardado.ausencias.filter((_, i) => i !== indice) });
});

// Agregar una fila vacía y enviar el foco a su primera fecha
btnAgregar.addEventListener('click', () => {
  filas.push(nuevaFila());
  pintarAusencias();
  listaAusencias.querySelector('.ausencia:last-child [data-campo="fechaInicio"]').focus();
});

// Guardar: validar, enviar, limpiar los campos y recalcular el resumen del equipo
formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  errores = validar();
  pintarErroresSimples();
  pintarAusencias();
  if (Object.keys(errores).length) {
    mostrarEstado('error', 'Corrige los campos marcados para guardar.');
    formulario.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  if (campoHoras.value.trim() === '' && campoNotas.value.trim() === '' && filas.length === 0) {
    mostrarEstado('aviso', 'No hay nada nuevo que guardar.');
    return;
  }

  await enviar({
    horasPorDia: campoHoras.value,
    notas: campoNotas.value,
    ausencias: [...guardado.ausencias, ...filas].map(({ tipo, fechaInicio, fechaFin }) => ({ tipo, fechaInicio, fechaFin })),
  });
});

/* ====================================================================
 * RESUMEN DEL EQUIPO (solo Scrum Master)
 * ==================================================================== */

// Cancelar la consulta anterior si se pide otra antes de que termine
let consultaResumen = null;

/**
 * Dar formato a un número de horas con hasta 2 decimales.
 *
 * @param {number} n
 * @returns {string}
 */
const formatoHoras = (n) => n.toLocaleString('es', { maximumFractionDigits: 2 });

/**
 * Mostrar esqueletos mientras se calcula la capacidad.
 *
 * @returns {void}
 */
function pintarCargaResumen() {
  resumen.className = 'resumen--cargando';
  resumen.setAttribute('aria-busy', 'true');
  resumen.innerHTML = '<span class="esqueleto esqueleto--valor"></span><span class="esqueleto esqueleto--linea"></span><span class="esqueleto esqueleto--linea"></span>';
}

/**
 * Mostrar un mensaje del resumen, con un botón para reintentar si se indica.
 *
 * @param {string} texto - Mensaje a mostrar.
 * @param {boolean} [reintentar=true]
 * @returns {void}
 */
function pintarErrorResumen(texto, reintentar = true) {
  resumen.className = '';
  resumen.removeAttribute('aria-busy');
  resumen.innerHTML = `<div class="resumen__error" role="alert">
    <span>${escaparHtml(texto)}</span>
    ${reintentar ? '<button class="boton boton--secundario boton--pequeno" type="button" data-reintentar>Reintentar</button>' : ''}
  </div>`;
}

/**
 * Pintar el total del equipo, la advertencia de 0 horas y el detalle por integrante.
 *
 * @param {{miembros: Array, totalHoras: number, sinCapacidad: boolean}} datos
 * @returns {void}
 */
function pintarResumen(datos) {
  resumen.className = '';
  resumen.removeAttribute('aria-busy');
  const maximo = Math.max(...datos.miembros.map((m) => m.horas), 1);

  const alerta = datos.sinCapacidad
    ? '<p class="resumen__alerta" role="alert">La capacidad del equipo en este sprint es de 0 horas. Revisa las horas por día y las ausencias.</p>'
    : '';

  const miembros = datos.miembros.map((m) => {
    const detalle = !m.configurado
      ? 'Aún no captura sus horas por día'
      : `${m.diasHabiles} ${pluralizar(m.diasHabiles, 'día hábil', 'días hábiles')}`
      + (m.diasAusente ? ` · ${m.diasAusente} ${pluralizar(m.diasAusente, 'día de ausencia', 'días de ausencia')}` : '');
    const marca = m.configurado ? '' : ' <span class="insignia insignia--advertencia">Sin configurar</span>';
    return `<li class="resumen__miembro">
      <div class="resumen__miembro-fila">
        <span class="resumen__miembro-nombre">${escaparHtml(m.nombre)}${marca}</span>
        <span class="resumen__miembro-horas">${formatoHoras(m.horas)} h</span>
      </div>
      <div class="resumen__miembro-barra" aria-hidden="true"><div class="resumen__miembro-relleno" style="width:${(m.horas / maximo) * 100}%"></div></div>
      <span class="resumen__miembro-detalle">${detalle}</span>
    </li>`;
  }).join('');

  resumen.innerHTML = `<div class="resumen__total">
      <span class="resumen__valor">${formatoHoras(datos.totalHoras)}</span><span class="resumen__unidad">h</span>
    </div>
    ${alerta}
    <ul class="resumen__lista">${miembros}</ul>`;
}

/**
 * Llenar el selector con los sprints del proyecto y mostrar las fechas del elegido.
 *
 * @param {{sprints: Array, sprint: (Object|null)}} datos
 * @returns {void}
 */
function pintarSelectorSprint({ sprints, sprint }) {
  const etiquetaEstado = { activo: 'activo', planificado: 'planificado', cerrado: 'cerrado' };
  selectorSprint.innerHTML = sprints.length
    ? sprints.map((s) => `<option value="${s.id}"${s.id === sprint?.id ? ' selected' : ''}>${escaparHtml(s.nombre)} · ${etiquetaEstado[s.estado] ?? s.estado}</option>`).join('')
    : '<option value="">Sin sprints</option>';
  selectorSprint.disabled = !sprints.length;
  ayudaSprint.textContent = sprint
    ? `Horas disponibles del equipo del ${fechaCorta(sprint.fechaInicio)} al ${fechaCorta(sprint.fechaFin)} (lunes a viernes).`
    : 'Horas disponibles del equipo durante el sprint elegido (lunes a viernes).';
}

/**
 * Consultar y pintar la capacidad del equipo del sprint elegido. Sin sprint elegido el servidor propone
 * el activo; las fechas siempre salen del sprint. Solo se llama si la persona es Scrum Master.
 *
 * @returns {Promise<void>}
 */
async function cargarResumen() {
  if (!proyectoId || !tienePermiso('capacidad.equipo.ver')) return;

  consultaResumen?.abort();
  consultaResumen = new AbortController();
  pintarCargaResumen();
  try {
    const consulta = selectorSprint.value ? `?sprint=${encodeURIComponent(selectorSprint.value)}` : '';
    const datos = await api(`/capacidad/proyecto/${proyectoId}/equipo${consulta}`, { signal: consultaResumen.signal });
    pintarSelectorSprint(datos);
    if (datos.capacidad) pintarResumen(datos.capacidad);
    else pintarErrorResumen('Este proyecto todavía no tiene sprints. Crea uno desde Sprints para ver su capacidad.', false);
  } catch (error) {
    if (error.name === 'AbortError') return;
    pintarErrorResumen('No pudimos calcular la capacidad del equipo.');
  }
}

selectorSprint.addEventListener('change', cargarResumen);
resumen.addEventListener('click', (evento) => {
  if (evento.target.matches('[data-reintentar]')) cargarResumen();
});

/* ====================================================================
 * INICIO
 * ==================================================================== */

let proyectoId = null;

if (!usuarioId) {
  mostrarEstado('error', 'No pudimos identificar tu sesión. Inicia sesión de nuevo.');
  btnGuardar.disabled = true;
} else {
  cargarFormulario();
}

try {
  proyectoId = (await resolverProyecto()).id;
} catch { /* sin proyecto no hay resumen del equipo; el formulario individual sigue funcionando */ }

if (proyectoId) {
  // Los permisos del proyecto deciden si aparece el resumen del equipo (solo Scrum Master)
  await cargarPermisos(proyectoId).catch(() => { /* sin permisos conocidos, el resumen queda oculto */ });
  cargarResumen();
}
