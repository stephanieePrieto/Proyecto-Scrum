// Responsable: Alfonso - HU-20: drawer de detalle de tarjeta (datos, subtareas, adjuntos, comentarios e historial)
/**
 * @file detalle-tarjeta.js
 * @description Controlador principal del detalle. Se abre al hacer clic (o Enter) sobre una tarjeta `.tarjeta-item`
 *              o al entrar con `?tarea=ID` en la URL (enlace de las notificaciones de mención).
 *              Carga sus propios estilos, atrapa el foco mientras está abierto y se cierra con Esc.
 */
import { api } from '../../core/api.js';
import { crear, crearAviso, mensajeError, formatearFecha } from './dom.js';
import { montarComentarios } from './comentarios.js';
import { montarAdjuntos } from './adjuntos.js';

const RUTA_CSS = '/css/componentes/detalle-tarjeta.css';
const ENFOCABLES = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const UMBRAL_DESVIACION = 20;
const MAX_ITEM = 200;

/** Cómo se redacta cada acción del historial. */
const TEXTO_ACCION = {
  comentario_agregado: () => 'comentó en la tarjeta',
  adjunto_agregado: (d) => `adjuntó «${d.nombre ?? 'un archivo'}»`,
  adjunto_eliminado: (d) => `eliminó el adjunto «${d.nombre ?? 'un archivo'}»`,
  checklist_agregado: (d) => `agregó la subtarea «${d.texto ?? ''}»`,
  checklist_completado: (d) => `completó la subtarea «${d.texto ?? ''}»`,
  checklist_reabierto: (d) => `reabrió la subtarea «${d.texto ?? ''}»`,
  checklist_eliminado: (d) => `eliminó la subtarea «${d.texto ?? ''}»`,
};

let referencias = null;
let ultimoFoco = null;
let tareaActual = null;
let solicitud = 0;
let refrescarHistorial = null;

/** Carga la hoja de estilos del detalle una sola vez. */
function asegurarEstilos() {
  if (document.querySelector(`link[href="${RUTA_CSS}"]`)) return;
  document.head.append(crear('link', { atributos: { rel: 'stylesheet', href: RUTA_CSS } }));
}

/**
 * Crea (una vez) el drawer y devuelve sus referencias.
 * @returns {{overlay:HTMLElement, panel:HTMLElement, titulo:HTMLElement, subtitulo:HTMLElement, cuerpo:HTMLElement, cerrar:HTMLElement}}
 */
function obtenerPanel() {
  if (referencias) return referencias;
  const subtitulo = crear('p', { clase: 'dt-subtitulo' });
  const titulo = crear('h2', { clase: 'dt-titulo', atributos: { id: 'dt-titulo' } });
  const cerrar = crear('button', {
    clase: 'dt-cerrar',
    texto: '✕',
    atributos: { type: 'button', 'aria-label': 'Cerrar el detalle de la tarjeta' },
    eventos: { click: () => cerrarDetalleTarjeta() },
  });
  const cuerpo = crear('div', { clase: 'dt-cuerpo' });
  const panel = crear('div', {
    clase: 'dt-panel',
    atributos: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dt-titulo' },
  }, [
    crear('header', { clase: 'dt-encabezado' }, [crear('div', { clase: 'dt-encabezado__texto' }, [subtitulo, titulo]), cerrar]),
    cuerpo,
  ]);
  const overlay = crear('div', { clase: 'dt-overlay', atributos: { hidden: true } }, [panel]);
  overlay.addEventListener('mousedown', (evento) => {
    if (evento.target === overlay) cerrarDetalleTarjeta();
  });
  document.body.append(overlay);

  referencias = { overlay, panel, titulo, subtitulo, cuerpo, cerrar };
  return referencias;
}

