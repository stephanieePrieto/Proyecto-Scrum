// Responsable: Alfonso - HU-52: conexión en tiempo real del tablero y sondeo cada 5 s si el WebSocket está bloqueado
/**
 * @file tiempo-real-limitado.js
 * @description Abre la conexión de Socket.io del tablero solo por WebSocket y, si un proxy o firewall la
 * bloquea, cambia a sondeo periódico cada 5 s con el aviso "Tiempo real limitado" (HU-52, criterio 5).
 * Mientras está limitado sigue reintentando el WebSocket; al recuperarlo deja de sondear y sincroniza una vez.
 * Las decisiones están en tiempo-real.reglas.js (lógica pura con pruebas).
 *
 * Conexión: core/socket.js (BASE, HU-47) todavía no exporta una conexión compartida. Si algún día lo hace, este
 * módulo la usa; mientras tanto crea la del tablero, igual que hacen las demás pantallas por su cuenta. Se crea
 * al importar el módulo y se publica en window.socket porque reconexion.js la toma al cargarse y arrastrar.js
 * la lee de window.socket; por eso tablero.js importa este módulo antes que los demás. El cliente de Socket.io
 * (/socket.io/socket.io.js) lo carga tablero.html como script clásico, antes de los módulos.
 */

import * as socketBase from '../core/socket.js';
import {
  MODOS,
  EVENTOS,
  INTERVALO_SONDEO_MS,
  estadoInicial,
  registrarEventoConexion,
  esperaTrasRechazo,
  accionesDeTransicion,
  decidirCicloSondeo,
} from './tiempo-real.reglas.js';

/**
 * Opciones de la conexión. Solo WebSocket: si está bloqueado se detecta como error y se usa el sondeo propio
 * cada 5 s. Se devuelve un objeto nuevo en cada llamada y sin congelar, porque el cliente de Socket.io le agrega
 * propiedades (path, query...) y con un objeto congelado lanza "Cannot add property path".
 * @returns {Object}
 */
function opcionesSocket() {
  return {
    transports: ['websocket'],
    withCredentials: true,
    autoConnect: false,
    timeout: 8000,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
  };
}

/** Espera antes de reintentar una sincronización que se saltó (por ejemplo, durante un arrastre). */
const REINTENTO_SINCRONIZACION_MS = 1000;

/**
 * Obtiene la conexión: la compartida de core/socket.js si existe, la que ya esté en window.socket o una nueva.
 * @returns {Object|null} Socket de Socket.io, o null si el cliente no se pudo cargar.
 */
function crearSocket() {
  const compartido = socketBase.socket || socketBase.default || window.socket;
  if (compartido) return compartido;
  if (typeof window.io !== 'function') return null;
  try {
    return window.io(opcionesSocket());
  } catch (error) {
    console.error('[HU-52] No se pudo crear la conexión en tiempo real:', error);
    return null;
  }
}

/** Conexión del tablero (null si el cliente de Socket.io no cargó, por ejemplo por un bloqueo). */
export const socketTiempoReal = crearSocket();
if (socketTiempoReal && !window.socket) window.socket = socketTiempoReal;

/**
 * Inicia la vigilancia de la conexión y el sondeo de respaldo.
 *
 * @param {Object} opciones
 * @param {number|string} opciones.proyectoId - Proyecto cuya sala se sigue.
 * @param {() => Promise<*>} opciones.sondear - Consulta el servidor y actualiza la pantalla.
 * @param {() => {arrastrando?: boolean, modalAbierto?: boolean}} [opciones.obtenerContexto] - Si conviene saltar un ciclo.
 * @param {HTMLElement|null} [opciones.contenedorAviso] - Dónde mostrar el aviso de tiempo real limitado.
 * @returns {{obtenerModo: () => string}}
 */
