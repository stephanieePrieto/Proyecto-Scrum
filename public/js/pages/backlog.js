// Responsable: Jetz - HU-02, HU-03, HU-04, HU-05: logica de la pantalla del Product Backlog (modal de historia, arrastrar, epicas y filtros) (llama a la API y escucha sockets)
/**
 * @file backlog.js
 * HU-02 · CRUD de historias  |  HU-03 · Priorizar arrastrando.
 *
 * Qué hace esta pantalla:
 *   1. Carga la lista priorizada del proyecto activo y la mantiene al día
 *      (eventos de Socket.io + recarga automática cada 5 s como respaldo).
 *   2. Formulario modal para crear y editar historias, con errores en línea.
 *   3. Borrador local: si se cae la conexión al guardar, el texto se conserva y se reintenta al reconectar.
 *   4. Reordenar arrastrando (o con Alt + ↑ / ↓ y los botones ↑ ↓). Si el servidor falla, la historia vuelve a su lugar.
 *   5. Eliminar con confirmación; si la historia está en un sprint activo se ofrece devolverla al backlog.
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */
import { escaparHtml, pluralizar } from '../core/utils.js';
import { montarBarraSuperior } from '../core/layout.js';
import { obtenerTokenCsrf } from '../core/seguridad.js';
import { cargarPermisos, escucharCambiosDeRol, tienePermiso } from '../core/permisos-ui.js';

montarBarraSuperior();

// ====================================================================
// Estado y referencias
// ====================================================================
const $ = (id) => document.getElementById(id);
const REFRESCO_MS = 5000;            // Recarga automática mientras los sockets de la base no estén listos
const BORRADOR_PREFIJO = 'bl-borrador';

const ctx = {
  proyectoId: null,
  historias: [],        // Lista priorizada tal como la devolvió el servidor
  epicas: [],
  epicaEditando: null,
  epicaEliminando: null,
  seleccionadaId: null,
  texto: '',            // Texto de la búsqueda
  filtros: { epica: '', estado: '', etiqueta: '' },
  firma: '',            // Resumen de la lista para detectar cambios sin repintar de más
  arrastrandoId: null,  // Historia que se está arrastrando
  guardando: false,     // Hay un guardado en curso (formulario u orden)
  pendiente: false,     // El último guardado del formulario falló por falta de conexión
  editando: null,       // Historia abierta en el formulario (null = nueva)
  base: null,           // Valores originales del formulario, para saber si hay cambios
  cargada: false,
  temporizadorMensaje: null,
  temporizadorBorrador: null,
};

const el = {
  lista: $('lista'), estadoLista: $('estado-lista'), detalle: $('detalle'), resumen: $('resumen'),
  mensaje: $('mensaje'), anuncio: $('anuncio'), buscar: $('buscar'), btnNueva: $('btn-nueva'),
  filtroEpica: $('filtro-epica'), filtroEstado: $('filtro-estado'), filtroEtiqueta: $('filtro-etiqueta'),
  btnLimpiarFiltros: $('btn-limpiar-filtros'), resultadoFiltros: $('resultado-filtros'),
  dlgHistoria: $('dialogo-historia'), form: $('formulario-historia'), avisoForm: $('aviso-form'),
  btnGuardar: $('btn-guardar-historia'), btnDescartarBorrador: $('btn-descartar-borrador'),
  dlgEliminar: $('dialogo-eliminar'), dlgDevolver: $('dialogo-devolver'),
  avisoBorrador: $('aviso-borrador'),
};
const CAMPOS = ['titulo', 'como', 'quiero', 'para', 'criterios', 'puntos', 'epica_id', 'etiquetas'];
const ID_CAMPO = { titulo: 'f-titulo', como: 'f-como', quiero: 'f-quiero', para: 'f-para', criterios: 'f-criterios', puntos: 'f-puntos', epica_id: 'f-epica', etiquetas: 'f-etiquetas' };

// ====================================================================
// Utilidades
// ====================================================================

/**
 * Petición a la API que conserva el cuerpo de la respuesta aunque sea un error
 * (el módulo core/api.js lo descarta y aquí necesitamos "detalles").
 * Si no hay conexión devuelve { sinConexion: true } en lugar de lanzar.
 *
 * Seguridad (HU-53): la sesión viaja en la cookie httpOnly "accessToken" (el navegador la envía sola)
 * y toda petición que modifica datos debe repetir el token CSRF en la cabecera X-CSRF-Token.
 */
async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
  const cabeceras = { 'Content-Type': 'application/json' };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())) cabeceras['X-CSRF-Token'] = obtenerTokenCsrf();

  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo, credentials: 'same-origin', headers: cabeceras, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    return { ok: false, estado: 0, sinConexion: true, datos: {} };
  }
  let datos = {};
  try { datos = await respuesta.json(); } catch { /* respuesta sin JSON */ }
  if (respuesta.status === 401) { location.href = '/pages/login.html'; }   // Sesión vencida o sin iniciar
  return { ok: respuesta.ok, estado: respuesta.status, sinConexion: false, datos };
}

/** Mostrar un aviso general. Los de éxito desaparecen solos. */
function mostrarMensaje(texto, tipo = 'info') {
  clearTimeout(ctx.temporizadorMensaje);
  // Reutilizar los estilos de avisos.css, ya cargados por la página.
  const variante = tipo === 'exito' ? 'exito' : tipo === 'error' ? 'error' : 'advertencia';
  el.mensaje.className = `alerta alerta--${variante} bl-mensaje`;
  el.mensaje.textContent = texto;
  el.mensaje.hidden = !texto;
  if (texto && tipo === 'exito') ctx.temporizadorMensaje = setTimeout(() => { el.mensaje.hidden = true; }, 5000);
}

/** Anunciar algo a lectores de pantalla. */
function anunciar(texto) {
  el.anuncio.textContent = '';
  setTimeout(() => { el.anuncio.textContent = texto; }, 30);
}