/** @returns {HTMLElement} Bloques grises mientras se carga. */
function crearEsqueleto() {
  return crear('div', { clase: 'dt-esqueletos', atributos: { 'aria-busy': 'true', 'aria-label': 'Cargando tarjeta' } }, [
    crear('div', { clase: 'dt-esqueleto' }),
    crear('div', { clase: 'dt-esqueleto dt-esqueleto--corto' }),
    crear('div', { clase: 'dt-esqueleto dt-esqueleto--alto' }),
    crear('div', { clase: 'dt-esqueleto' }),
  ]);
}

/**
 * Redacta una entrada del historial.
 * @param {string} accion Clave de la acción.
 * @param {Object|null} detalle Datos extra.
 * @returns {string}
 */
function describirAccion(accion, detalle) {
  const redactar = TEXTO_ACCION[accion];
  if (redactar) return redactar(detalle && typeof detalle === 'object' ? detalle : {});
  const legible = String(accion ?? '').replace(/_/g, ' ').trim();
  return legible || 'realizó un cambio';
}

/**
 * Dibuja el historial de cambios.
 * @param {HTMLElement} lista Elemento `ul`.
 * @param {Object[]} historial Entradas del servidor.
 */
function pintarHistorial(lista, historial) {
  if (!historial.length) {
    lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Aún no hay cambios registrados.' }));
    return;
  }
  lista.replaceChildren(...historial.map((entrada) => crear('li', { clase: 'dt-historial__item' }, [
    crear('span', {}, [
      crear('strong', { texto: entrada.usuario?.nombre ?? 'Alguien' }),
      ` ${describirAccion(entrada.accion, entrada.detalle)}`,
    ]),
    crear('time', { texto: formatearFecha(entrada.creadoEn), atributos: { datetime: entrada.creadoEn } }),
  ])));
}

/**
 * Construye una pareja etiqueta/valor de la cuadrícula de datos.
 * @param {string} etiqueta Nombre del dato.
 * @param {Node|string} valor Contenido.
 * @returns {HTMLElement}
 */
function dato(etiqueta, valor) {
  return crear('div', { clase: 'dt-dato' }, [crear('dt', { texto: etiqueta }), crear('dd', {}, [valor])]);
}

/**
 * Construye la cuadrícula con los datos principales de la tarjeta.
 * @param {Object} tarea Tarjeta.
 * @returns {HTMLElement}
 */
function construirDatos(tarea) {
  let responsable = 'Sin asignar';
  if (tarea.responsable) responsable = tarea.responsable.activo === false ? 'Usuario inactivo' : tarea.responsable.nombre;

  const estimadas = tarea.horasEstimadas;
  const reales = tarea.horasReales;
  const desviacion = estimadas > 0 && reales > 0 ? ((reales - estimadas) / estimadas) * 100 : 0;
  const horas = crear('span', {
    clase: desviacion > UMBRAL_DESVIACION ? 'dt-horas dt-horas--alerta' : 'dt-horas',
    texto: `${estimadas ? `${estimadas} h` : '—'} est. / ${reales > 0 ? `${reales} h` : '—'} real`,
  });

  return crear('dl', { clase: 'dt-datos' }, [
    dato('Responsable', responsable),
    dato('Columna', tarea.columna ?? 'Sin columna'),
    dato('Horas', horas),
    dato('Actualizada', formatearFecha(tarea.actualizadaEn)),
  ]);
}

/**
 * Construye la sección de subtareas (checklist) con su barra de avance.
 * @param {number} tareaId Tarjeta.
 * @param {Object[]} itemsIniciales Subtareas cargadas.
 * @param {function(): void} alCambiar Se llama tras cada cambio (refresca el historial).
 * @returns {HTMLElement}
 */