export function iniciarTiempoReal({ proyectoId, sondear, obtenerContexto = () => ({}), contenedorAviso = null }) {
  let estado = estadoInicial();
  let temporizador = null;
  let peticionEnCurso = false;
  let aviso = null;

  function mostrarAvisoLimitado() {
    if (!aviso) {
      aviso = document.createElement('span');
      aviso.id = 'aviso-tiempo-real';
      aviso.className = 'insignia insignia--advertencia';
      aviso.setAttribute('role', 'status');
      aviso.title = 'No se pudo abrir la conexión en tiempo real (WebSocket), posiblemente por un proxy o firewall. '
        + 'El tablero se actualiza cada 5 segundos.';
      aviso.textContent = 'Tiempo real limitado · se actualiza cada 5 s';
    }
    (contenedorAviso || document.body).append(aviso);
  }

  function ocultarAvisoLimitado() {
    aviso?.remove();
  }

  /**
   * Ejecuta un sondeo si las reglas lo permiten.
   * @param {{forzar?: boolean}} [opciones] - forzar: sincronizar aunque ya no esté en modo limitado.
   * @returns {Promise<void>}
   */
  async function ejecutarSondeo({ forzar = false } = {}) {
    const contexto = obtenerContexto() || {};
    const decision = decidirCicloSondeo({
      modo: forzar ? MODOS.LIMITADO : estado.modo,
      arrastrando: Boolean(contexto.arrastrando),
      modalAbierto: Boolean(contexto.modalAbierto),
      pestanaOculta: document.hidden,
      peticionEnCurso,
    });
    if (!decision.ejecutar) {
      if (forzar && decision.motivo !== 'pestana_oculta') {
        setTimeout(() => ejecutarSondeo({ forzar: true }), REINTENTO_SINCRONIZACION_MS);
      }
      return;
    }
    peticionEnCurso = true;
    try {
      await sondear();
    } catch (error) {
      console.error('[HU-52] No se pudo actualizar el tablero por sondeo:', error);
    } finally {
      peticionEnCurso = false;
    }
  }

  function programarSondeo(espera = INTERVALO_SONDEO_MS) {
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      if (estado.modo !== MODOS.LIMITADO) return;
      await ejecutarSondeo();
      if (estado.modo === MODOS.LIMITADO) programarSondeo();
    }, espera);
  }

  function detenerSondeo() {
    clearTimeout(temporizador);
    temporizador = null;
  }

  /**
   * Aplica un evento de la conexión y ejecuta lo que corresponda al cambio de estado.
   * @param {string} evento - Uno de EVENTOS.
   */
  function registrar(evento) {
    const anterior = estado;
    estado = registrarEventoConexion(estado, evento);
    const acciones = accionesDeTransicion(anterior, estado);
    if (acciones.mostrarAviso) mostrarAvisoLimitado();
    if (acciones.ocultarAviso) ocultarAvisoLimitado();
    if (acciones.iniciarSondeo) programarSondeo(0);
    if (acciones.detenerSondeo) detenerSondeo();
    if (acciones.sincronizarUnaVez) ejecutarSondeo({ forzar: true });
  }

  // Al volver a la pestaña con el tiempo real limitado, se actualiza de inmediato
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && estado.modo === MODOS.LIMITADO) ejecutarSondeo();
  });

  const socket = socketTiempoReal;
  if (!socket || typeof socket.on !== 'function') {
    registrar(EVENTOS.SIN_CLIENTE);
    return { obtenerModo: () => estado.modo };
  }

  /**
   * Si el servidor rechazó la conexión (por ejemplo, con la sesión vencida) o la cerró él, Socket.io no reintenta
   * por su cuenta: se reabre aquí con espera creciente. Entretanto, con dos fallos ya se sondea cada 5 s.
   */
  let reintento = null;
  function reintentarSiNoLoHaceSocketIo() {
    if (socket.active) return;
    clearTimeout(reintento);
    reintento = setTimeout(() => {
      if (!socket.connected && !socket.active) socket.connect();
    }, esperaTrasRechazo(estado.fallosSeguidos));
  }

  const unirse = () => socket.emit('unirse_proyecto', Number(proyectoId));
  socket.on('connect', () => {
    clearTimeout(reintento);
    unirse();
    registrar(EVENTOS.CONECTADO);
  });
  socket.on('connect_error', () => {
    registrar(EVENTOS.ERROR);
    reintentarSiNoLoHaceSocketIo();
  });
  socket.on('disconnect', (motivo) => {
    registrar(EVENTOS.DESCONECTADO);
    if (motivo === 'io server disconnect') reintentarSiNoLoHaceSocketIo();
  });

  if (socket.connected) {
    unirse();
    registrar(EVENTOS.CONECTADO);
  } else if (typeof socket.connect === 'function') {
    socket.connect();
  }

  return { obtenerModo: () => estado.modo };
}
