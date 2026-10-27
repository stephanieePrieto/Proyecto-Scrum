// Responsable: Alfonso - HU-24: campana, contador y lista de notificaciones
/**
 * @file notificaciones.js
 * @description Componente de notificaciones de ScrumFlow (HU-24).
 *
 * - Renderiza una campana con badge de no leídas y un panel desplegable.
 * - Recibe notificaciones nuevas por WebSocket (`notificacion:nueva`) y, si no hay
 *   socket disponible, consulta la API cada 15 s (degradación elegante, RNF-11).
 * - Avisa con un toast cuando llega una notificación nueva.
 * - Marca como leída vía `PATCH /api/notificaciones/:id/leida` (o todas con `/leidas`)
 *   con actualización optimista del DOM y reversión si el servidor falla.
 * - Al abrir una notificación navega a su `enlace` (solo rutas internas).
 * - Es idempotente: si el contenedor ya tiene una campana, devuelve la existente.
 *
 * SEGURIDAD: todo el contenido dinámico se inserta con `textContent`
 * (nunca `innerHTML`), por lo que un mensaje con `<script>` se muestra
 * como texto inerte (mitigación XSS, RNF-14).
 *
 * @example
 * import { inicializarNotificaciones } from './componentes/notificaciones.js';
 * const notif = inicializarNotificaciones({
 *   contenedor: document.querySelector('#notificaciones-root'),
 * });
 * // notif.destruir() al cerrar sesión.
 */

/** @constant {string} Nombre del evento de WebSocket emitido por el servidor. */
const EVENTO_NUEVA = 'notificacion:nueva';

/** @constant {string} URL base de la API de notificaciones. */
const URL_API_POR_DEFECTO = '/api/notificaciones';

/** @constant {number} Máximo numérico mostrado en el badge antes de "99+". */
const MAX_BADGE = 99;

/** @constant {number} Cada cuántos ms se consulta la API cuando no hay socket. */
const INTERVALO_SONDEO_MS = 15000;

/** @constant {number} Notificaciones pedidas al servidor en cada consulta. */
const LIMITE_HISTORIAL = 30;

/** @constant {number} Duración (ms) de cada toast. */
const DURACION_TOAST_MS = 5000;

/** @constant {number} Máximo de toasts individuales; si llegan más se muestra un resumen. */
const MAX_TOASTS = 3;

/** @constant {Object<string,string>} Etiquetas legibles por tipo (lista blanca). */
const ETIQUETAS_TIPO = Object.freeze({
  asignacion: 'Asignación',
  mencion: 'Mención',
});

