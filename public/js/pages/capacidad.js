// Responsable: Diego - HU-44: logica de la pantalla de capacidad individual (horas por dia y ausencias) (llama a la API y escucha sockets)
/**
 * Pintar la pantalla de capacidad individual:
 *   - Cargar y guardar las horas por día, las notas y las ausencias de la persona.
 *   - Validar el formulario antes de enviarlo y mostrar el error junto a cada campo.
 *   - Recalcular y mostrar la capacidad del equipo cada vez que se guarda.
 */
import { api } from '/js/core/api.js';
import { montarBarraSuperior } from '/js/core/layout.js';
import { escaparHtml, iniciales, pluralizar } from '/js/core/utils.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const formulario = document.getElementById('form-capacidad');
const campoHoras = document.getElementById('horas');
const campoNotas = document.getElementById('notas');
const listaAusencias = document.getElementById('lista-ausencias');
const avisoSinAusencias = document.getElementById('ausencias-vacio');
const btnAgregar = document.getElementById('btn-agregar');
const btnGuardar = document.getElementById('btn-guardar');
const estado = document.getElementById('estado');
const campoDesde = document.getElementById('desde');
const campoHasta = document.getElementById('hasta');
const resumen = document.getElementById('resumen');

/**
 * Leer el usuario guardado en localStorage (clave "usuario", en JSON).
 * Devolver un usuario genérico si no existe o si el JSON es inválido.
 *
 * @returns {{id: (number|null), nombre: string, rol: string}}
 */
function leerUsuarioLocal() {
  try {
    const guardado = JSON.parse(localStorage.getItem('usuario'));
    if (guardado && guardado.nombre) return { id: guardado.id ?? null, nombre: guardado.nombre, rol: guardado.rol || '' };
  } catch { /* Ignorar JSON inválido y usar el valor por defecto */ }
  return { id: null, nombre: 'Usuario', rol: '' };
}

// Resolver la persona y el equipo: ?usuario=ID y ?equipo=ID, o lo guardado en la sesión
const params = new URLSearchParams(location.search);
const usuarioLocal = leerUsuarioLocal();
const usuarioId = Number(params.get('usuario') || usuarioLocal.id || 1);
const equipoId = Number(params.get('equipo') || localStorage.getItem('equipoActivo') || 1);

// Mostrar quién edita su capacidad
document.getElementById('avatar').textContent = iniciales(usuarioLocal.nombre);
document.getElementById('rol-persona').textContent = usuarioLocal.rol || usuarioLocal.nombre;

// Guardar las filas de ausencias en pantalla y los errores de validación por campo
let filas = [];
let errores = {};
let contadorFilas = 0;

/**
 * Convertir una fecha local en texto "AAAA-MM-DD".
 *
 * @param {Date} fecha
 * @returns {string}
 */