/** Aceptar solo colores hexadecimales para la épica (se inserta en un atributo style). */
const colorSeguro = (color) => (/^#[0-9a-fA-F]{3,8}$/.test(color ?? '') ? color : '#4F46E5');

/** Texto de error para el usuario: el del servidor si es útil; si es un error 5xx o no trae texto, el mensaje por defecto. */
const mensajeDe = (r, porDefecto) => (r.estado >= 500 || !r.datos?.mensaje ? porDefecto : r.datos.mensaje);

const buscarHistoria = (id) => ctx.historias.find((h) => h.id === id) ?? null;
const textoPuntos = (puntos) => (puntos === null || puntos === undefined ? '—' : `${puntos} pts`);
const filtroActivo = () => Boolean(ctx.texto.trim() || ctx.filtros.epica || ctx.filtros.estado || ctx.filtros.etiqueta);

/** Resumen de la lista: si no cambia, no hace falta repintar. */
const firmaDe = (historias) => historias.map((h) => `${h.id}:${h.orden}:${h.version}:${h.sprint_id ?? ''}:${h.estado}`).join('|');

/** Filtros combinados: deben cumplirse todos los criterios seleccionados. */
function historiasVisibles() {
  const texto = ctx.texto.trim().toLocaleLowerCase('es');
  return ctx.historias.filter((h) => {
    const etiquetas = Array.isArray(h.etiquetas) ? h.etiquetas : [];
    if (texto && !h.titulo.toLocaleLowerCase('es').includes(texto)
      && !etiquetas.some((e) => String(e).toLocaleLowerCase('es').includes(texto))) return false;
    if (ctx.filtros.epica && String(h.epica_id ?? 'sin-epica') !== ctx.filtros.epica) return false;
    if (ctx.filtros.estado && h.estado !== ctx.filtros.estado) return false;
    if (ctx.filtros.etiqueta && !etiquetas.includes(ctx.filtros.etiqueta)) return false;
    return true;
  });
}

/** Mantener las opciones actualizadas sin perder los filtros del usuario. */
function actualizarOpcionesFiltros() {
  const epicas = ctx.epicas.map((ep) => ({ valor: String(ep.id), texto: ep.nombre }));
  const etiquetas = [...new Set(ctx.historias.flatMap((h) => Array.isArray(h.etiquetas) ? h.etiquetas : []))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const opciones = [
    [el.filtroEpica, [{ valor: '', texto: 'Todas las épicas' }, { valor: 'sin-epica', texto: 'Sin épica' }, ...epicas], 'epica'],
    [el.filtroEtiqueta, [{ valor: '', texto: 'Todas las etiquetas' }, ...etiquetas.map((e) => ({ valor: e, texto: e }))], 'etiqueta'],
  ];
  for (const [selector, valores, clave] of opciones) {
    const seleccionado = ctx.filtros[clave];
    selector.replaceChildren(...valores.map(({ valor, texto }) => {
      const opcion = document.createElement('option');
      opcion.value = valor;
      opcion.textContent = texto;
      return opcion;
    }));
    if (valores.some(({ valor }) => valor === seleccionado)) selector.value = seleccionado;
    else { ctx.filtros[clave] = ''; selector.value = ''; }
  }
}

function limpiarFiltros() {
  ctx.texto = '';
  ctx.filtros = { epica: '', estado: '', etiqueta: '' };
  el.buscar.value = '';
  el.filtroEpica.value = '';
  el.filtroEstado.value = '';
  el.filtroEtiqueta.value = '';
  pintar();
}

// ====================================================================
// Pintar la lista
// ====================================================================

function filaHtml(h, indice, total, permitirMover) {
  const epica = h.epica_nombre
    ? `<span class="bl-chip" style="--epica:${colorSeguro(h.epica_color)}">${escaparHtml(h.epica_nombre)}</span>` : '';
  const propuesta = h.propuesta ? '<span class="insignia insignia--info">Propuesta</span>' : '';
  const sprint = h.estado === 'en_sprint' ? '<span class="insignia insignia--neutro">En sprint</span>' : '';
  const puntos = `<span class="bl-puntos${h.puntos == null ? ' bl-puntos--vacio' : ''}">${textoPuntos(h.puntos)}</span>`;
  const clases = ['bl-historia', h.id === ctx.seleccionadaId ? 'bl-historia--seleccionada' : '', h.estado === 'en_sprint' ? 'bl-historia--en-sprint' : ''].join(' ').trim();
  return `<li class="${clases}" data-id="${h.id}" draggable="${permitirMover}">
    <span class="bl-historia__asa" aria-hidden="true">⠿</span>
    <span class="bl-historia__id">HU-${String(h.numero_hu ?? h.id).padStart(2, '0')}</span>
    <button class="bl-historia__abrir" type="button" data-control="abrir"
      aria-label="Historia ${indice + 1} de ${total}: ${escaparHtml(h.titulo)}. ${h.puntos == null ? 'Sin estimar' : h.puntos + ' puntos'}"
      aria-pressed="${h.id === ctx.seleccionadaId}">${escaparHtml(h.titulo)}</button>
    <span class="bl-historia__chips">${propuesta}${sprint}${epica}${puntos}</span>
    <span class="bl-historia__mover">
      <button class="bl-mover" type="button" data-control="subir" aria-label="Subir prioridad de ${escaparHtml(h.titulo)}" ${!permitirMover || indice === 0 ? 'disabled' : ''}>▲</button>
      <button class="bl-mover" type="button" data-control="bajar" aria-label="Bajar prioridad de ${escaparHtml(h.titulo)}" ${!permitirMover || indice === total - 1 ? 'disabled' : ''}>▼</button>
    </span>
  </li>`;
}

/** Repintar lista, contadores y detalle conservando el foco del teclado. */
function pintar() {
  const previo = document.activeElement;
  const filaPrevia = previo?.closest?.('.bl-historia');
  const foco = filaPrevia && el.lista.contains(previo) ? { id: filaPrevia.dataset.id, control: previo.dataset.control } : null;

  const visibles = historiasVisibles();
  const permitirMover = !filtroActivo();
  el.lista.innerHTML = visibles.map((h, i) => filaHtml(h, i, visibles.length, permitirMover)).join('');

  // Estado vacío / sin resultados
  if (!ctx.historias.length) {
    el.estadoLista.innerHTML = `<div class="aviso--vacio bl-vacio">
      <h3 class="aviso__titulo">Aún no hay historias</h3>
      <p class="aviso__texto">Crea la primera historia para empezar a priorizar el producto.</p>
      <button class="boton boton--primario" type="button" data-accion="nueva">+ Crear la primera historia</button></div>`;
  } else if (!visibles.length) {
    el.estadoLista.innerHTML = `<div class="aviso--vacio bl-vacio">
      <h3 class="aviso__titulo">Ninguna historia coincide</h3>
      <p class="aviso__texto">No se encontraron historias con los filtros seleccionados.</p>
      <button class="boton boton--secundario" type="button" data-accion="limpiar">Limpiar filtros</button></div>`;
  } else {
    el.estadoLista.innerHTML = filtroActivo() ? '<p class="bl-ayuda">Limpia los filtros para poder reordenar.</p>' : '';
  }

  // Los contadores corresponden a las historias visibles (criterio HU-04).
  const puntos = visibles.reduce((suma, h) => suma + (Number(h.puntos) || 0), 0);
  const sinEstimar = visibles.filter((h) => h.puntos == null).length;
  $('total-historias').textContent = `${visibles.length} ${pluralizar(visibles.length, 'historia', 'historias')}`;
  $('total-puntos').textContent = `${puntos} pts`;
  $('resumen-historias').textContent = visibles.length;
  $('resumen-historias-texto').textContent =
    pluralizar(visibles.length, 'historia', 'historias');
  $('resumen-puntos').textContent = puntos;
  $('resumen-sin-estimar').textContent = sinEstimar;
  el.resumen.hidden = !visibles.length;
  el.btnLimpiarFiltros.hidden = !filtroActivo();
  el.resultadoFiltros.hidden = !filtroActivo();
  el.resultadoFiltros.textContent = filtroActivo()
    ? `${visibles.length} de ${ctx.historias.length} historias · ${puntos} puntos en los resultados`
    : '';

  pintarDetalle();

  if (foco) {
    // Devolver el foco al mismo control; si quedó deshabilitado (p. ej. "subir" en la primera fila), al título
    const mismo = el.lista.querySelector(`[data-id="${foco.id}"] [data-control="${foco.control}"]:not([disabled])`);
    (mismo ?? el.lista.querySelector(`[data-id="${foco.id}"] [data-control="abrir"]`))?.focus();
  }
}

/** Panel de detalle de la historia seleccionada. */
function pintarDetalle() {
  const h = buscarHistoria(ctx.seleccionadaId);
  if (!h) {
    el.detalle.innerHTML = '<p class="bl-detalle__vacio">Selecciona una historia de la lista para ver su detalle.</p>';
    return;
  }
  const criterios = (h.criterios ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const etiquetas = (h.etiquetas ?? []).map((e) => `<span class="insignia insignia--neutro">${escaparHtml(e)}</span>`).join('');
  const epica = h.epica_nombre ? `<span class="bl-chip" style="--epica:${colorSeguro(h.epica_color)}">${escaparHtml(h.epica_nombre)}</span>` : '';
  el.detalle.innerHTML = `
    <div>
      <p class="bl-meta">HU-${String(h.numero_hu ?? h.id).padStart(2, '0')}${h.propuesta ? ' · Propuesta' : ''}${h.estado === 'en_sprint' && h.sprint_nombre ? ` · En ${escaparHtml(h.sprint_nombre)}` : ''}</p>
      <h2 class="bl-detalle__titulo">${escaparHtml(h.titulo)}</h2>
    </div>
    <div class="bl-detalle__chips">${epica}<span class="bl-puntos${h.puntos == null ? ' bl-puntos--vacio' : ''}">${h.puntos == null ? 'Sin estimar' : textoPuntos(h.puntos)}</span></div>
    <dl class="bl-como-detalle">
      <dt>COMO</dt><dd>${h.como ? escaparHtml(h.como) : '—'}</dd>
      <dt>QUIERO</dt><dd>${h.quiero ? escaparHtml(h.quiero) : '—'}</dd>
      <dt>PARA</dt><dd>${h.para ? escaparHtml(h.para) : '—'}</dd>
    </dl>
    <div>
      <h3 class="bl-subtitulo">Criterios de aceptación</h3>
      ${criterios.length ? `<ul class="bl-criterios">${criterios.map((c) => `<li>${escaparHtml(c)}</li>`).join('')}</ul>` : '<p class="bl-meta">Aún no tiene criterios.</p>'}
    </div>
    ${etiquetas ? `<div class="bl-etiquetas">${etiquetas}</div>` : ''}
    <p class="bl-meta">${h.creada_por_nombre ? `Creada por ${escaparHtml(h.creada_por_nombre)}` : ''}</p>
    <div class="bl-detalle__acciones">
      ${h.propuesta ? `<button class="boton boton--secundario" type="button" data-accion="rechazar-propuesta" data-permiso="historia.gestionar">Rechazar propuesta</button>
      <button class="boton boton--primario" type="button" data-accion="aceptar-propuesta" data-permiso="historia.gestionar">Aceptar propuesta</button>` : ''}
      <button class="boton boton--secundario boton--peligro" type="button" data-accion="eliminar">Eliminar</button>
      <button class="boton boton--primario" type="button" data-accion="editar">Editar historia</button>
    </div>`;
}

function pintarCarga() {
  el.estadoLista.innerHTML = '<div class="esqueleto bl-carga"></div>'.repeat(5);
}

// ====================================================================
// Carga y sincronización
// ====================================================================

/** Aplicar al estado local los datos que devolvió el servidor. */
function aplicarDatos({ historias, epicas }) {
  const previaSeleccion = ctx.seleccionadaId;
  ctx.historias = historias;
  if (epicas) ctx.epicas = epicas;
  actualizarOpcionesFiltros();
  ctx.firma = firmaDe(historias);

  if (previaSeleccion && !buscarHistoria(previaSeleccion)) {
    ctx.seleccionadaId = null;
    if (!el.dlgHistoria.open) mostrarMensaje('La historia que estabas viendo fue eliminada o terminó.', 'aviso');
  }
  avisarCambioMientrasSeEdita();
  pintar();
}

/** Si alguien más cambió la historia que se está editando, avisarlo dentro del formulario. */
function avisarCambioMientrasSeEdita() {
  if (!el.dlgHistoria.open || !ctx.editando) return;
  const actual = buscarHistoria(ctx.editando.id);
  if (!actual) mostrarAvisoForm('Esta historia fue eliminada por otra persona. Tu texto se conserva como borrador.');
  else if (actual.version !== ctx.editando.version) mostrarAvisoForm('Otra persona modificó esta historia mientras la editabas. Al guardar se te pedirá revisar los cambios.');
}

/**
 * Pedir la lista al servidor.
 * @param {{forzar?: boolean}} opciones - forzar = repintar aunque no haya cambios.
 */

async function refrescar({ forzar = false } = {}) {
  if (!ctx.proyectoId || ctx.arrastrandoId !== null || ctx.guardando) {
    return;
  }

  // Recordar a qué proyecto pertenece esta consulta
  const proyectoConsultado = ctx.proyectoId;

  const r = await llamar(
    `/backlog/proyecto/${proyectoConsultado}`
  );

  // Ignorar respuestas de proyectos anteriores
  if (String(proyectoConsultado) !== String(ctx.proyectoId)) {
    return;
  }

  if (!r.ok) {
    if (!ctx.cargada) mostrarErrorDeCarga(r);
    return;
  }

  if (
    !forzar &&
    ctx.cargada &&
    firmaDe(r.datos.historias) === ctx.firma &&
    JSON.stringify(r.datos.epicas ?? []) === JSON.stringify(ctx.epicas)
  ) {
    return;
  }

  ctx.cargada = true;
  aplicarDatos(r.datos);
}

function mostrarErrorDeCarga(r) {
  const texto = r.sinConexion ? 'No se pudo conectar con el servidor.'
    : r.estado === 404 ? 'No se encontró el proyecto o no tienes acceso a él.'
      : 'No se pudo cargar el backlog.';
  el.lista.innerHTML = '';
  el.estadoLista.innerHTML = `<div class="aviso--vacio bl-vacio"><h3 class="aviso__titulo">${texto}</h3>
    <button class="boton boton--secundario" type="button" data-accion="reintentar">Reintentar</button></div>`;
}

/** Elegir el proyecto: ?proyecto=ID, el último usado o el primero disponible. */
async function resolverProyecto() {
  const explicito = new URLSearchParams(location.search).get('proyecto');
  const guardado = localStorage.getItem('proyectoActivo');
  let id = explicito || guardado;

  if (id) {
    const r = await llamar(`/proyectos/${encodeURIComponent(id)}`);
    if (r.ok) return { id: Number(id), proyecto: r.datos.proyecto };
    if (explicito) return { id: null };   // Pidieron uno concreto y no existe: no cambiar en silencio
  }
  return { id: null };
}

// Conexión de Socket.io utilizada por el Product Backlog
let socketBacklog = null;

/** Eventos en tiempo real: cualquier cambio de otra persona dispara una recarga inmediata. */
function conectarTiempoReal() {
  // Si Socket.io no está disponible, seguimos usando el refresco automático
  if (typeof window.io !== 'function') return;

  // Evitar crear conexiones duplicadas
  if (socketBacklog) return;

  try {
    socketBacklog = window.io();
    escucharCambiosDeRol(socketBacklog);

    // Unirse al proyecto activo cada vez que se establece la conexión
    socketBacklog.on('connect', () => {
      socketBacklog.emit('unirse_proyecto', ctx.proyectoId);
    });

    // Actualizar las historias cuando ocurra un cambio
    [
      'story:created',
      'story:updated',
      'story:deleted',
      'story:reordered'
    ].forEach((evento) => {
      socketBacklog.on(evento, () => {
        refrescar({ forzar: true });
      });
    });

  } catch (error) {
    console.error('No se pudo conectar Socket.io:', error);
  }
}

// ====================================================================
// Selección, búsqueda y clics
// ====================================================================

function seleccionar(id) {
  ctx.seleccionadaId = id;
  pintar();
}

el.buscar.addEventListener('input', () => { ctx.texto = el.buscar.value; pintar(); });
el.filtroEpica.addEventListener('change', () => { ctx.filtros.epica = el.filtroEpica.value; pintar(); });
el.filtroEstado.addEventListener('change', () => { ctx.filtros.estado = el.filtroEstado.value; pintar(); });
el.filtroEtiqueta.addEventListener('change', () => { ctx.filtros.etiqueta = el.filtroEtiqueta.value; pintar(); });
el.btnLimpiarFiltros.addEventListener('click', limpiarFiltros);

el.btnNueva.addEventListener('click', () => abrirFormulario(null));

// Delegación: botones que se crean al repintar (lista, detalle y estados vacíos)
document.addEventListener('click', (e) => {
  const control = e.target.closest('[data-control]');
  const fila = e.target.closest('.bl-historia');
  if (control && fila) {
    const id = Number(fila.dataset.id);
    if (control.dataset.control === 'abrir') seleccionar(id);
    if (control.dataset.control === 'subir') moverUnaPosicion(id, -1);
    if (control.dataset.control === 'bajar') moverUnaPosicion(id, 1);
    return;
  }
  const accion = e.target.closest('[data-accion]')?.dataset.accion;
  if (accion === 'nueva') abrirFormulario(null);
  if (accion === 'editar') { const h = buscarHistoria(ctx.seleccionadaId); if (h) abrirFormulario(h); }
  if (accion === 'eliminar') abrirConfirmarEliminar();
  if (accion === 'aceptar-propuesta') resolverPropuesta(true);
  if (accion === 'rechazar-propuesta') resolverPropuesta(false);
  if (accion === 'reintentar') { pintarCarga(); refrescar({ forzar: true }); }
  if (accion === 'limpiar') limpiarFiltros();
});

// ====================================================================
// HU-03 · Reordenar (arrastrar, teclado y botones)
// ====================================================================

/** Nueva lista con `id` colocado antes de `antesId` (null = al final). */
function conMovimiento(historias, id, antesId) {
  const sin = historias.filter((h) => h.id !== id);
  const movida = historias.find((h) => h.id === id);
  const posicion = antesId === null ? sin.length : sin.findIndex((h) => h.id === antesId);
  sin.splice(posicion < 0 ? sin.length : posicion, 0, movida);
  return sin;
}

/**
 * Mover una historia y guardar la nueva prioridad.
 * Se pinta el cambio de inmediato; si el servidor lo rechaza o no hay conexión,
 * la historia vuelve a su posición original y se avisa del error.
 */
async function moverHistoria(id, antesId) {
  if (ctx.guardando) return;
  const previa = ctx.historias;
  const nueva = conMovimiento(previa, id, antesId);
  if (nueva.every((h, i) => h.id === previa[i].id)) return;   // Quedó donde estaba

  ctx.historias = nueva;
  pintar();
  const h = buscarHistoria(id);
  anunciar(`«${h.titulo}» ahora está en la posición ${nueva.findIndex((x) => x.id === id) + 1} de ${nueva.length}.`);

  ctx.guardando = true;
  const r = await llamar(`/backlog/proyecto/${ctx.proyectoId}/orden`, { metodo: 'PUT', cuerpo: { historia_id: id, antes_de_id: antesId } });
  ctx.guardando = false;

  if (r.ok) { aplicarDatos(r.datos); return; }

  // Falló: regresar la historia a su lugar y avisar
  ctx.historias = previa;
  pintar();
  mostrarMensaje(
    r.sinConexion ? 'No se pudo guardar el nuevo orden porque no hay conexión. La historia volvió a su posición.'
      : r.estado === 403 ? 'No tienes permiso para reordenar el backlog.'
        : r.estado === 409 ? mensajeDe(r, 'La lista cambió mientras la reordenabas.')
          : mensajeDe(r, 'No se pudo guardar el nuevo orden. La historia volvió a su posición.'),
    'error',
  );
  anunciar('No se pudo guardar el orden. La historia volvió a su posición.');
  if (r.estado === 409 || r.estado === 404) refrescar({ forzar: true });
}

/** Subir (-1) o bajar (+1) una posición. Se coloca "antes de" el vecino correspondiente. */
function moverUnaPosicion(id, delta) {
  if (filtroActivo()) return;
  const i = ctx.historias.findIndex((h) => h.id === id);
  const destino = i + delta;
  if (i < 0 || destino < 0 || destino >= ctx.historias.length) return;
  const antes = delta < 0 ? ctx.historias[destino].id : (ctx.historias[destino + 1]?.id ?? null);
  moverHistoria(id, antes);
}

// Teclado: Alt + ↑ / Alt + ↓ sobre una historia enfocada (alternativa al arrastre, HU-49)
el.lista.addEventListener('keydown', (e) => {
  const fila = e.target.closest('.bl-historia');
  if (!fila || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  moverUnaPosicion(Number(fila.dataset.id), e.key === 'ArrowUp' ? -1 : 1);
});

/** Con el cursor en `y`, decidir ANTES de qué historia se soltaría (null = al final). */
function destinoDeArrastre(y) {
  const filas = [...el.lista.querySelectorAll('.bl-historia:not(.bl-historia--arrastrando)')];
  const siguiente = filas.find((fila) => y < fila.getBoundingClientRect().top + fila.offsetHeight / 2);
  return { fila: siguiente ?? null, antesId: siguiente ? Number(siguiente.dataset.id) : null };
}

function limpiarMarcasDeArrastre() {
  el.lista.querySelectorAll('.bl-historia--destino, .bl-historia--arrastrando').forEach((n) => n.classList.remove('bl-historia--destino', 'bl-historia--arrastrando'));
  el.lista.classList.remove('bl-lista--destino-final');
}

el.lista.addEventListener('dragstart', (e) => {
  const fila = e.target.closest('.bl-historia');
  if (!fila || filtroActivo() || ctx.guardando) { e.preventDefault(); return; }
  ctx.arrastrandoId = Number(fila.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(ctx.arrastrandoId));   // Firefox exige datos para iniciar el arrastre
  requestAnimationFrame(() => fila.classList.add('bl-historia--arrastrando'));
});

el.lista.addEventListener('dragover', (e) => {
  if (ctx.arrastrandoId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const { fila } = destinoDeArrastre(e.clientY);
  el.lista.querySelectorAll('.bl-historia--destino').forEach((n) => n.classList.remove('bl-historia--destino'));
  fila?.classList.add('bl-historia--destino');
  el.lista.classList.toggle('bl-lista--destino-final', fila === null);
});

el.lista.addEventListener('drop', (e) => {
  if (ctx.arrastrandoId === null) return;
  e.preventDefault();
  const id = ctx.arrastrandoId;
  const { antesId } = destinoDeArrastre(e.clientY);
  ctx.arrastrandoId = null;
  limpiarMarcasDeArrastre();
  moverHistoria(id, antesId);
});

el.lista.addEventListener('dragend', () => { ctx.arrastrandoId = null; limpiarMarcasDeArrastre(); });

// ====================================================================
// HU-02 · Formulario (crear / editar) con borrador local
// ====================================================================

const claveBorrador = (historia) => `${BORRADOR_PREFIJO}:${ctx.proyectoId}:${historia ? historia.id : 'nueva'}`;

function leerBorrador(clave) {
  try { return JSON.parse(localStorage.getItem(clave)); } catch { return null; }
}
function escribirBorrador(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* almacenamiento lleno o bloqueado */ }
}
function borrarBorrador(clave) {
  try { localStorage.removeItem(clave); } catch { /* nada que borrar */ }
}

/** Valores que se muestran en el formulario para una historia (o vacíos si es nueva). */
function valoresDe(historia) {
  return {
    titulo: historia?.titulo ?? '', como: historia?.como ?? '', quiero: historia?.quiero ?? '', para: historia?.para ?? '',
    criterios: historia?.criterios ?? '', puntos: historia?.puntos == null ? '' : String(historia.puntos),
    epica_id: historia?.epica_id == null ? '' : String(historia.epica_id), etiquetas: (historia?.etiquetas ?? []).join(', '),
  };
}

const leerFormulario = () => Object.fromEntries(CAMPOS.map((c) => [c, $(ID_CAMPO[c]).value]));
const escribirFormulario = (valores) => CAMPOS.forEach((c) => { $(ID_CAMPO[c]).value = valores[c] ?? ''; });
const hayCambios = (valores) => CAMPOS.some((c) => (valores[c] ?? '').trim() !== (ctx.base[c] ?? '').trim());

function limpiarErrores() {
  CAMPOS.forEach((c) => { $(`error-${c}`).textContent = ''; $(ID_CAMPO[c]).removeAttribute('aria-invalid'); });
}

/** Marcar cada campo con su error en línea y llevar el foco al primero. */
function mostrarErrores(errores) {
  limpiarErrores();
  let primero = null;
  for (const [campo, mensaje] of Object.entries(errores)) {
    if (!ID_CAMPO[campo]) continue;
    $(`error-${campo}`).textContent = mensaje;
    $(ID_CAMPO[campo]).setAttribute('aria-invalid', 'true');
    primero ??= $(ID_CAMPO[campo]);
  }
  primero?.focus();
}

function mostrarAvisoForm(texto) {
  el.avisoForm.textContent = texto;
  el.avisoForm.hidden = !texto;
}

/** Misma validación que el servidor, para avisar sin esperar la respuesta. */
function validarLocal(v) {
  const errores = {};
  if (!v.como.trim()) {
    errores.como = 'El campo Como es obligatorio.';
  }

  if (!v.quiero.trim()) {
    errores.quiero = 'El campo Quiero es obligatorio.';
  }

  if (!v.para.trim()) {
    errores.para = 'El campo Para es obligatorio.';
  }
  if (!v.titulo.trim()) errores.titulo = 'Escribe el título de la historia.';
  else if (v.titulo.trim().length > 200) errores.titulo = 'El título no puede superar 200 caracteres.';
  if (v.puntos !== '' && ![1, 2, 3, 5, 8, 13, 21].includes(Number(v.puntos))) errores.puntos = 'Los puntos deben ser 1, 2, 3, 5, 8, 13 o 21.';
  const etiquetas = v.etiquetas.split(',').map((e) => e.trim()).filter(Boolean);
  if (etiquetas.length > 10) errores.etiquetas = 'Usa máximo 10 etiquetas.';
  else if (etiquetas.some((e) => e.length > 30)) errores.etiquetas = 'Cada etiqueta puede tener hasta 30 caracteres.';
  return errores;
}

function llenarEpicas() {
  $('f-epica').innerHTML = '<option value="">Sin épica</option>'
    + ctx.epicas.map((ep) => `<option value="${ep.id}">${escaparHtml(ep.nombre)}</option>`).join('');
}

/** Abrir el formulario para una historia nueva (null) o para editar una existente. */
function abrirFormulario(historia) {
  ctx.editando = historia;
  ctx.base = valoresDe(historia);
  ctx.pendiente = false;
  limpiarErrores();
  mostrarAvisoForm('');
  llenarEpicas();

  // Si hay un borrador guardado (por ejemplo, tras perder la conexión), recuperarlo
  const borrador = leerBorrador(claveBorrador(historia));
  escribirFormulario(borrador?.valores ?? ctx.base);
  el.btnDescartarBorrador.hidden = !borrador;
  if (borrador) mostrarAvisoForm('Recuperamos un borrador guardado en este dispositivo. Puedes continuar o descartarlo.');

  $('dialogo-historia-titulo').textContent = historia ? 'Editar historia' : 'Nueva historia';
  el.btnGuardar.textContent = historia ? 'Guardar cambios' : 'Guardar historia';
  ocultarAvisoBorradorPagina();
  el.dlgHistoria.showModal();
  $('f-titulo').focus();
}

// El texto se guarda como borrador mientras se escribe (con una pequeña espera para no escribir en cada tecla)
el.form.addEventListener('input', () => {
  clearTimeout(ctx.temporizadorBorrador);

  // Mostrar el botón inmediatamente cuando haya cambios
  const valores = leerFormulario();
  el.btnDescartarBorrador.hidden = !hayCambios(valores);

  // Guardar el borrador después de 300 ms
  ctx.temporizadorBorrador = setTimeout(guardarBorradorAhora, 300);
});

function guardarBorradorAhora() {
  const clave = claveBorrador(ctx.editando);
  const valores = leerFormulario();
  if (hayCambios(valores)) {
    escribirBorrador(clave, { valores, version: ctx.editando?.version ?? null, guardado_en: new Date().toISOString() });
    el.btnDescartarBorrador.hidden = false;
  } else {
    borrarBorrador(clave);
    el.btnDescartarBorrador.hidden = true;
  }
}

el.btnDescartarBorrador.addEventListener('click', () => {
  // Cancelar cualquier guardado automático pendiente
  clearTimeout(ctx.temporizadorBorrador);

  // Eliminar el borrador almacenado
  borrarBorrador(claveBorrador(ctx.editando));

  // Recuperar los valores originales
  escribirFormulario(ctx.base);

  // Limpiar avisos y errores
  limpiarErrores();
  mostrarAvisoForm('');

  // Ocultar el botón
  el.btnDescartarBorrador.hidden = true;
  ctx.pendiente = false;
});

// Cerrar el formulario con el botón Cancelar.
$('btn-cancelar-historia').addEventListener('click', () => {
  el.dlgHistoria.close();
});

// Cerrar el formulario con la X del encabezado.
$('btn-cerrar-historia').addEventListener('click', () => {
  el.dlgHistoria.close();
});

// Guardar los cambios como borrador al cerrar el formulario.
el.dlgHistoria.addEventListener('close', () => {
  guardarBorradorAhora();
  revisarBorradores();
});

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  enviarFormulario();
});

/** Guardar la historia (crear o editar). Se llama al enviar y al recuperar la conexión. */
async function enviarFormulario() {
  if (ctx.guardando) return;
  const valores = leerFormulario();
  const errores = validarLocal(valores);
  if (Object.keys(errores).length) { mostrarErrores(errores); return; }

  limpiarErrores();
  clearTimeout(ctx.temporizadorBorrador);
  guardarBorradorAhora();                 // Asegurar el borrador ANTES de intentar enviar
  ctx.guardando = true;
  el.btnGuardar.disabled = true;
  mostrarAvisoForm('');

  const cuerpo = {
    ...valores,
    puntos: valores.puntos === '' ? null : Number(valores.puntos),
    epica_id: valores.epica_id === '' ? null : Number(valores.epica_id),
  };
  const editando = ctx.editando;
  const r = editando
    ? await llamar(`/backlog/historias/${editando.id}`, { metodo: 'PUT', cuerpo: { ...cuerpo, version: editando.version } })
    : await llamar(`/backlog/proyecto/${ctx.proyectoId}/historias`, { metodo: 'POST', cuerpo });

  ctx.guardando = false;
  el.btnGuardar.disabled = false;

  // Sin conexión: el borrador ya está guardado; se reintenta solo al volver la red
  if (r.sinConexion) {
    ctx.pendiente = true;
    mostrarAvisoForm('Sin conexión. Tu texto está guardado como borrador en este dispositivo y se enviará solo cuando vuelvas a estar en línea.');
    return;
  }
  ctx.pendiente = false;

  if (r.ok) {
    borrarBorrador(claveBorrador(editando));
    el.btnDescartarBorrador.hidden = true;
    ctx.base = leerFormulario();          // Sin cambios pendientes: al cerrar no se vuelve a guardar un borrador
    el.dlgHistoria.close();
    const historia = r.datos.historia;
    const existe = buscarHistoria(historia.id);
    aplicarDatos({ historias: existe ? ctx.historias.map((h) => (h.id === historia.id ? historia : h)) : [...ctx.historias, historia] });
    seleccionar(historia.id);
    mostrarMensaje(editando ? 'Historia actualizada.' : 'Historia creada al final del backlog.', 'exito');
    anunciar(editando ? 'Historia actualizada.' : 'Historia creada.');
    refrescar({ forzar: true });          // Traer el orden real del servidor
    return;
  }

  if (r.estado === 400 && r.datos.detalles?.campos) { mostrarErrores(r.datos.detalles.campos); return; }
  if (r.estado === 409 && r.datos.detalles?.codigo === 'version') {
    // Alguien guardó antes. Se toma su versión como base (tu texto se conserva en el formulario):
    // si vuelves a guardar, tu texto reemplaza el suyo; si no, cancela y revisa el detalle.
    await refrescar({ forzar: true });
    const reciente = buscarHistoria(editando.id);
    if (reciente) ctx.editando = reciente;
    mostrarAvisoForm(`${r.datos.mensaje} Ya se cargó la versión más reciente de fondo: si guardas de nuevo, tu texto la reemplazará.`);
    return;
  }
  if (r.estado === 404 && editando) { mostrarAvisoForm('Esta historia ya no existe. Tu texto se conserva como borrador.'); refrescar({ forzar: true }); return; }
  mostrarAvisoForm(r.estado === 403 ? 'No tienes permiso para modificar el backlog.' : mensajeDe(r, 'No se pudo guardar la historia. Inténtalo de nuevo.'));
}

// Al volver la conexión, reintentar el guardado que quedó pendiente
window.addEventListener('online', () => {
  if (ctx.pendiente && el.dlgHistoria.open) { mostrarAvisoForm('Conexión recuperada. Enviando tu historia…'); enviarFormulario(); }
  else refrescar({ forzar: true });
});

// ----- Aviso en la página cuando quedó un borrador sin enviar -----

function borradoresDelProyecto() {
  const encontrados = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const clave = localStorage.key(i);
      if (clave?.startsWith(`${BORRADOR_PREFIJO}:${ctx.proyectoId}:`)) encontrados.push(clave);
    }
  } catch { /* sin acceso al almacenamiento */ }
  return encontrados;
}