/** Solo se permiten enlaces internos ("/pages/tablero.html"); nunca "//sitio" ni "javascript:". */
const PATRON_ENLACE = /^\/(?![\\/])[\w\-./?=&#%]*$/;

/** Evita montar dos campanas en el mismo contenedor. */
const instancias = new WeakMap();

/**
 * @typedef {Object} Notificacion
 * @property {number} id
 * @property {'asignacion'|'mencion'} tipo
 * @property {string} titulo
 * @property {string} mensaje
 * @property {string|null} enlace - Ruta interna a la que lleva la notificación.
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
  const enlace = typeof bruto.enlace === 'string' && PATRON_ENLACE.test(bruto.enlace.trim())
    ? bruto.enlace.trim()
    : null;
  return {
    id,
    tipo,
    titulo: String(bruto.titulo || ETIQUETAS_TIPO[tipo]).slice(0, 200),
    mensaje: String(bruto.mensaje ?? '').slice(0, 500),
    enlace,
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
  if (Math.abs(segundos) < 45) return 'ahora mismo';
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

/**
 * Muestra un aviso emergente (toast) en la esquina inferior derecha.
 * Reutiliza el contenedor `#contenedor-toasts` si otra parte de la app ya lo creó.
 * @param {string} titulo - Texto destacado.
 * @param {string} [mensaje] - Texto secundario.
 * @returns {void}
 */
function mostrarToast(titulo, mensaje = '') {
  let contenedor = document.getElementById('contenedor-toasts');
  if (!contenedor) {
    contenedor = crearElemento('div', {
      id: 'contenedor-toasts',
      role: 'status',
      'aria-live': 'polite',
    });
    document.body.appendChild(contenedor);
  }
  const toast = crearElemento('div', { class: 'toast toast--notif' });
  toast.append(crearElemento('strong', { class: 'toast__titulo' }, titulo));
  if (mensaje) toast.append(crearElemento('span', { class: 'toast__mensaje' }, mensaje));
  contenedor.appendChild(toast);
  setTimeout(() => toast.remove(), DURACION_TOAST_MS);
}

/*
 * Componente
 */

/**
 * Inicializa y monta el componente de notificaciones.
 * Si el contenedor ya tiene una campana, devuelve la instancia existente.
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
  const existente = instancias.get(contenedor);
  if (existente) return existente;

  /** @type {Notificacion[]} */
  let notificaciones = [];
  let noLeidas = 0;
  let primeraCargaLista = false;
  let pendientes = 0; // Operaciones "marcar como leída" aún en curso contra el servidor
  let generacion = 0; // Sube con cada cambio local; sirve para descartar respuestas de sondeo obsoletas

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
  const botonTodas = crearElemento('button', {
    type: 'button',
    class: 'notif__marcar-todas',
  }, 'Marcar todas como leídas');
  botonTodas.hidden = true;
  const encabezado = crearElemento('div', { class: 'notif__encabezado' });
  const titulos = crearElemento('div', { class: 'notif__titulos' });
  titulos.append(crearElemento('span', { class: 'notif__encabezado-texto' }, 'Notificaciones'), resumen);
  encabezado.append(titulos, botonTodas);
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
    botonTodas.hidden = !visible;
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
   * Pide al servidor el historial reciente.
   * @returns {Promise<{lista: Notificacion[], noLeidas: number}>}
   * @throws {Error} Si la petición falla.
   */
  async function consultarServidor() {
    const cuerpo = await solicitarApi(`${urlApi}?limite=${LIMITE_HISTORIAL}`);
    const datos = cuerpo?.datos ?? {};
    const recibidas = (Array.isArray(datos.notificaciones) ? datos.notificaciones : [])
      .map(normalizarNotificacion)
      .filter(Boolean);
    const sinLeer = Number.isInteger(datos.noLeidas)
      ? datos.noLeidas
      : recibidas.filter((n) => !n.leida).length;
    return { lista: recibidas, noLeidas: sinLeer };
  }

  /**
   * Carga inicial del historial (muestra "Cargando…" y los errores en el panel).
   * @returns {Promise<void>}
   */
  async function cargarHistorial() {
    mostrarEstado('Cargando…');
    try {
      const resultado = await consultarServidor();
      notificaciones = resultado.lista;
      noLeidas = resultado.noLeidas;
      primeraCargaLista = true;
      mostrarEstado('');
    } catch {
      mostrarEstado('No se pudieron cargar las notificaciones. Intenta de nuevo.', true);
    }
    renderizarLista();
    renderizarContador();
  }

  /**
   * Avisa al usuario de notificaciones nuevas: pulso del badge y toast.
   * @param {Notificacion[]} nuevas - Notificaciones recién llegadas y sin leer.
   * @returns {void}
   */
  function avisarNuevas(nuevas) {
    if (nuevas.length === 0) return;
    renderizarContador(true);
    if (nuevas.length > MAX_TOASTS) {
      mostrarToast(`Tienes ${nuevas.length} notificaciones nuevas`, 'Abre la campana para verlas.');
      return;
    }
    for (const n of nuevas) mostrarToast(n.titulo, n.mensaje);
  }

  /**
   * Sincroniza con el servidor en segundo plano (sondeo). Los errores no se muestran:
   * se conserva lo que ya hay en pantalla y se reintenta en el siguiente ciclo.
   * @returns {Promise<void>}
   */
  async function sincronizar() {
    if (!primeraCargaLista) {
      await cargarHistorial();
      return;
    }
    if (pendientes > 0) return; // Hay una lectura en curso: esperar al siguiente ciclo
    const generacionInicial = generacion;
    try {
      const resultado = await consultarServidor();
      // Descartar la respuesta si el usuario cambió algo mientras llegaba
      if (pendientes > 0 || generacionInicial !== generacion) return;
      const conocidas = new Set(notificaciones.map((n) => n.id));
      const nuevas = resultado.lista.filter((n) => !conocidas.has(n.id) && !n.leida);
      notificaciones = resultado.lista;
      noLeidas = resultado.noLeidas;
      mostrarEstado('');
      renderizarLista();
      renderizarContador();
      avisarNuevas(nuevas);
    } catch {
      /* Sin conexión momentánea: se reintenta en el próximo ciclo. */
    }
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
    renderizarContador();
    if (!nueva.leida) avisarNuevas([nueva]);
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
    pendientes += 1;
    generacion += 1;
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
    } finally {
      pendientes -= 1;
      generacion += 1;
    }
  }

  /**
   * Marca todas las notificaciones como leídas (optimista, con reversión si falla).
   * @returns {Promise<void>}
   */
  async function marcarTodasComoLeidas() {
    const porMarcar = notificaciones.filter((n) => !n.leida);
    if (porMarcar.length === 0 && noLeidas === 0) return;

    const noLeidasAntes = noLeidas;
    for (const n of porMarcar) n.leida = true;
    noLeidas = 0;
    pendientes += 1;
    generacion += 1;
    renderizarLista();
    renderizarContador();

    try {
      await solicitarApi(`${urlApi}/leidas`, { method: 'PATCH' });
      mostrarEstado('');
    } catch {
      for (const n of porMarcar) n.leida = false; // Reversión.
      noLeidas = noLeidasAntes;
      renderizarLista();
      renderizarContador();
      mostrarEstado('No se pudieron marcar como leídas. Intenta de nuevo.', true);
    } finally {
      pendientes -= 1;
      generacion += 1;
    }
  }

  /* ---------- Eventos de UI ---------- */

  /**
   * Abre o cierra el panel. Al abrir refresca los datos del servidor.
   * @param {boolean} abrir - Estado deseado.
   * @returns {void}
   */
  function alternarPanel(abrir) {
    panel.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    if (abrir) {
      ajustarPosicionPanel();
      renderizarLista(); // Refresca los "hace X minutos"
      sincronizar();
    }
  }

  /**
   * Mantiene el panel dentro de la pantalla (útil en móvil, donde la campana
   * no está pegada al borde derecho).
   * @returns {void}
   */
  function ajustarPosicionPanel() {
    const margen = 12;
    panel.style.right = '0px';
    const caja = panel.getBoundingClientRect();
    if (caja.left < margen) {
      panel.style.right = `${caja.left - margen}px`; // Valor negativo: desplaza a la derecha
    } else if (caja.right > window.innerWidth - margen) {
      panel.style.right = `${caja.right - (window.innerWidth - margen)}px`;
    }
  }

  /** Reacomoda el panel si cambia el tamaño de la ventana mientras está abierto. */
  const alRedimensionar = () => {
    if (!panel.hidden) ajustarPosicionPanel();
  };

  const alClickBoton = () => alternarPanel(panel.hidden);

  /** @param {MouseEvent} ev */
  const alClickLista = async (ev) => {
    const item = ev.target.closest?.('.notif__item');
    if (!item) return;
    const id = Number(item.dataset.id);
    if (!Number.isInteger(id)) return;

    const notificacion = notificaciones.find((n) => n.id === id);
    const destino = notificacion?.enlace;

    // Esperar a que el servidor registre la lectura antes de cambiar de página
    await marcarComoLeida(id);
    raiz.dispatchEvent(
      new CustomEvent('notificacion:abrir', { bubbles: true, detail: { id } }),
    );
    if (destino && destino !== location.pathname) location.assign(destino);
    else alternarPanel(false);
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

  /** Cada ciclo: sondea la API si no hay socket; con socket solo refresca los textos de tiempo. */
  const alCiclo = () => {
    if (!raiz.isConnected) { // La barra se volvió a dibujar: esta campana quedó huérfana
      destruir();
      return;
    }
    if (document.hidden) return;
    if (socket) {
      if (!panel.hidden) renderizarLista();
    } else {
      sincronizar();
    }
  };

  /** Al volver a la pestaña, ponerse al día de inmediato. */
  const alCambiarVisibilidad = () => {
    if (!document.hidden) alCiclo();
  };

  boton.addEventListener('click', alClickBoton);
  botonTodas.addEventListener('click', marcarTodasComoLeidas);
  lista.addEventListener('click', alClickLista);
  document.addEventListener('click', alClickDocumento);
  document.addEventListener('keydown', alTeclado);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('resize', alRedimensionar);
  const cancelarSocket = suscribirSocket(socket, recibir);
  const temporizador = setInterval(alCiclo, INTERVALO_SONDEO_MS);

  cargarHistorial();

  /**
   * Libera listeners y elimina el componente del DOM.
   * @returns {void}
   */
  function destruir() {
    cancelarSocket();
    clearInterval(temporizador);
    document.removeEventListener('click', alClickDocumento);
    document.removeEventListener('keydown', alTeclado);
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    window.removeEventListener('resize', alRedimensionar);
    instancias.delete(contenedor);
    raiz.remove();
  }

  const api = { destruir, recibir };
  instancias.set(contenedor, api);
  return api;
}