function aTexto(fecha) {
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

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
 * Pintar la lista de ausencias a partir de "filas".
 * Escapar los valores antes de insertarlos como HTML.
 *
 * @returns {void}
 */
function pintarAusencias() {
  avisoSinAusencias.hidden = filas.length > 0;
  listaAusencias.innerHTML = filas.map((f, i) => {
    const errorInicio = errores[`ausencia-${f.clave}-inicio`];
    const errorFin = errores[`ausencia-${f.clave}-fin`];
    const mensaje = errorInicio || errorFin;
    const n = i + 1;
    return `<div class="ausencia" data-clave="${f.clave}">
      <select class="campo__control ausencia__tipo" data-campo="tipo" aria-label="Tipo de la ausencia ${n}">
        <option value="ausencia"${f.tipo === 'ausencia' ? ' selected' : ''}>Ausencia</option>
        <option value="vacaciones"${f.tipo === 'vacaciones' ? ' selected' : ''}>Vacaciones</option>
      </select>
      <input class="campo__control" type="date" data-campo="fechaInicio" aria-label="Inicio de la ausencia ${n}"
        value="${escaparHtml(f.fechaInicio)}" aria-invalid="${errorInicio ? 'true' : 'false'}" />
      <input class="campo__control" type="date" data-campo="fechaFin" aria-label="Fin de la ausencia ${n}"
        value="${escaparHtml(f.fechaFin)}" aria-invalid="${errorFin ? 'true' : 'false'}" />
      <button class="ausencia__quitar" type="button" data-quitar aria-label="Quitar la ausencia ${n}">×</button>
      ${mensaje ? `<p class="ausencia__error" role="alert">${escaparHtml(mensaje)}</p>` : ''}
    </div>`;
  }).join('');
}

/**
 * Copiar los datos recibidos del servidor al formulario.
 *
 * @param {{horasPorDia: (number|null), notas: string, ausencias: Array}} datos
 * @returns {void}
 */
function aplicarDatos(datos) {
  campoHoras.value = datos.horasPorDia ?? '';
  campoNotas.value = datos.notas ?? '';
  filas = (datos.ausencias ?? []).map((a) => nuevaFila(a));
  errores = {};
  pintarErroresSimples();
  pintarAusencias();
}

/**
 * Validar el formulario antes de enviarlo (el servidor repite estas reglas).
 *
 * @returns {Object} Mapa campo → mensaje; vacío si todo es válido.
 */
function validar() {
  const encontrados = {};
  const horas = campoHoras.value.trim() === '' ? NaN : Number(campoHoras.value);
  if (!Number.isFinite(horas)) encontrados.horas = 'Escribe las horas que trabajas por día.';
  else if (horas < 0 || horas > 24) encontrados.horas = 'Las horas por día deben estar entre 0 y 24.';

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
 * Cargar la capacidad guardada de la persona y llenar el formulario.
 *
 * @returns {Promise<void>}
 */
async function cargarFormulario() {
  mostrarEstado('info', 'Cargando capacidad…');
  formulario.setAttribute('aria-busy', 'true');
  try {
    aplicarDatos(await api(`/usuarios/${usuarioId}/capacidad`));
    mostrarEstado('info', '');
  } catch (error) {
    mostrarEstado('error', mensajeDeError(error));
  } finally {
    formulario.removeAttribute('aria-busy');
  }
}

// Actualizar la fila al editar sus campos (sin repintar para no perder el foco)
listaAusencias.addEventListener('input', (evento) => {
  const fila = filas.find((f) => f.clave === Number(evento.target.closest('.ausencia')?.dataset.clave));
  const campo = evento.target.dataset.campo;
  if (fila && campo) fila[campo] = evento.target.value;
});

// Quitar una fila
listaAusencias.addEventListener('click', (evento) => {
  if (!evento.target.matches('[data-quitar]')) return;
  const clave = Number(evento.target.closest('.ausencia').dataset.clave);
  filas = filas.filter((f) => f.clave !== clave);
  pintarAusencias();
});

// Agregar una fila vacía y enviar el foco a su primera fecha
btnAgregar.addEventListener('click', () => {
  filas.push(nuevaFila());
  pintarAusencias();
  listaAusencias.querySelector('.ausencia:last-child [data-campo="fechaInicio"]').focus();
});

// Guardar: validar, enviar y recalcular el resumen del equipo
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

  btnGuardar.disabled = true;
  mostrarEstado('info', 'Guardando…');
  try {
    const guardado = await api(`/usuarios/${usuarioId}/capacidad`, {
      metodo: 'PUT',
      cuerpo: {
        horasPorDia: Number(campoHoras.value),
        notas: campoNotas.value,
        ausencias: filas.map(({ tipo, fechaInicio, fechaFin }) => ({ tipo, fechaInicio, fechaFin })),
      },
    });
    aplicarDatos(guardado);
    mostrarEstado(guardado.fusionadas > 0 ? 'aviso' : 'exito', guardado.mensaje);
    cargarResumen();
  } catch (error) {
    mostrarEstado('error', mensajeDeError(error));
  } finally {
    btnGuardar.disabled = false;
  }
});