function ocultarAvisoBorradorPagina() { el.avisoBorrador.hidden = true; }

/** Mostrar "Tienes un borrador sin guardar" si existe alguno. */
function revisarBorradores() {
  const claves = borradoresDelProyecto();
  if (!claves.length) { ocultarAvisoBorradorPagina(); return; }
  const clave = claves[0];

  // Identificar qué borrador se puede continuar o descartar
  el.avisoBorrador.dataset.clave = clave;

  const id = clave.split(':')[2];
  const borrador = leerBorrador(clave);
  const titulo = borrador?.valores?.titulo?.trim();

  const historia = id !== 'nueva'
    ? buscarHistoria(Number(id))
    : null;

  const numeroVisible = historia
    ? `HU-${String(historia.numero_hu ?? historia.id).padStart(2, '0')}`
    : `#${id}`;

  $('aviso-borrador-texto').textContent = id === 'nueva'
    ? `Tienes un borrador sin guardar${titulo ? `: «${titulo}»` : ''}.`
    : `Tienes cambios sin guardar en la historia ${numeroVisible}.`;
  el.avisoBorrador.hidden = false;
}

$('btn-continuar-borrador').addEventListener('click', () => {
  const id = el.avisoBorrador.dataset.clave?.split(':')[2];
  const historia = id && id !== 'nueva' ? buscarHistoria(Number(id)) : null;
  if (id && id !== 'nueva' && !historia) { borrarBorrador(el.avisoBorrador.dataset.clave); revisarBorradores(); return; }
  abrirFormulario(historia);
});
$('btn-descartar-borrador-pagina').addEventListener('click', () => { borrarBorrador(el.avisoBorrador.dataset.clave); revisarBorradores(); });

