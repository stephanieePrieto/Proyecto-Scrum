// Responsable: Alfonso - HU-21: filtros y swimlanes
/**
 * @file filtros.js
 * @description Filtros del tablero (persona, épica, etiqueta y estado), agrupación en carriles y persistencia
 *              (HU-21). Reemplaza a la versión inicial que vivía en columnas.js (poblarFiltros y
 *              aplicarFiltrosTablero).
 *
 *   - Las reglas (filtrar, agrupar, decidir) están en filtros.reglas.js; aquí solo se conecta con el DOM.
 *   - Filtrar y agrupar solo cambian la vista: no se envía nada al servidor (criterio 6). La única
 *     escritura es la reasignación confirmada al soltar una tarjeta en el carril de otra persona (criterio 4).
 *   - Los filtros se guardan en localStorage con la llave filtrosTablero:<proyectoId>:<usuarioId>, así se
 *     conservan al volver al tablero y entre sesiones (criterio 1).
 *   - columnas.js avisa con el evento `tablero:cargado` cuando llegan datos; reconexion.js avisa con
 *     `tablero:cambio-en-vivo` cuando otra persona cambia una tarjeta (criterio 5).
 */

import { api } from '../../core/api.js';
import { renderizarColumnas } from './columnas.js';
import { renderizarTarjetasEnTablero } from './tarjeta.js';
import { actualizarContadoresYAlertasWip } from './arrastrar.js';
import {
  estaEnModoCarriles,
  renderizarCarriles,
  actualizarContadoresCarriles,
  inicializarArrastreEntreCarriles,
} from './swimlanes.js';
import {
  MODOS_AGRUPACION,
  FILTROS_VACIOS,
  normalizarFiltros,
  hayFiltrosActivos,
  filtrarTareas,
  construirOpciones,
  depurarFiltros,
  agruparEnCarriles,
  aplicarCambioEnVivo,
  evaluarCambioEnVivo,
} from './filtros.reglas.js';
import { huboCambios } from '../../componentes/tiempo-real.reglas.js';

/** Prefijo de la llave de localStorage. */
const PREFIJO_LLAVE = 'filtrosTablero';

/** Tiempo que el aviso discreto permanece a la vista. */
const DURACION_AVISO_MS = 4500;

/** Duración de la animación con la que una tarjeta sale de la vista (debe coincidir con swimlanes.css). */
const DURACION_SALIDA_MS = 250;

/** Id de cada selector de la barra de filtros. */
const SELECTORES = Object.freeze({
  persona: 'filtro-persona',
  epica: 'filtro-epica',
  etiqueta: 'filtro-etiqueta',
  estado: 'filtro-estado',
  agrupar: 'filtro-agrupar',
});

/** Primera opción de cada selector (sin filtro). */
const TEXTO_TODOS = Object.freeze({
  persona: 'Persona: Todas',
  epica: 'Épica: Todas',
  etiqueta: 'Etiqueta: Todas',
  estado: 'Estado: Todos',
});

/** Estado de la vista. Las tareas son copias: modificarlas no toca los datos de columnas.js ni del servidor. */
const estado = {
  iniciado: false,
  proyectoId: null,
  usuarioId: 'anonimo',
  columnas: [],
  tareas: [],
  miembros: [],
  filtros: { ...FILTROS_VACIOS },
  /** La persona cambió un control antes de que se leyeran los filtros guardados. */
  tocado: false,
  /** Tareas cuyo dato vino de un aviso en vivo y el DOM aún no refleja (no se sincronizan desde el DOM). */
  cambiosEnVivo: new Set(),
  preparacion: Promise.resolve(),
};

let temporizadorAviso = null;

/** @returns {HTMLElement|null} */
function obtenerContenedor() {
  return document.getElementById('tablero-contenedor');
}

/** @returns {string} Llave de localStorage del proyecto y la persona actuales. */
function llaveFiltros() {
  return `${PREFIJO_LLAVE}:${estado.proyectoId}:${estado.usuarioId}`;
}

/**
 * Lee los filtros guardados; si no hay, el navegador no deja leer o el JSON está dañado, devuelve los vacíos.
 * @returns {Object}
 */
function leerFiltrosGuardados() {
  try {
    const texto = localStorage.getItem(llaveFiltros());
    return normalizarFiltros(texto ? JSON.parse(texto) : null);
  } catch {
    return { ...FILTROS_VACIOS };
  }
}