function construirChecklist(tareaId, itemsIniciales, alCambiar) {
  const items = itemsIniciales.map((i) => ({ ...i }));
  const ocupados = new Set();
  const progresoTexto = crear('span', { clase: 'dt-contador' });
  const barraInterior = crear('div', { clase: 'dt-progreso__barra' });
  const barra = crear('div', {
    clase: 'dt-progreso',
    atributos: { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Avance de las subtareas' },
  }, [barraInterior]);
  const lista = crear('ul', { clase: 'dt-checklist' });
  const aviso = crearAviso();
  const entrada = crear('input', {
    clase: 'dt-entrada',
    atributos: { type: 'text', maxlength: MAX_ITEM, placeholder: 'Nueva subtarea…', 'aria-label': 'Texto de la nueva subtarea' },
  });
  const botonAgregar = crear('button', {
    clase: 'dt-boton dt-boton--secundario',
    texto: 'Agregar',
    atributos: { type: 'button' },
    eventos: { click: () => agregar() },
  });

  /** Dibuja la lista; si se indica, devuelve el foco a esa subtarea. */
  function pintar(enfocarId = null) {
    const hechos = items.filter((i) => i.hecho).length;
    const porcentaje = items.length ? Math.round((hechos / items.length) * 100) : 0;
    progresoTexto.textContent = items.length ? `(${hechos}/${items.length})` : '';
    barraInterior.style.width = `${porcentaje}%`;
    barra.setAttribute('aria-valuenow', String(porcentaje));
    barra.hidden = items.length === 0;

    if (items.length === 0) {
      lista.replaceChildren(crear('li', { clase: 'dt-vacio', texto: 'Sin subtareas.' }));
      return;
    }
    lista.replaceChildren(...items.map((item) => {
      const idCasilla = `dt-item-${item.id}`;
      const casilla = crear('input', {
        atributos: { type: 'checkbox', id: idCasilla, checked: item.hecho, disabled: ocupados.has(item.id) },
      });
      casilla.addEventListener('change', () => alternar(item, casilla.checked));
      return crear('li', { clase: `dt-checklist__item${item.hecho ? ' dt-checklist__item--hecho' : ''}` }, [
        casilla,
        crear('label', { texto: item.texto, atributos: { for: idCasilla } }),
        crear('button', {
          clase: 'dt-icono-boton',
          texto: '✕',
          atributos: { type: 'button', 'aria-label': `Eliminar la subtarea ${item.texto}` },
          eventos: { click: () => quitar(item) },
        }),
      ]);
    }));
    if (enfocarId !== null) document.getElementById(`dt-item-${enfocarId}`)?.focus();
  }

  async function alternar(item, nuevoValor) {
    ocupados.add(item.id);
    aviso.ocultar();
    try {
      const respuesta = await api(`/detalle-tarjeta/${tareaId}/checklist/${item.id}`, {
        metodo: 'PATCH',
        cuerpo: { hecho: nuevoValor },
      });
      Object.assign(item, respuesta.datos.item);
      alCambiar();
    } catch (error) {
      aviso.mostrar(mensajeError(error, 'No se pudo actualizar la subtarea.'));
    } finally {
      ocupados.delete(item.id);
      pintar(item.id);
    }
  }

  async function quitar(item) {
    aviso.ocultar();
    try {
      await api(`/detalle-tarjeta/${tareaId}/checklist/${item.id}`, { metodo: 'DELETE' });
      items.splice(items.indexOf(item), 1);
      alCambiar();
      pintar();
      entrada.focus();
    } catch (error) {
      aviso.mostrar(mensajeError(error, 'No se pudo eliminar la subtarea.'));
    }
  }

  async function agregar() {
    const texto = entrada.value.trim();
    if (!texto) {
      aviso.mostrar('Escribe el texto de la subtarea.');
      entrada.focus();
      return;
    }
    botonAgregar.disabled = true;
    aviso.ocultar();
    try {
      const respuesta = await api(`/detalle-tarjeta/${tareaId}/checklist`, { metodo: 'POST', cuerpo: { texto } });
      items.push(respuesta.datos.item);
      entrada.value = '';
      alCambiar();
      pintar();
    } catch (error) {
      aviso.mostrar(
        mensajeError(error, 'No se pudo agregar la subtarea. Tu texto se conservó.'),
        [{ texto: 'Reintentar', alClick: agregar }],
      );
    } finally {
      botonAgregar.disabled = false;
    }
  }

  entrada.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') { evento.preventDefault(); agregar(); }
  });

  pintar();
  return crear('section', { clase: 'dt-seccion' }, [
    crear('h3', { clase: 'dt-seccion__titulo' }, ['Subtareas y checklist', progresoTexto]),
    barra,
    lista,
    crear('div', { clase: 'dt-fila' }, [entrada, botonAgregar]),
    aviso.nodo,
  ]);
}