// ====================================================================
// HU-02 · Eliminar (con bloqueo si está en un sprint activo)
// ====================================================================

function abrirConfirmarEliminar() {
  const h = buscarHistoria(ctx.seleccionadaId);
  if (!h) return;
  $('eliminar-nombre').textContent = h.titulo;
  el.dlgEliminar.showModal();
}
$('btn-cancelar-eliminar').addEventListener('click', () => el.dlgEliminar.close());

$('btn-confirmar-eliminar').addEventListener('click', async () => {
  const h = buscarHistoria(ctx.seleccionadaId);
  if (!h || ctx.guardando) return;
  ctx.guardando = true;
  const r = await llamar(`/backlog/historias/${h.id}`, { metodo: 'DELETE' });
  ctx.guardando = false;
  el.dlgEliminar.close();

  if (r.ok) {
    borrarBorrador(claveBorrador(h));
    ctx.seleccionadaId = null;
    aplicarDatos({ historias: ctx.historias.filter((x) => x.id !== h.id) });
    mostrarMensaje('Historia eliminada.', 'exito');
    anunciar('Historia eliminada.');
    refrescar({ forzar: true });
    return;
  }
  // En un sprint activo: no se elimina, se ofrece devolverla al backlog
  if (r.estado === 409 && r.datos.detalles?.codigo === 'sprint_activo') {
    $('devolver-texto').textContent = `${r.datos.mensaje} Al devolverla, sus tareas salen del tablero del sprint.`;
    el.dlgDevolver.showModal();
    return;
  }
  mostrarMensaje(r.sinConexion ? 'No se pudo eliminar: no hay conexión.'
    : r.estado === 403 ? 'No tienes permiso para eliminar historias.'
      : mensajeDe(r, 'No se pudo eliminar la historia.'), 'error');
  if (r.estado === 404) refrescar({ forzar: true });
});