/** Guarda los filtros actuales; si el navegador no lo permite, solo duran mientras la página esté abierta. */
function guardarFiltros() {
  try {
    localStorage.setItem(llaveFiltros(), JSON.stringify(estado.filtros));
  } catch {
    /* Sin almacenamiento disponible (modo privado o bloqueado): el filtro sigue aplicado en esta visita */
  }
}

/**
 * Muestra un aviso discreto que desaparece solo. También lo usa el menú "Mover a…" (HU-52).
 * @param {string} texto
 * @param {'info'|'error'} [tono='info']
 */
export function mostrarAviso(texto, tono = 'info') {
  const aviso = document.getElementById('tablero-aviso');
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.dataset.tono = tono;
  aviso.classList.add('tablero-aviso--visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => aviso.classList.remove('tablero-aviso--visible'), DURACION_AVISO_MS);
}

/**
 * Columnas del tablero en su orden, como las conoce la vista (las usa el menú "Mover a…", HU-52).
 * @returns {{id: number, nombre: string}[]}
 */
export function obtenerColumnas() {
  return [...estado.columnas];
}

/**
 * Busca una tarea por id en el estado de la vista.
 * @param {string|number} tareaId
 * @returns {Object|undefined}
 */
function buscarTarea(tareaId) {
  return estado.tareas.find((t) => String(t.id) === String(tareaId));
}

/**
 * Reemplaza una tarea en el estado de la vista.
 * @param {Object} tarea
 */
function reemplazarTarea(tarea) {
  const indice = estado.tareas.findIndex((t) => String(t.id) === String(tarea.id));
  if (indice !== -1) estado.tareas[indice] = tarea;
}

/**
 * Toma del DOM la columna, la versión y el orden de cada tarjeta. El arrastre entre columnas (arrastrar.js)
 * y la convergencia de ediciones (convergencia.js, HU-25) cambian las tarjetas en el DOM sin avisar; sin esto,
 * al volver a filtrar la tarjeta regresaría a su columna anterior o con una versión vieja.
 * @param {HTMLElement} contenedor
 */
function sincronizarDesdeDom(contenedor) {
  contenedor.querySelectorAll('.tarjeta-item[data-tarea-id]').forEach((elemento) => {
    const id = elemento.dataset.tareaId;
    if (estado.cambiosEnVivo.has(id)) return;
    const tarea = buscarTarea(id);
    if (!tarea) return;
    const columna = elemento.closest('[data-columna-id]')?.dataset.columnaId;
    if (columna && String(tarea.columna_id) !== columna) tarea.columna_id = Number(columna);
    const version = Number(elemento.dataset.version);
    if (Number.isFinite(version) && version > 0) tarea.version = version;
    const orden = Number(elemento.dataset.orden);
    if (Number.isFinite(orden) && elemento.dataset.orden !== '') tarea.orden = orden;
  });
}

/** Recalcula los contadores de la vista vigente (columnas o carriles). */
function actualizarContadores() {
  const contenedor = obtenerContenedor();
  if (estaEnModoCarriles(contenedor)) actualizarContadoresCarriles(contenedor);
  else actualizarContadoresYAlertasWip();
}

/** Actualiza el resumen, el botón de limpiar y el mensaje de "sin resultados" (criterio 3). */
function actualizarEstadoFiltros() {
  const activos = hayFiltrosActivos(estado.filtros);
  const total = estado.tareas.length;
  const visibles = filtrarTareas(estado.tareas, estado.filtros).length;

  const resumen = document.getElementById('filtros-resumen');
  if (resumen) resumen.textContent = activos ? `Mostrando ${visibles} de ${total} ${total === 1 ? 'tarjeta' : 'tarjetas'}` : '';

  const botonLimpiar = document.getElementById('btn-limpiar-filtros');
  if (botonLimpiar) botonLimpiar.disabled = !activos;

  const sinResultados = document.getElementById('tablero-sin-resultados');
  if (sinResultados) sinResultados.hidden = !(activos && total > 0 && visibles === 0);
}

/**
 * Llena un selector con sus opciones y deja seleccionado el filtro vigente.
 * @param {string} campo - persona, epica, etiqueta o estado.
 * @param {{valor: string, etiqueta: string}[]} opciones
 */
function llenarSelector(campo, opciones) {
  const selector = document.getElementById(SELECTORES[campo]);
  if (!selector) return;
  const primera = new Option(TEXTO_TODOS[campo], '');
  selector.replaceChildren(primera, ...opciones.map((o) => new Option(o.etiqueta, o.valor)));
  selector.value = estado.filtros[campo];
}

/** Refleja los filtros vigentes en los controles sin volver a crear las opciones. */
function reflejarFiltrosEnControles() {
  for (const [campo, id] of Object.entries(SELECTORES)) {
    const selector = document.getElementById(id);
    if (selector) selector.value = estado.filtros[campo];
  }
}

/** Construye las opciones de los selectores con los datos actuales y descarta filtros que ya no existen. */
function poblarControles() {
  const opciones = construirOpciones(estado.tareas, { columnas: estado.columnas, miembros: estado.miembros });
  const { filtros, descartados } = depurarFiltros(estado.filtros, opciones);
  estado.filtros = filtros;
  if (descartados.length) guardarFiltros();

  llenarSelector('persona', opciones.personas);
  llenarSelector('epica', opciones.epicas);
  llenarSelector('etiqueta', opciones.etiquetas);
  llenarSelector('estado', opciones.estados);
  reflejarFiltrosEnControles();
}

/**
 * Dibuja el tablero con los filtros y la agrupación vigentes. Solo cambia la vista (criterio 6).
 * @param {Object} [opciones]
 * @param {boolean} [opciones.sincronizar=true] - Tomar antes del DOM la columna y versión de cada tarjeta.
 *   Se omite cuando los datos acaban de llegar del servidor, porque el DOM todavía muestra los anteriores.
 */
function renderizarVista({ sincronizar = true } = {}) {
  const contenedor = obtenerContenedor();
  if (!contenedor || estado.columnas.length === 0) return;

  if (sincronizar) sincronizarDesdeDom(contenedor);
  estado.cambiosEnVivo.clear();

  const visibles = filtrarTareas(estado.tareas, estado.filtros);
  const modo = estado.filtros.agrupar;

  if (modo === MODOS_AGRUPACION.NINGUNO) {
    renderizarColumnas(estado.columnas);
    renderizarTarjetasEnTablero(visibles);
    actualizarContadoresYAlertasWip();
  } else {
    const carriles = agruparEnCarriles(visibles, modo, { miembros: estado.miembros, personaFiltrada: estado.filtros.persona });
    renderizarCarriles(contenedor, carriles, estado.columnas, modo);
  }

  actualizarEstadoFiltros();
}

/**
 * Cambia un filtro (o la agrupación), lo guarda y vuelve a dibujar.
 * @param {string} campo
 * @param {string} valor
 */
function cambiarFiltro(campo, valor) {
  estado.tocado = true;
  estado.filtros = normalizarFiltros({ ...estado.filtros, [campo]: valor });
  guardarFiltros();
  renderizarVista();
}

/** Quita los filtros y conserva la agrupación elegida (agrupar no es un filtro). */
function limpiarFiltros() {
  estado.tocado = true;
  estado.filtros = normalizarFiltros({ ...FILTROS_VACIOS, agrupar: estado.filtros.agrupar });
  guardarFiltros();
  reflejarFiltrosEnControles();
  renderizarVista();
}

/**
 * Pide de nuevo los datos del tablero (solo lectura) y vuelve a dibujar.
 * Se usa cuando llega un aviso en vivo de una tarea que la vista no conoce o tras un conflicto.
 */
async function recargarDatos() {
  try {
    const respuesta = await api(`/tablero/${estado.proyectoId}`);
    const datos = respuesta?.data;
    if (!datos) return;
    if (Array.isArray(datos.columnas) && datos.columnas.length) estado.columnas = datos.columnas;
    estado.tareas = Array.isArray(datos.tareas) ? datos.tareas.map((t) => ({ ...t })) : [];
    estado.cambiosEnVivo.clear();
    poblarControles();
    renderizarVista({ sincronizar: false });
  } catch (error) {
    console.error('[HU-21] No se pudo actualizar el tablero:', error);
  }
}

/**
 * Sondeo del tablero cuando el WebSocket está bloqueado (HU-52, criterio 5). Lee el tablero (solo lectura) y
 * repinta únicamente si algo cambió, respetando filtros y carriles. Avisa de forma discreta si alguna tarjeta
 * que estaba a la vista ya no coincide con los filtros (HU-21, criterio 5). Conserva el scroll del tablero.
 * @returns {Promise<boolean>} true si hubo cambios y se repintó.
 */
export async function sincronizarConServidor() {
  const contenedor = obtenerContenedor();
  if (!contenedor || !estado.proyectoId || estado.columnas.length === 0) return false;

  const respuesta = await api(`/tablero/${estado.proyectoId}`);
  const datos = respuesta?.data;
  if (!datos || !Array.isArray(datos.tareas)) return false;
  const columnasNuevas = Array.isArray(datos.columnas) && datos.columnas.length ? datos.columnas : estado.columnas;

  // Lo que el DOM ya refleja (arrastres propios) cuenta como estado actual antes de comparar
  sincronizarDesdeDom(contenedor);
  if (!huboCambios({ columnas: estado.columnas, tareas: estado.tareas }, { columnas: columnasNuevas, tareas: datos.tareas })) {
    return false;
  }

  const nuevasPorId = new Map(datos.tareas.map((t) => [String(t.id), t]));
  const ocultadas = estado.tareas
    .filter((antes) => {
      const despues = nuevasPorId.get(String(antes.id));
      return despues && evaluarCambioEnVivo(antes, despues, estado.filtros).accion === 'ocultar';
    })
    .map((t) => t.titulo);

  const scroll = { x: contenedor.scrollLeft, y: contenedor.scrollTop };
  estado.columnas = columnasNuevas;
  estado.tareas = datos.tareas.map((t) => ({ ...t }));
  estado.cambiosEnVivo.clear();
  poblarControles();
  renderizarVista({ sincronizar: false });
  contenedor.scrollLeft = scroll.x;
  contenedor.scrollTop = scroll.y;

  if (ocultadas.length === 1) {
    mostrarAviso(`«${ocultadas[0]}» cambió y ya no coincide con tus filtros; se ocultó de la vista.`);
  } else if (ocultadas.length > 1) {
    mostrarAviso(`${ocultadas.length} tarjetas cambiaron y ya no coinciden con tus filtros; se ocultaron de la vista.`);
  }
  return true;
}

/**
 * Datos nuevos del tablero (evento `tablero:cargado` de columnas.js): aplica los filtros guardados.
 * @param {CustomEvent} evento
 */
async function alCargarTablero(evento) {
  const { columnas, tareas } = evento.detail || {};
  estado.columnas = Array.isArray(columnas) ? columnas : [];
  estado.tareas = Array.isArray(tareas) ? tareas.map((t) => ({ ...t })) : [];
  estado.cambiosEnVivo.clear();
  await estado.preparacion;
  poblarControles();
  renderizarVista();
}

/**
 * Quita una tarjeta de la vista con una animación corta y avisa de forma discreta (criterio 5).
 * @param {Object} tarea
 * @param {string} [quien] - Nombre de quien hizo el cambio.
 */
function sacarDeLaVista(tarea, quien) {
  const elemento = document.getElementById(`tarjeta-${tarea.id}`);
  const terminar = () => {
    elemento?.remove();
    actualizarContadores();
    actualizarEstadoFiltros();
  };
  if (elemento) {
    elemento.classList.add('tarjeta-item--saliendo');
    setTimeout(terminar, DURACION_SALIDA_MS);
  } else {
    terminar();
  }
  const autor = quien ? `${quien} cambió` : 'Cambió';
  mostrarAviso(`${autor} «${tarea.titulo}» y ya no coincide con tus filtros; se ocultó de la vista.`);
}

/**
 * Cambio hecho por otra persona (evento `tablero:cambio-en-vivo` que lanza reconexion.js).
 * @param {CustomEvent} evento
 */
async function alCambioEnVivo(evento) {
  const datos = evento.detail;
  if (!datos || datos.tareaId === undefined || estado.columnas.length === 0) return;
  if (datos.proyectoId !== undefined && String(datos.proyectoId) !== String(estado.proyectoId)) return;

  const antes = buscarTarea(datos.tareaId);
  if (!antes) {
    // Tarea que la vista no conoce (por ejemplo, recién creada): se vuelven a leer los datos
    await recargarDatos();
    return;
  }

  const despues = aplicarCambioEnVivo(antes, datos);
  reemplazarTarea(despues);
  estado.cambiosEnVivo.add(String(despues.id));

  const { accion } = evaluarCambioEnVivo(antes, despues, estado.filtros);
  const cambioVisibleEnTarjeta = datos.responsableId !== undefined || Array.isArray(datos.etiquetas);

  if (accion === 'ocultar') {
    sacarDeLaVista(despues, datos.usuarioNombre);
  } else if (accion === 'mostrar' || (accion === 'actualizar' && (cambioVisibleEnTarjeta || estaEnModoCarriles(obtenerContenedor())))) {
    renderizarVista();
  } else {
    // Solo cambió de columna en la vista de columnas: reconexion.js ya movió la tarjeta
    actualizarContadores();
    actualizarEstadoFiltros();
  }
}

/**
 * Reasigna la tarea después de que la persona confirmó (criterio 4). Es la única escritura de la HU-21.
 * @param {Object} tarea
 * @param {number} responsableId
 * @param {string} nombreDestino
 */
async function reasignarTarea(tarea, responsableId, nombreDestino) {
  if (!navigator.onLine) {
    mostrarAviso('Sin conexión: la tarea no se reasignó. Intenta de nuevo cuando vuelva la red.', 'error');
    return;
  }
  try {
    const respuesta = await api(`/reasignacion/tarea/${tarea.id}`, {
      metodo: 'POST',
      cuerpo: { responsable_id: responsableId, responsable_anterior_id: tarea.responsable_id ?? null },
    });
    const datos = respuesta?.datos ?? {};
    const antes = buscarTarea(tarea.id) ?? tarea;
    const despues = {
      ...antes,
      responsable_id: datos.responsable_id ?? responsableId,
      responsable: datos.responsable ?? nombreDestino,
      responsable_inactivo: false,
      version: datos.version ?? antes.version,
    };
    reemplazarTarea(despues);
    const { accion } = evaluarCambioEnVivo(antes, despues, estado.filtros);
    renderizarVista();
    mostrarAviso(accion === 'ocultar'
      ? `Tarea reasignada a ${despues.responsable}. Se ocultó porque ya no coincide con tus filtros.`
      : `Tarea reasignada a ${despues.responsable}.`);
  } catch (error) {
    mostrarAviso(error?.cuerpo?.mensaje || 'No se pudo reasignar la tarea. Intenta de nuevo.', 'error');
    if (error?.estado === 409) await recargarDatos();
  }
}

/**
 * Obtiene la persona (para la llave de localStorage) y los miembros del proyecto (para los carriles por
 * persona) y lee los filtros guardados. Si algo falla, se sigue con valores por defecto.
 * @param {string} proyectoId
 * @param {Promise<Object>} [promesaPermisos] - Respuesta de cargarPermisos (trae usuario_id).
 */
async function preparar(proyectoId, promesaPermisos) {
  const [permisos, miembros] = await Promise.all([
    Promise.resolve(promesaPermisos).catch(() => null),
    api(`/miembros/proyecto/${proyectoId}`).then((r) => r?.miembros ?? []).catch(() => []),
  ]);
  if (permisos?.usuario_id) estado.usuarioId = String(permisos.usuario_id);
  estado.miembros = Array.isArray(miembros) ? miembros : [];
  if (!estado.tocado) estado.filtros = leerFiltrosGuardados();
}

/** Conecta los selectores y los botones de limpiar. */
function conectarControles() {
  for (const [campo, id] of Object.entries(SELECTORES)) {
    document.getElementById(id)?.addEventListener('change', (evento) => cambiarFiltro(campo, evento.target.value));
  }
  document.getElementById('btn-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
  document.getElementById('btn-limpiar-filtros-vacio')?.addEventListener('click', limpiarFiltros);
}

/**
 * Inicia los filtros del tablero. Se llama una vez, antes de que lleguen los datos del tablero.
 *
 * @param {number|string} proyectoId - Proyecto activo.
 * @param {Promise<Object>} [promesaPermisos] - Promesa de cargarPermisos (permisos-ui.js), que trae usuario_id.
 * @returns {void}
 */
export function inicializarFiltros(proyectoId, promesaPermisos) {
  if (estado.iniciado) return;
  estado.iniciado = true;
  estado.proyectoId = String(proyectoId);
  estado.preparacion = preparar(estado.proyectoId, promesaPermisos);

  conectarControles();
  document.addEventListener('tablero:cargado', alCargarTablero);
  document.addEventListener('tablero:cambio-en-vivo', alCambioEnVivo);

  inicializarArrastreEntreCarriles({
    contenedor: obtenerContenedor(),
    obtenerModo: () => estado.filtros.agrupar,
    buscarTarea,
    alConfirmarReasignacion: reasignarTarea,
    avisar: mostrarAviso,
    alTerminarArrastre: () => {
      if (estaEnModoCarriles(obtenerContenedor())) actualizarContadoresCarriles(obtenerContenedor());
    },
  });
}
