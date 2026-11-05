// Responsable: Alfonso - HU-27: logica de la pantalla de registro de horas reales (llama a la API y escucha sockets)
/**
 * @file mis-horas.js
 * @description Hoja semanal "Mis horas" (HU-27): tareas × días con horas reales, totales y meta semanal,
 *              registro manual (crear, editar, eliminar) y temporizador por tarea.
 *              El servidor valida todo; aquí solo se evita viajar con datos obviamente inválidos.
 *              Al volver a la pestaña se recarga la semana por si otra pestaña cambió las horas.
 *
 * @author Alfonso Mendoza Vasquez
 * @author Citlaly Morales Viveros
 */

import { montarBarraSuperior } from '../core/layout.js';
import { api } from '../core/api.js';
import { cargarPermisos } from '../core/permisos-ui.js';
import { inicializarTemporizador } from '../componentes/temporizador.js';
import { crear, mensajeDeError, formatearHoras, validarRegistro } from '../componentes/horas-comun.js';

const RUTA_HORAS = '/horas';
const DURACION_AVISO_MS = 5000;
const ESPERA_CONFIRMAR_MS = 3000;

const $ = (id) => document.getElementById(id);

const formatoDia = new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: 'UTC' });
const formatoCorto = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const formatoLargo = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Datos de la semana mostrada (respuesta de GET /api/horas/semana). */
let datos = null;
/** Registro que se está editando en el diálogo (`null` = registro nuevo). */
let editando = null;
/** Se incrementa en cada carga para descartar respuestas viejas si se navega rápido. */
let turno = 0;
let temporizadorAviso = null;

/* ======================================================================
 * Utilidades de fecha
 * ====================================================================== */

/**
 * Suma días a una fecha "AAAA-MM-DD".
 * @param {string} fecha Fecha base.
 * @param {number} dias Días a sumar.
 * @returns {string} Nueva fecha.
 */
function desplazar(fecha, dias) {
  const resultado = new Date(`${fecha}T00:00:00Z`);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

/** @param {string} fecha "AAAA-MM-DD". @returns {Date} Fecha en UTC (solo para dar formato). */
const aFecha = (fecha) => new Date(`${fecha}T00:00:00Z`);

/* ======================================================================
 * Avisos
 * ====================================================================== */

/**
 * Muestra un aviso arriba de la hoja.
 * @param {string} texto Mensaje.
 * @param {'exito'|'error'} [tipo='exito'] Tono del aviso.
 * @param {function(): void} [reintentar] Si se indica, agrega el botón "Reintentar" y el aviso no se oculta solo.
 */
function mostrarAviso(texto, tipo = 'exito', reintentar = null) {
  const aviso = $('mh-aviso');
  clearTimeout(temporizadorAviso);
  aviso.className = `mh-aviso mh-aviso--${tipo}`;
  aviso.replaceChildren(crear('span', { texto }));
  if (reintentar) {
    aviso.append(crear('button', {
      clase: 'boton boton--secundario boton--pequeno',
      texto: 'Reintentar',
      atributos: { type: 'button' },
      eventos: { click: reintentar },
    }));
  } else {
    temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, DURACION_AVISO_MS);
  }
  aviso.hidden = false;
}

/* ======================================================================
 * Carga y dibujo de la hoja
 * ====================================================================== */

/**
 * Pide la semana al servidor y la dibuja.
 * @param {string|null} inicio Cualquier día de la semana deseada; `null` = semana actual.
 * @returns {Promise<void>}
 * @throws {Error} Si la petición falla.
 */
async function cargar(inicio) {
  const actual = ++turno;
  const ruta = inicio ? `${RUTA_HORAS}/semana?inicio=${encodeURIComponent(inicio)}` : `${RUTA_HORAS}/semana`;
  const respuesta = await api(ruta);
  if (actual !== turno) return;
  datos = respuesta.datos;
  dibujar();
}

/**
 * Carga la semana y, si falla, muestra el error con "Reintentar".
 * @param {string|null} inicio Día de la semana a cargar.
 * @returns {Promise<void>}
 */
async function cargarConAviso(inicio) {
  try {
    await cargar(inicio);
  } catch (error) {
    $('mh-cargando').hidden = true;
    mostrarAviso(mensajeDeError(error, 'No se pudieron cargar tus horas.'), 'error', () => cargarConAviso(inicio));
  }
}

/**
 * Construye una celda de día: botón si se puede registrar, texto si es solo lectura o futuro.
 * @param {Object} tarea Fila de la tarea.
 * @param {string} dia Día de la celda.
 * @param {number} horas Horas registradas ese día.
 * @returns {HTMLTableCellElement}
 */
