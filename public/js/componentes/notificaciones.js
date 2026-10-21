// Responsable: Alfonso - HU-24: campana, contador y lista de notificaciones
/**
 * @file notificaciones.js
 * @description Componente de notificaciones de ScrumFlow (HU-24).
 *
 * - Renderiza una campana con badge de no leídas y un panel desplegable.
 * - Escucha el evento `notificacion:nueva` del WebSocket global.
 * - Marca como leída vía `PATCH /api/notificaciones/:id/leida` con
 *   actualización optimista del DOM y reversión si el servidor falla.
 *
 * SEGURIDAD: todo el contenido dinámico se inserta con `textContent`
 * (nunca `innerHTML`), por lo que un mensaje con `<script>` se muestra
 * como texto inerte (mitigación XSS, RNF-14).
 *
 * @example
 * import { inicializarNotificaciones } from './componentes/notificaciones.js';
 * const notif = inicializarNotificaciones({
 *   contenedor: document.querySelector('#notificaciones-root'),
 *   socket: window.scrumflowSocket,
 * });
 * // notif.destruir() al cerrar sesión.
 */

/** @constant {string} Nombre del evento de WebSocket emitido por el servidor. */
const EVENTO_NUEVA = 'notificacion:nueva';

/** @constant {string} URL base de la API de notificaciones. */
const URL_API_POR_DEFECTO = '/api/notificaciones';

/** @constant {number} Máximo numérico mostrado en el badge antes de "99+". */
const MAX_BADGE = 99;

/** @constant {Object<string,string>} Etiquetas legibles por tipo (lista blanca). */
const ETIQUETAS_TIPO = Object.freeze({
  asignacion: 'Asignación',
  mencion: 'Mención',
});

/**
 * @typedef {Object} Notificacion
 * @property {number} id
 * @property {'asignacion'|'mencion'} tipo
 * @property {string} titulo
 * @property {string} mensaje
 * @property {boolean} leida
 * @property {string} creadaEn - Fecha ISO 8601.
 */

/**
 * @typedef {Object} OpcionesNotificaciones
 * @property {HTMLElement} contenedor - Elemento donde se monta el componente.
 * @property {*} [socket] - Socket global (socket.io o WebSocket nativo).
 * @property {string} [urlApi] - URL base de la API.
 */

/* 
* Utilidades puras
*/

/**
 * Crea un elemento DOM de forma segura (texto vía `textContent`).
 * @param {string} etiqueta - Nombre de la etiqueta HTML.
 * @param {Object<string,string>} [atributos] - Atributos a asignar.
 * @param {string} [texto] - Texto plano del elemento.
 * @returns {HTMLElement} Elemento creado.
 */
function crearElemento(etiqueta, atributos = {}, texto = '') {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    el.setAttribute(clave, valor);
  }
  if (texto) el.textContent = texto;
  return el;
}

/**
 * Construye el icono SVG de campana (sin innerHTML).
 * @returns {SVGElement} Icono de campana.
 */
function crearIconoCampana() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'notif__icono');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [
    'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9',
    'M13.73 21a2 2 0 0 1-3.46 0',
  ]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Valida y normaliza una notificación recibida (API o WebSocket).
 * Descarta datos con forma inesperada para no renderizar basura.
 * @param {*} bruto - Objeto sin confiar.
 * @returns {Notificacion|null} Notificación normalizada o `null` si es inválida.
 */