/* ====================================================================
 * RESUMEN DEL EQUIPO
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
 * Mostrar un error del resumen con un botón para reintentar.
 *
 * @param {string} texto - Mensaje a mostrar.
 * @returns {void}
 */
function pintarErrorResumen(texto) {
  resumen.className = '';
  resumen.removeAttribute('aria-busy');
  resumen.innerHTML = `<div class="resumen__error" role="alert">
    <span>${escaparHtml(texto)}</span>
    <button class="boton boton--secundario boton--pequeno" type="button" data-reintentar>Reintentar</button>
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
    ? '<p class="resumen__alerta" role="alert">La capacidad del equipo en este rango es de 0 horas. Revisa las horas por día y las ausencias.</p>'
    : '';

  const miembros = datos.miembros.map((m) => {
    const detalle = !m.configurado
      ? 'Aún no captura sus horas por día'
      : `${m.diasHabiles} ${pluralizar(m.diasHabiles, 'día hábil', 'días hábiles')}`
        + (m.diasAusente ? ` · ${m.diasAusente} ${pluralizar(m.diasAusente, 'día de ausencia', 'días de ausencia')}` : '');
    const marca = m.configurado ? '' : ' <span class="insignia insignia--advertencia">Sin configurar</span>';
    return `<li class="miembro">
      <div class="miembro__fila">
        <span class="miembro__nombre">${escaparHtml(m.nombre)}${marca}</span>
        <span class="miembro__horas">${formatoHoras(m.horas)} h</span>
      </div>
      <div class="miembro__barra" aria-hidden="true"><div class="miembro__relleno" style="width:${(m.horas / maximo) * 100}%"></div></div>
      <span class="miembro__detalle">${detalle}</span>
    </li>`;
  }).join('');

  resumen.innerHTML = `<div class="resumen__total">
      <span class="resumen__valor">${formatoHoras(datos.totalHoras)}</span><span class="resumen__unidad">h</span>
    </div>
    ${alerta}
    <ul class="resumen__lista">${miembros}</ul>`;
}

/**
 * Consultar y pintar la capacidad del equipo para el rango de fechas elegido.
 * Mostrar un mensaje si el rango está vacío o invertido.
 *
 * @returns {Promise<void>}
 */
async function cargarResumen() {
  if (!campoDesde.value || !campoHasta.value || campoHasta.value < campoDesde.value) {
    pintarErrorResumen('Elige un rango válido: la fecha final no puede ser anterior a la inicial.');
    resumen.querySelector('[data-reintentar]').remove();
    return;
  }

  consultaResumen?.abort();
  consultaResumen = new AbortController();
  pintarCargaResumen();
  try {
    const datos = await api(
      `/equipos/${equipoId}/capacidad?inicio=${campoDesde.value}&fin=${campoHasta.value}`,
      { signal: consultaResumen.signal },
    );
    pintarResumen(datos);
  } catch (error) {
    if (error.name === 'AbortError') return;
    pintarErrorResumen('No pudimos calcular la capacidad del equipo.');
  }
}

campoDesde.addEventListener('change', cargarResumen);
campoHasta.addEventListener('change', cargarResumen);
resumen.addEventListener('click', (evento) => {
  if (evento.target.matches('[data-reintentar]')) cargarResumen();
});

/* ====================================================================
 * INICIO
 * ==================================================================== */

// Proponer el rango de las próximas dos semanas
const hoy = new Date();
const dentroDeDosSemanas = new Date(hoy);
dentroDeDosSemanas.setDate(hoy.getDate() + 13);
campoDesde.value = aTexto(hoy);
campoHasta.value = aTexto(dentroDeDosSemanas);

cargarFormulario();
cargarResumen();