function crearCelda(tarea, dia, horas) {
  const puedeRegistrar = tarea.editable && dia <= datos.semana.hoy;
  const nombre = formatoLargo.format(aFecha(dia));
  const contenido = crear('button', {
    clase: `mh-celda${horas ? ' mh-celda--con-horas' : ''}`,
    texto: formatearHoras(horas),
    atributos: {
      type: 'button',
      disabled: !puedeRegistrar,
      'aria-label': puedeRegistrar
        ? `${horas ? `${formatearHoras(horas)} horas. ` : ''}Registrar horas de ${tarea.titulo}, ${nombre}`
        : `${formatearHoras(horas)} horas de ${tarea.titulo}, ${nombre}`,
    },
    eventos: { click: () => abrirDialogo({ tareaId: tarea.id, fecha: dia }) },
  });
  return crear('td', {}, [contenido]);
}

/**
 * Construye la fila de una tarea.
 * @param {Object} tarea Tarea con sus horas por día.
 * @param {Object|null} medicion Temporizador activo (para deshabilitar y marcar botones).
 * @returns {HTMLTableRowElement}
 */
function crearFila(tarea, medicion) {
  const meta = [tarea.historia, tarea.proyecto].filter(Boolean).join(' · ');
  const celdaTarea = crear('th', { clase: 'mh-col-tarea', atributos: { scope: 'row' } }, [
    crear('span', { clase: 'mh-tarea__titulo', texto: tarea.titulo }),
    crear('span', { clase: 'mh-tarea__meta', texto: meta }),
    ...(tarea.sprintCerrado ? [crear('span', { clase: 'insignia insignia--neutro', texto: 'Sprint cerrado · solo lectura' })] : []),
  ]);

  const real = formatearHoras(tarea.horasRealesTotal);
  const estimado = formatearHoras(tarea.horasEstimadas);
  const comparacion = crear('td', {
    clase: 'mh-comparacion',
    texto: `${real} / ${estimado} h`,
    atributos: { title: 'Horas reales de todo el equipo / horas estimadas de la tarea' },
  });

  let accion;
  if (medicion?.tareaId === tarea.id) {
    accion = crear('span', { clase: 'mh-midiendo', texto: '● Midiendo' });
  } else {
    accion = crear('button', {
      clase: 'boton boton--secundario boton--pequeno',
      texto: '▶ Iniciar',
      atributos: {
        type: 'button',
        disabled: !tarea.editable || Boolean(medicion),
        title: medicion ? 'Ya tienes un temporizador activo' : undefined,
        'aria-label': `Iniciar temporizador en ${tarea.titulo}`,
      },
      eventos: { click: () => iniciarTemporizador(tarea.id) },
    });
  }

  return crear('tr', {}, [
    celdaTarea,
    ...datos.semana.dias.map((dia, i) => crearCelda(tarea, dia, tarea.dias[i])),
    comparacion,
    crear('td', {}, [accion]),
  ]);
}

/** Dibuja encabezado, resumen y tabla con los datos cargados. */
function dibujar() {
  if (!datos) return;
  const { semana, tareas, totalesDia, totalSemana, metaSemanal } = datos;
  const medicion = temporizador?.obtenerActual() ?? null;

  $('mh-cargando').hidden = true;
  $('mh-semana').textContent = `${formatoCorto.format(aFecha(semana.inicio))} – ${formatoCorto.format(aFecha(semana.fin))} ${semana.fin.slice(0, 4)}`;

  $('mh-total').textContent = `${formatearHoras(totalSemana) === '—' ? '0' : formatearHoras(totalSemana)} h`;
  $('mh-meta').textContent = `/ ${formatearHoras(metaSemanal)} h`;
  const porcentaje = metaSemanal > 0 ? Math.min(100, Math.round((totalSemana / metaSemanal) * 100)) : 0;
  $('mh-barra').style.width = `${porcentaje}%`;
  $('mh-barra').classList.toggle('mh-barra__relleno--completa', porcentaje >= 100);
  $('mh-barra').parentElement.setAttribute('aria-valuenow', String(porcentaje));

  $('mh-vacio').hidden = tareas.length > 0;
  $('mh-tabla-envoltura').hidden = tareas.length === 0;
  if (tareas.length === 0) return;

  const encabezadosDias = semana.dias.map((dia) => crear('th', { atributos: { scope: 'col' } }, [
    crear('span', { clase: `mh-dia${dia === semana.hoy ? ' mh-dia--hoy' : ''}`, atributos: { 'aria-label': formatoLargo.format(aFecha(dia)) } }, [
      crear('span', { texto: formatoDia.format(aFecha(dia)).replace('.', '') }),
      crear('span', { clase: 'mh-dia__numero', texto: String(Number(dia.slice(8))) }),
    ]),
  ]));
  $('mh-tabla').tHead.replaceChildren(crear('tr', {}, [
    crear('th', { clase: 'mh-col-tarea', texto: 'Tarea', atributos: { scope: 'col' } }),
    ...encabezadosDias,
    crear('th', { texto: 'Real / estimado', atributos: { scope: 'col' } }),
    crear('th', { atributos: { scope: 'col' } }, [crear('span', { clase: 'mh-solo-lectores', texto: 'Temporizador' })]),
  ]));
  $('mh-tabla').tBodies[0].replaceChildren(...tareas.map((tarea) => crearFila(tarea, medicion)));
  $('mh-tabla').tFoot.replaceChildren(crear('tr', {}, [
    crear('td', { texto: 'Total del día' }),
    ...totalesDia.map((horas) => crear('td', { texto: formatearHoras(horas) })),
    crear('td', { texto: formatearHoras(totalSemana) }),
    crear('td'),
  ]));
}