$('btn-cancelar-devolver').addEventListener('click', () => el.dlgDevolver.close());
$('btn-confirmar-devolver').addEventListener('click', async () => {
  const h = buscarHistoria(ctx.seleccionadaId);
  if (!h || ctx.guardando) return;
  ctx.guardando = true;
  const r = await llamar(`/backlog/historias/${h.id}/devolver`, { metodo: 'POST' });
  ctx.guardando = false;
  el.dlgDevolver.close();
  if (r.ok) {
    aplicarDatos({ historias: ctx.historias.map((x) => (x.id === h.id ? r.datos.historia : x)) });
    mostrarMensaje('La historia volvió al backlog. Ya puedes eliminarla si lo necesitas.', 'exito');
    refrescar({ forzar: true });
  } else {
    mostrarMensaje(mensajeDe(r, 'No se pudo devolver la historia al backlog.'), 'error');
  }
});

/**
 * Aceptar o rechazar la propuesta seleccionada. Al aceptarla pasa a ser una historia normal del
 * backlog; al rechazarla se conserva como rechazada y sale de la lista.
 *
 * @param {boolean} aceptar - true para aceptarla, false para rechazarla.
 * @returns {Promise<void>}
 */
async function resolverPropuesta(aceptar) {
  const h = buscarHistoria(ctx.seleccionadaId);
  if (!h || !h.propuesta || ctx.guardando) return;
  if (!aceptar && !window.confirm(`¿Rechazar la propuesta «${h.titulo}»? Saldrá del backlog.`)) return;

  ctx.guardando = true;
  const r = await llamar(`/backlog/historias/${h.id}/${aceptar ? 'aceptar' : 'rechazar'}`, { metodo: 'POST' });
  ctx.guardando = false;

  if (r.ok) {
    if (aceptar) {
      aplicarDatos({ historias: ctx.historias.map((x) => (x.id === h.id ? r.datos.historia : x)) });
    } else {
      ctx.seleccionadaId = null;
      aplicarDatos({ historias: ctx.historias.filter((x) => x.id !== h.id) });
    }
    const texto = aceptar ? 'Propuesta aceptada.' : 'Propuesta rechazada.';
    mostrarMensaje(texto, 'exito');
    anunciar(texto);
    refrescar({ forzar: true });
    return;
  }
  mostrarMensaje(r.sinConexion ? 'No se pudo resolver la propuesta: no hay conexión.'
    : r.estado === 403 ? 'No tienes permiso para aceptar o rechazar propuestas.'
      : mensajeDe(r, 'No se pudo resolver la propuesta.'), 'error');
  if (r.estado === 404 || r.estado === 409) refrescar({ forzar: true });
}