export function normalizarNotificacion(bruto) {
  if (!bruto || typeof bruto !== 'object') return null;
  const id = Number(bruto.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const tipo = Object.hasOwn(ETIQUETAS_TIPO, bruto.tipo) ? bruto.tipo : null;
  if (!tipo) return null;
  return {
    id,
    tipo,
    titulo: String(bruto.titulo ?? '').slice(0, 200),
    mensaje: String(bruto.mensaje ?? '').slice(0, 500),
    leida: Boolean(bruto.leida),
    creadaEn: String(bruto.creadaEn ?? ''),
  };
}

/**
 * Formatea una fecha ISO como tiempo relativo en español.
 * @param {string} iso - Fecha ISO 8601.
 * @returns {string} Ej. "hace 5 minutos"; cadena vacía si la fecha es inválida.
 */
export function formatearTiempoRelativo(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const segundos = Math.round((fecha.getTime() - Date.now()) / 1000);
  const formato = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const tramos = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unidad, factor] of tramos) {
    if (Math.abs(segundos) >= factor) {
      return formato.format(Math.round(segundos / factor), unidad);
    }
  }
  return formato.format(segundos, 'second');
}

/**
 * Suscribe un callback al evento `notificacion:nueva` de un socket,
 * soportando socket.io (`on/off`) y WebSocket nativo (`message` con JSON
 * `{ evento, datos }`).
 * @param {*} socket - Socket global.
 * @param {(datos:*) => void} alRecibir - Callback con el payload.
 * @returns {() => void} Función para cancelar la suscripción.
 */
function suscribirSocket(socket, alRecibir) {
  if (!socket) return () => {};

  if (typeof socket.on === 'function' && typeof socket.off === 'function') {
    socket.on(EVENTO_NUEVA, alRecibir);
    return () => socket.off(EVENTO_NUEVA, alRecibir);
  }

  if (typeof socket.addEventListener === 'function') {
    const manejador = (evento) => {
      let mensaje;
      try {
        mensaje = JSON.parse(evento.data);
      } catch {
        return; // Mensaje no JSON: se ignora.
      }
      const nombre = mensaje?.evento ?? mensaje?.event;
      if (nombre === EVENTO_NUEVA) {
        alRecibir(mensaje.datos ?? mensaje.data ?? mensaje.payload);
      }
    };
    socket.addEventListener('message', manejador);
    return () => socket.removeEventListener('message', manejador);
  }

  return () => {};
}

/**
 * Lee el token CSRF de `<meta name="csrf-token">` si existe.
 * @returns {string|null} Token o `null`.
 */
function obtenerTokenCsrf() {
  return document.querySelector('meta[name="csrf-token"]')?.content ?? null;
}

/**
 * Realiza una petición a la API con credenciales de sesión y CSRF.
 * @param {string} url - URL destino.
 * @param {RequestInit} [opciones] - Opciones de fetch.
 * @returns {Promise<Object>} Cuerpo JSON de la respuesta.
 * @throws {Error} Si la respuesta no es 2xx o el cuerpo no es JSON válido.
 */
async function solicitarApi(url, opciones = {}) {
  const headers = { Accept: 'application/json', ...(opciones.headers ?? {}) };
  const csrf = obtenerTokenCsrf();
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const respuesta = await fetch(url, {
    credentials: 'same-origin',
    ...opciones,
    headers,
  });
  if (!respuesta.ok) {
    throw new Error(`Error ${respuesta.status} al contactar el servidor.`);
  }
  return respuesta.json();
}

/* 
* Componente
*/

/**
 * Inicializa y monta el componente de notificaciones.
 * @param {OpcionesNotificaciones} opciones - Configuración del componente.
 * @returns {{destruir: () => void, recibir: (datos:*) => void}} API pública.
 * @throws {TypeError} Si `contenedor` no es un elemento DOM.
 */