/* ======================================================================
 * Temporizador
 * ====================================================================== */

/**
 * Inicia el temporizador en una tarea; si el servidor lo rechaza, muestra el motivo.
 * @param {number} tareaId Tarea a medir.
 * @returns {Promise<void>}
 */
async function iniciarTemporizador(tareaId) {
  try {
    await temporizador.iniciar(tareaId);
  } catch (error) {
    mostrarAviso(mensajeDeError(error, 'No se pudo iniciar el temporizador.'), 'error');
  }
}

/**
 * Reacciona a los cambios del temporizador: repinta los botones y recarga la hoja al registrar tiempo.
 * @param {{tipo:string}} evento Qué ocurrió.
 */
function alCambiarTemporizador({ tipo }) {
  dibujar();
  if (tipo === 'registrado') {
    mostrarAviso('Tiempo registrado en tu hoja de horas.');
    cargarConAviso(datos?.semana.inicio ?? null);
  }
}

const temporizador = inicializarTemporizador({ alCambiar: alCambiarTemporizador });

/* ======================================================================
 * Diálogo: registrar, editar y eliminar horas
 * ====================================================================== */

/**
 * Muestra un error dentro del diálogo.
 * @param {string} texto Mensaje (vacío para ocultar).
 */
function errorDialogo(texto) {
  $('mh-error').textContent = texto;
  $('mh-error').hidden = !texto;
}

/** @returns {Object|undefined} Tarea elegida en el diálogo. */
const tareaElegida = () => datos.tareas.find((t) => t.id === Number($('mh-tarea').value));

/** Deja el formulario en modo "registro nuevo". */
function salirDeEdicion() {
  editando = null;
  $('mh-tarea').disabled = false;
  $('mh-horas').value = '';
  $('mh-nota').value = '';
  $('mh-dialogo-titulo').textContent = 'Registrar horas';
  $('mh-guardar').textContent = 'Registrar';
  $('mh-cancelar-edicion').hidden = true;
}

/**
 * Pasa el formulario a modo edición con los datos de un registro.
 * @param {{id:number, horas:number, nota:string|null}} registro Registro a editar.
 */
function entrarEnEdicion(registro) {
  editando = registro.id;
  $('mh-tarea').disabled = true;
  $('mh-horas').value = registro.horas;
  $('mh-nota').value = registro.nota ?? '';
  $('mh-dialogo-titulo').textContent = 'Editar registro';
  $('mh-guardar').textContent = 'Guardar cambios';
  $('mh-cancelar-edicion').hidden = false;
  errorDialogo('');
  $('mh-horas').focus();
}

/**
 * Elimina un registro; pide una segunda pulsación para confirmar.
 * @param {{id:number}} registro Registro a eliminar.
 * @param {HTMLButtonElement} boton Botón pulsado.
 */
async function eliminarRegistro(registro, boton) {
  if (!boton.dataset.confirmar) {
    boton.dataset.confirmar = '1';
    boton.textContent = '¿Seguro?';
    setTimeout(() => { delete boton.dataset.confirmar; boton.textContent = 'Eliminar'; }, ESPERA_CONFIRMAR_MS);
    return;
  }
  boton.disabled = true;
  errorDialogo('');
  try {
    await api(`${RUTA_HORAS}/${registro.id}`, { metodo: 'DELETE' });
    if (editando === registro.id) salirDeEdicion();
    await cargar(datos.semana.inicio);
    dibujarRegistros();
    mostrarAviso('Registro eliminado.');
  } catch (error) {
    boton.disabled = false;
    errorDialogo(mensajeDeError(error, 'No se pudo eliminar el registro.'));
  }
}