/**
 * Dibuja el detalle completo dentro del drawer.
 * @param {{tarea:Object, checklist:Object[], historial:Object[]}} datos Respuesta del servidor.
 */
function render({ tarea, checklist, historial }) {
  const { titulo, subtitulo, cuerpo } = obtenerPanel();
  titulo.textContent = tarea.titulo;
  subtitulo.textContent = `#${tarea.id}${tarea.historia ? ` • ${tarea.historia.titulo}` : ''}`;

  const listaHistorial = crear('ul', { clase: 'dt-historial__lista' });
  pintarHistorial(listaHistorial, historial);
  const idTarea = tarea.id;
  refrescarHistorial = async () => {
    try {
      const respuesta = await api(`/detalle-tarjeta/${idTarea}/historial`);
      if (tareaActual === idTarea) pintarHistorial(listaHistorial, respuesta.datos.historial);
    } catch { /* se conserva el historial anterior */ }
  };

  const seccionAdjuntos = crear('section', { clase: 'dt-seccion' });
  const seccionComentarios = crear('section', { clase: 'dt-seccion' });

  const bloques = [];
  if (tarea.bloqueada) {
    bloques.push(crear('div', { clase: 'dt-banner-bloqueo', atributos: { role: 'status' } }, [
      crear('strong', { texto: '🔒 Tarea bloqueada' }),
      crear('p', { texto: tarea.motivoBloqueo || 'Sin motivo registrado.' }),
    ]));
  }
  bloques.push(construirDatos(tarea));
  if (tarea.etiquetas.length) {
    bloques.push(crear('ul', { clase: 'dt-etiquetas', atributos: { 'aria-label': 'Etiquetas' } },
      tarea.etiquetas.map((etiqueta) => crear('li', { clase: 'dt-etiqueta', texto: etiqueta }))));
  }
  bloques.push(crear('section', { clase: 'dt-seccion' }, [
    crear('h3', { clase: 'dt-seccion__titulo', texto: 'Descripción' }),
    tarea.descripcion
      ? crear('p', { clase: 'dt-descripcion', texto: tarea.descripcion })
      : crear('p', { clase: 'dt-vacio', texto: 'Sin descripción.' }),
  ]));
  bloques.push(construirChecklist(idTarea, checklist, () => refrescarHistorial?.()));
  bloques.push(seccionAdjuntos, seccionComentarios);
  bloques.push(crear('details', { clase: 'dt-historial', atributos: { open: true } }, [
    crear('summary', { texto: 'Historial de cambios' }),
    listaHistorial,
  ]));

  cuerpo.replaceChildren(...bloques);
  montarAdjuntos(seccionAdjuntos, idTarea, { alCambiar: () => refrescarHistorial?.() });
  montarComentarios(seccionComentarios, idTarea, { alCambiar: () => refrescarHistorial?.() });
}

/**
 * Carga el detalle de una tarjeta y lo dibuja; si falla muestra "Reintentar".
 * @param {number} id Tarjeta.
 */