// ====================================================================
// HU-04 · Crear y editar épicas del proyecto seleccionado
// ====================================================================
const dlgEpicas = $('dialogo-epicas');
const formEpica = $('formulario-epica');
const avisoEpica = $('aviso-epica');
let temporizadorAvisoEpica = null;
function mostrarAvisoEpica(texto) {
  clearTimeout(temporizadorAvisoEpica);
  avisoEpica.textContent = texto;
  avisoEpica.hidden = false;
  temporizadorAvisoEpica = setTimeout(() => { avisoEpica.hidden = true; }, 5000);
}

function limpiarEdicionEpica() {
  ctx.epicaEditando = null;
  formEpica.reset();
  $('color-epica').value = '#4F46E5';
  $('titulo-form-epica').textContent = 'Nueva épica';
  $('guardar-epica').textContent = 'Crear épica';
  $('cancelar-edicion-epica').hidden = true;
  $('error-epica').textContent = '';
}

function pintarEpicas() {
  const contenedor = $('lista-epicas');
  if (!ctx.epicas.length) {
    contenedor.innerHTML = '<p class="bl-ayuda">Todavía no hay épicas en este proyecto.</p>';
    return;
  }
  contenedor.innerHTML = ctx.epicas.map((epica) => `
    <div class="bl-epica-fila">
      <span class="bl-epica-color" style="background:${colorSeguro(epica.color)}"></span>
      <span class="bl-epica-nombre">${escaparHtml(epica.nombre)}</span>
      <span class="bl-epica-fila__acciones">
        <button class="boton boton--secundario boton--pequeno" type="button" data-editar-epica="${epica.id}">Editar</button>
        <button class="boton boton--secundario boton--pequeno" type="button" data-eliminar-epica="${epica.id}" aria-label="Eliminar épica ${escaparHtml(epica.nombre)}">Eliminar</button>
      </span>
    </div>`).join('');
}