export function inicializarNotificaciones({
  contenedor,
  socket = globalThis.socket,
  urlApi = URL_API_POR_DEFECTO,
}) {
  if (!(contenedor instanceof HTMLElement)) {
    throw new TypeError('inicializarNotificaciones: "contenedor" debe ser un HTMLElement.');
  }

  /** @type {Notificacion[]} */
  let notificaciones = [];
  let noLeidas = 0;

  /* ---------- Construcción del DOM ---------- */
  const raiz = crearElemento('div', { class: 'notif' });
  const boton = crearElemento('button', {
    type: 'button',
    class: 'notif__boton',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    'aria-controls': 'notif-panel',
    'aria-label': 'Notificaciones',
  });
  const badge = crearElemento('span', { class: 'notif__badge', 'aria-hidden': 'true' });
  badge.hidden = true;
  boton.append(crearIconoCampana(), badge);

  const panel = crearElemento('div', {
    id: 'notif-panel',
    class: 'notif__panel',
    role: 'region',
    'aria-label': 'Panel de notificaciones',
  });
  panel.hidden = true;
  const resumen = crearElemento('span', { class: 'notif__resumen' });
  const encabezado = crearElemento('div', { class: 'notif__encabezado' });
  encabezado.append(crearElemento('span', {}, 'Notificaciones'), resumen);
  const estado = crearElemento('p', { class: 'notif__estado', role: 'status' });
  const lista = crearElemento('ul', { class: 'notif__lista' });
  panel.append(encabezado, estado, lista);

  raiz.append(boton, panel);
  contenedor.appendChild(raiz);

  /* ---------- Renderizado ---------- */

  /**
   * Muestra un mensaje de estado/errores en el panel.
   * @param {string} texto - Mensaje (vacío para limpiar).
   * @param {boolean} [esError=false] - Aplica estilo de error.
   * @returns {void}
   */
  function mostrarEstado(texto, esError = false) {
    estado.textContent = texto;
    estado.classList.toggle('notif__estado--error', esError && Boolean(texto));
  }

  /**
   * Actualiza el badge numérico y los textos accesibles del contador.
   * @param {boolean} [animar=false] - Si debe reproducir la animación de pulso.
   * @returns {void}
   */
  function renderizarContador(animar = false) {
    const visible = noLeidas > 0;
    badge.hidden = !visible;
    badge.textContent = noLeidas > MAX_BADGE ? `${MAX_BADGE}+` : String(noLeidas);
    boton.setAttribute(
      'aria-label',
      visible ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones',
    );
    resumen.textContent = visible ? `${noLeidas} sin leer` : 'Todo al día';
    if (animar && visible) {
      badge.classList.remove('notif__badge--pulso');
      void badge.offsetWidth; // Reinicia la animación.
      badge.classList.add('notif__badge--pulso');
    }
  }

  /**
   * Construye el nodo `<li>` de una notificación.
   * @param {Notificacion} n - Notificación a pintar.
   * @returns {HTMLLIElement} Elemento de lista.
   */
  function crearItem(n) {
    const li = crearElemento('li');
    const clases = ['notif__item', `notif__item--${n.tipo}`];
    if (!n.leida) clases.push('notif__item--no-leida');
    const item = crearElemento('button', {
      type: 'button',
      class: clases.join(' '),
      'data-id': String(n.id),
      'aria-label': `${n.leida ? 'Leída' : 'Sin leer'}: ${n.titulo}`,
    });
    item.append(
      crearElemento('span', { class: 'notif__tipo' }, ETIQUETAS_TIPO[n.tipo]),
      crearElemento('span', { class: 'notif__titulo' }, n.titulo),
      crearElemento('span', { class: 'notif__mensaje' }, n.mensaje),
      crearElemento('span', { class: 'notif__fecha' }, formatearTiempoRelativo(n.creadaEn)),
    );
    li.appendChild(item);
    return li;
  }

  /**
   * Repinta la lista completa de notificaciones.
   * @returns {void}
   */
  function renderizarLista() {
    if (notificaciones.length === 0) {
      lista.replaceChildren(
        crearElemento('li', { class: 'notif__vacio' }, 'No tienes notificaciones.'),
      );
      return;
    }
    lista.replaceChildren(...notificaciones.map(crearItem));
  }

  /* ---------- Lógica ---------- */

  /**
   * Carga el historial desde la API.
   * @returns {Promise<void>}
   */
  async function cargarHistorial() {
    mostrarEstado('Cargando…');
    try {
      const cuerpo = await solicitarApi(urlApi);
      const datos = cuerpo?.datos ?? {};
      notificaciones = (Array.isArray(datos.notificaciones) ? datos.notificaciones : [])
        .map(normalizarNotificacion)
        .filter(Boolean);
      noLeidas = Number.isInteger(datos.noLeidas)
        ? datos.noLeidas
        : notificaciones.filter((n) => !n.leida).length;
      mostrarEstado('');
    } catch {
      mostrarEstado('No se pudieron cargar las notificaciones. Intenta de nuevo.', true);
    }
    renderizarLista();
    renderizarContador();
  }

  /**
   * Procesa una notificación entrante por WebSocket: la antepone al panel
   * e incrementa el contador. Ignora payloads inválidos y duplicados
   * (eventos repetidos tras una reconexión).
   * @param {*} datos - Payload crudo del evento `notificacion:nueva`.
   * @returns {void}
   */
  function recibir(datos) {
    const nueva = normalizarNotificacion(datos);
    if (!nueva || notificaciones.some((n) => n.id === nueva.id)) return;
    notificaciones = [nueva, ...notificaciones];
    if (!nueva.leida) noLeidas += 1;
    renderizarLista();
    renderizarContador(true);
  }

  /**
   * Marca una notificación como leída: actualiza el DOM de inmediato
   * (optimista) y revierte si la API falla.
   * @param {number} id - ID de la notificación.
   * @returns {Promise<void>}
   */
  async function marcarComoLeida(id) {
    const objetivo = notificaciones.find((n) => n.id === id);
    if (!objetivo || objetivo.leida) return;

    objetivo.leida = true;
    noLeidas = Math.max(0, noLeidas - 1);
    renderizarLista();
    renderizarContador();

    try {
      const cuerpo = await solicitarApi(`${urlApi}/${encodeURIComponent(id)}/leida`, {
        method: 'PATCH',
      });
      if (Number.isInteger(cuerpo?.datos?.noLeidas)) {
        noLeidas = cuerpo.datos.noLeidas; // Sincroniza con la fuente de verdad.
        renderizarContador();
      }
      mostrarEstado('');
    } catch {
      objetivo.leida = false; // Reversión.
      noLeidas += 1;
      renderizarLista();
      renderizarContador();
      mostrarEstado('No se pudo marcar como leída. Intenta de nuevo.', true);
    }
  }

  /* ---------- Eventos de UI ---------- */

  /**
   * Abre o cierra el panel.
   * @param {boolean} abrir - Estado deseado.
   * @returns {void}
   */
  function alternarPanel(abrir) {
    panel.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
  }

  const alClickBoton = () => alternarPanel(panel.hidden);

  /** @param {MouseEvent} ev */
  const alClickLista = (ev) => {
    const item = ev.target.closest?.('.notif__item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (!Number.isInteger(id)) return;
    marcarComoLeida(id);
    raiz.dispatchEvent(
      new CustomEvent('notificacion:abrir', { bubbles: true, detail: { id } }),
    );
  };

  /** @param {MouseEvent} ev */
  const alClickDocumento = (ev) => {
    if (!panel.hidden && !raiz.contains(ev.target)) alternarPanel(false);
  };

  /** @param {KeyboardEvent} ev */
  const alTeclado = (ev) => {
    if (ev.key === 'Escape' && !panel.hidden) {
      alternarPanel(false);
      boton.focus();
    }
  };

  boton.addEventListener('click', alClickBoton);
  lista.addEventListener('click', alClickLista);
  document.addEventListener('click', alClickDocumento);
  document.addEventListener('keydown', alTeclado);
  const cancelarSocket = suscribirSocket(socket, recibir);

  cargarHistorial();

  /**
   * Libera listeners y elimina el componente del DOM.
   * @returns {void}
   */
  function destruir() {
    cancelarSocket();
    document.removeEventListener('click', alClickDocumento);
    document.removeEventListener('keydown', alTeclado);
    raiz.remove();
  }

  return { destruir, recibir };
}