async function cargar(id) {
  const { cuerpo, titulo, subtitulo } = obtenerPanel();
  const turno = ++solicitud;
  titulo.textContent = 'Cargando tarjeta…';
  subtitulo.textContent = '';
  cuerpo.replaceChildren(crearEsqueleto());
  try {
    const respuesta = await api(`/detalle-tarjeta/${id}`);
    if (turno !== solicitud) return;
    render(respuesta.datos);
  } catch (error) {
    if (turno !== solicitud) return;
    const aviso = crearAviso();
    aviso.mostrar(
      mensajeError(error, 'No se pudo cargar la tarjeta.'),
      [{ texto: 'Reintentar', alClick: () => cargar(id) }],
    );
    titulo.textContent = 'No se pudo cargar';
    cuerpo.replaceChildren(aviso.nodo);
  }
}

/**
 * Abre el detalle de una tarjeta.
 * @param {number|string} tareaId Identificador de la tarjeta.
 * @returns {Promise<void>}
 */
export async function abrirDetalleTarjeta(tareaId) {
  const id = Number(tareaId);
  if (!Number.isInteger(id) || id <= 0) return;

  asegurarEstilos();
  const { overlay, cerrar } = obtenerPanel();
  if (overlay.hidden) ultimoFoco = document.activeElement;
  tareaActual = id;
  overlay.hidden = false;
  document.body.classList.add('dt-bloqueado');
  cerrar.focus();
  await cargar(id);
}

/** Cierra el detalle y devuelve el foco a la tarjeta de origen. */
export function cerrarDetalleTarjeta() {
  if (!referencias || referencias.overlay.hidden) return;
  solicitud += 1;
  tareaActual = null;
  refrescarHistorial = null;
  referencias.overlay.hidden = true;
  referencias.cuerpo.replaceChildren();
  document.body.classList.remove('dt-bloqueado');

  const url = new URL(window.location.href);
  if (url.searchParams.has('tarea')) {
    url.searchParams.delete('tarea');
    window.history.replaceState(null, '', url);
  }
  ultimoFoco?.focus?.();
}

/** Clic en una tarjeta del tablero abre su detalle. */
function alHacerClic(evento) {
  const tarjeta = evento.target.closest?.('.tarjeta-item');
  if (tarjeta?.dataset.tareaId) abrirDetalleTarjeta(tarjeta.dataset.tareaId);
}

/** Enter/Espacio sobre una tarjeta enfocada la abre; Esc cierra; Tab queda atrapado en el drawer. */
function alPresionarTecla(evento) {
  const abierto = referencias && !referencias.overlay.hidden;

  if (!abierto) {
    const objetivo = evento.target;
    if ((evento.key === 'Enter' || evento.key === ' ') && objetivo?.classList?.contains('tarjeta-item')) {
      evento.preventDefault();
      abrirDetalleTarjeta(objetivo.dataset.tareaId);
    }
    return;
  }

  if (evento.key === 'Escape') {
    cerrarDetalleTarjeta();
    return;
  }
  if (evento.key !== 'Tab') return;

  const enfocables = [...referencias.panel.querySelectorAll(ENFOCABLES)]
    .filter((nodo) => !nodo.hidden && nodo.getClientRects().length > 0);
  if (enfocables.length === 0) return;
  const primero = enfocables[0];
  const ultimo = enfocables[enfocables.length - 1];

  if (!referencias.panel.contains(document.activeElement)) {
    evento.preventDefault();
    primero.focus();
  } else if (evento.shiftKey && document.activeElement === primero) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && document.activeElement === ultimo) {
    evento.preventDefault();
    primero.focus();
  }
}

/** Registra los eventos y abre la tarjeta indicada en `?tarea=ID`. */
function iniciar() {
  asegurarEstilos();
  document.addEventListener('click', alHacerClic);
  document.addEventListener('keydown', alPresionarTecla);
  const id = new URLSearchParams(window.location.search).get('tarea');
  if (id) abrirDetalleTarjeta(id);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar, { once: true });
else iniciar();