$('btn-epicas').addEventListener('click', () => {
  if (!ctx.proyectoId || !tienePermiso('historia.gestionar')) return;
  limpiarEdicionEpica();
  clearTimeout(temporizadorAvisoEpica);
  avisoEpica.hidden = true;
  pintarEpicas();
  dlgEpicas.showModal();
});
$('btn-cerrar-epicas').addEventListener('click', () => dlgEpicas.close());
$('cancelar-edicion-epica').addEventListener('click', limpiarEdicionEpica);
$('lista-epicas').addEventListener('click', (evento) => {
  const botonEliminar = evento.target.closest('[data-eliminar-epica]');
  if (botonEliminar) {
    abrirConfirmacionEliminarEpica(Number(botonEliminar.dataset.eliminarEpica));
    return;
  }
  const boton = evento.target.closest('[data-editar-epica]');
  if (!boton) return;
  const epica = ctx.epicas.find((e) => e.id === Number(boton.dataset.editarEpica));
  if (!epica) return;
  ctx.epicaEditando = epica.id;
  $('nombre-epica').value = epica.nombre;
  $('color-epica').value = colorSeguro(epica.color);
  $('titulo-form-epica').textContent = 'Editar épica';
  $('guardar-epica').textContent = 'Guardar cambios';
  $('cancelar-edicion-epica').hidden = false;
  $('error-epica').textContent = '';
  $('nombre-epica').scrollIntoView({ block: 'nearest' });
  $('nombre-epica').focus({ preventScroll: true });
});