/** Lista los registros ya hechos en la tarea y el día elegidos, con "Editar" y "Eliminar". */
function dibujarRegistros() {
  const lista = $('mh-registros');
  const registros = tareaElegida()?.registros.filter((r) => r.fecha === $('mh-fecha').value) ?? [];
  lista.hidden = registros.length === 0;
  lista.replaceChildren(...registros.map((registro) => {
    const botonEliminar = crear('button', {
      clase: 'boton boton--secundario boton--pequeno',
      texto: 'Eliminar',
      atributos: { type: 'button' },
    });
    botonEliminar.addEventListener('click', () => eliminarRegistro(registro, botonEliminar));
    return crear('li', {}, [
      crear('span', { clase: 'mh-registros__texto' }, [
        `${formatearHoras(registro.horas)} h`,
        ...(registro.nota ? [crear('span', { clase: 'mh-registros__nota', texto: registro.nota })] : []),
      ]),
      crear('span', { clase: 'mh-registros__acciones' }, [
        crear('button', {
          clase: 'boton boton--secundario boton--pequeno',
          texto: 'Editar',
          atributos: { type: 'button' },
          eventos: { click: () => entrarEnEdicion(registro) },
        }),
        botonEliminar,
      ]),
    ]);
  }));
}

/**
 * Abre el diálogo para registrar horas.
 * @param {{tareaId?:number, fecha?:string}} [inicial] Tarea y día preseleccionados (al pulsar una celda).
 */
function abrirDialogo({ tareaId = null, fecha = null } = {}) {
  const editables = datos?.tareas.filter((t) => t.editable) ?? [];
  if (editables.length === 0) {
    mostrarAviso('No tienes tareas en las que puedas registrar horas esta semana.', 'error');
    return;
  }
  salirDeEdicion();
  errorDialogo('');
  $('mh-tarea').replaceChildren(...editables.map((t) => crear('option', {
    texto: `${t.titulo} — ${t.proyecto}`,
    atributos: { value: t.id },
  })));
  if (tareaId) $('mh-tarea').value = tareaId;
  $('mh-fecha').max = datos.semana.hoy;
  $('mh-fecha').value = fecha ?? datos.semana.hoy;
  dibujarRegistros();
  $('mh-dialogo').showModal();
  $('mh-horas').focus();
}

/**
 * Envía el formulario: crea o edita el registro.
 * @param {SubmitEvent} evento Envío del formulario.
 */
async function enviar(evento) {
  evento.preventDefault();
  const horas = $('mh-horas').value === '' ? NaN : Number($('mh-horas').value);
  const fecha = $('mh-fecha').value;
  const mensaje = validarRegistro({ horas, fecha, hoy: datos.semana.hoy });
  if (mensaje) {
    errorDialogo(mensaje);
    return;
  }

  const nota = $('mh-nota').value;
  const tarea = tareaElegida();
  const eraEdicion = Boolean(editando);
  $('mh-guardar').disabled = true;
  errorDialogo('');
  try {
    if (editando) {
      await api(`${RUTA_HORAS}/${editando}`, { metodo: 'PATCH', cuerpo: { fecha, horas, nota } });
    } else {
      await api(RUTA_HORAS, { metodo: 'POST', cuerpo: { tareaId: tarea.id, fecha, horas, nota } });
    }
    $('mh-dialogo').close();
    await cargar(datos.semana.inicio);
    mostrarAviso(eraEdicion ? 'Registro actualizado.' : `Registraste ${formatearHoras(horas)} h en «${tarea.titulo}».`);
  } catch (error) {
    // El formulario se conserva para poder reintentar sin volver a escribir
    errorDialogo(mensajeDeError(error, 'No se pudo guardar el registro. Tus datos se conservaron: inténtalo de nuevo.'));
  } finally {
    $('mh-guardar').disabled = false;
  }
}

/* ======================================================================
 * Inicio
 * ====================================================================== */

montarBarraSuperior();

// Permisos del proyecto activo, el mismo que usan el resto de las pantallas
const proyectoActivo = Number(localStorage.getItem('proyectoActivo')) || null;
if (proyectoActivo) {
  cargarPermisos(proyectoActivo).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
}

$('mh-anterior').addEventListener('click', () => datos && cargarConAviso(desplazar(datos.semana.inicio, -7)));
$('mh-siguiente').addEventListener('click', () => datos && cargarConAviso(desplazar(datos.semana.inicio, 7)));
$('mh-hoy').addEventListener('click', () => cargarConAviso(null));
$('mh-registrar').addEventListener('click', () => abrirDialogo());
$('mh-form').addEventListener('submit', enviar);
$('mh-cerrar').addEventListener('click', () => $('mh-dialogo').close());
$('mh-cancelar-edicion').addEventListener('click', () => { salirDeEdicion(); errorDialogo(''); });
$('mh-tarea').addEventListener('change', dibujarRegistros);
$('mh-fecha').addEventListener('change', dibujarRegistros);
$('mh-dialogo').addEventListener('close', salirDeEdicion);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && datos) cargar(datos.semana.inicio).catch(() => { /* se conserva lo mostrado */ });
});

cargarConAviso(null);
temporizador.refrescar().catch(() => { /* sin temporizador visible hasta que haya conexión */ });