const dlgEliminarEpica = $('dialogo-eliminar-epica');
function abrirConfirmacionEliminarEpica(epicaId) {
  if (!tienePermiso('historia.gestionar') || ctx.guardando) return;
  const epica = ctx.epicas.find((e) => e.id === epicaId);
  if (!epica) return;
  ctx.epicaEliminando = epicaId;
  const cantidad = ctx.historias.filter((h) => Number(h.epica_id) === epicaId).length;
  $('texto-eliminar-epica').textContent = cantidad
    ? `¿Eliminar «${epica.nombre}»? Tiene ${cantidad} ${cantidad === 1 ? 'historia asociada' : 'historias asociadas'}. Puedes reasignarlas o dejarlas sin épica.`
    : `¿Eliminar «${epica.nombre}»? Esta acción no se puede deshacer.`;
  const selector = $('destino-epica');
  selector.replaceChildren(new Option('Dejarlas sin épica', ''), ...ctx.epicas
    .filter((e) => e.id !== epicaId)
    .map((e) => new Option(`Mover a: ${e.nombre}`, String(e.id))));
  $('grupo-destino-epica').hidden = cantidad === 0;
  $('error-eliminar-epica').textContent = '';
  dlgEliminarEpica.showModal();
}
function cerrarConfirmacionEliminarEpica() {
  if (ctx.guardando) return;
  dlgEliminarEpica.close();
  ctx.epicaEliminando = null;
}
$('btn-cerrar-eliminar-epica').addEventListener('click', cerrarConfirmacionEliminarEpica);
$('btn-cancelar-eliminar-epica').addEventListener('click', cerrarConfirmacionEliminarEpica);
dlgEliminarEpica.addEventListener('cancel', (evento) => {
  if (ctx.guardando) evento.preventDefault();
  else ctx.epicaEliminando = null;
});
$('btn-confirmar-eliminar-epica').addEventListener('click', async () => {
  if (!ctx.proyectoId || !ctx.epicaEliminando || !tienePermiso('historia.gestionar') || ctx.guardando) return;
  ctx.guardando = true;
  const boton = $('btn-confirmar-eliminar-epica');
  boton.disabled = true;
  const id = ctx.epicaEliminando;
  const destino = $('destino-epica').value;
  const r = await llamar(`/epicas/proyecto/${ctx.proyectoId}/${id}`, {
    metodo: 'DELETE', cuerpo: { destino_epica_id: destino ? Number(destino) : null },
  });
  ctx.guardando = false;
  boton.disabled = false;
  if (!r.ok) {
    $('error-eliminar-epica').textContent = mensajeDe(r, 'No se pudo eliminar la épica.');
    if (r.estado === 404 || r.estado === 409) await refrescar({ forzar: true });
    return;
  }
  dlgEliminarEpica.close();
  ctx.epicaEliminando = null;
  if (ctx.epicaEditando === id) limpiarEdicionEpica();
  await refrescar({ forzar: true });
  pintarEpicas();
  mostrarAvisoEpica('Épica eliminada. Las historias se conservaron correctamente.');
});

formEpica.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!ctx.proyectoId || !tienePermiso('historia.gestionar') || ctx.guardando) return;
  const nombre = $('nombre-epica').value.trim();
  if (!nombre || nombre.length > 80) {
    $('error-epica').textContent = 'Escribe un nombre de 1 a 80 caracteres.';
    return;
  }
  ctx.guardando = true;
  $('guardar-epica').disabled = true;
  const id = ctx.epicaEditando;
  const r = await llamar(`/epicas/proyecto/${ctx.proyectoId}${id ? `/${id}` : ''}`, {
    metodo: id ? 'PUT' : 'POST', cuerpo: { nombre, color: $('color-epica').value },
  });
  ctx.guardando = false;
  $('guardar-epica').disabled = false;
  if (!r.ok) {
    $('error-epica').textContent = mensajeDe(r, 'No se pudo guardar la épica.');
    return;
  }
  limpiarEdicionEpica();
  await refrescar({ forzar: true });
  pintarEpicas();
  mostrarAvisoEpica(id ? 'Épica actualizada correctamente.' : 'Épica creada correctamente.');
});

// ====================================================================
// Arranque
// ====================================================================

async function iniciar() {
  pintarCarga();
  const { id, proyecto } = await resolverProyecto();
  if (!id) {
    el.lista.innerHTML = '';
    el.estadoLista.innerHTML = '<div class="aviso--vacio bl-vacio"><h3 class="aviso__titulo">No hay un proyecto seleccionado</h3><p class="aviso__texto">Elige un proyecto desde el Dashboard.</p><a class="boton boton--primario" href="pages/dashboard.html">Ir al Dashboard</a></div>';
    $('subtitulo').textContent = 'Sin proyecto';
    return;
  }
  ctx.proyectoId = id;
  localStorage.setItem('proyectoActivo', id);
  cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });

  // Registrar el proyecto inicial sin crear otra entrada en el historial
  const urlInicial = new URL(window.location.href);

  if (!urlInicial.searchParams.has('proyecto')) {
    urlInicial.searchParams.set('proyecto', id);
    window.history.replaceState({}, '', urlInicial);
  }


  $('subtitulo').textContent = proyecto ? `${proyecto.nombre}${proyecto.equipo_nombre ? ` · ${proyecto.equipo_nombre}` : ''}` : `Proyecto ${id}`;
  el.btnNueva.disabled = false;
  $('btn-epicas').disabled = false;

  await refrescar({ forzar: true });
  revisarBorradores();
  conectarTiempoReal();
  // Respaldo mientras los sockets de la base no estén listos: se actualiza sola cada 5 s (solo si la pestaña está visible)
  setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
}

iniciar();