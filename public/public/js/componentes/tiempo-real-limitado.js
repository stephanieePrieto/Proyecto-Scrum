/**
 * @file tiempo-real-limitado.js
 * @description Abre la conexión de Socket.io del tablero solo por WebSocket y, si un proxy o firewall la
 * bloquea, cambia a sondeo periódico cada 5 s con el aviso "Tiempo real limitado" (HU-52, criterio 5).
 * Mientras está limitado sigue reintentando el WebSocket; al recuperarlo deja de sondear y sincroniza una vez.
 * Las decisiones están en tiempo-real.reglas.js (lógica pura con pruebas).
 * 
 * @author Alfonso Mendoza Vasquez
 */

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

const REINTENTO_SINCRONIZACION_MS = 1000;

/**
 * Obtiene la conexión ya existente en window.socket o crea una nueva con window.io.
 * @returns {Object|null} Socket de Socket.io, o null si el cliente no se pudo cargar.
 */
function crearSocket() {
  if (window.socket) return window.socket;
  if (typeof window.io !== 'function') return null;
  try {
    return window.io(opcionesSocket());
  } catch (error) {
    console.error('[HU-52] No se pudo crear la conexión en tiempo real:', error);
    return null;
  }
}

export const socketTiempoReal = crearSocket();
if (socketTiempoReal && !window.socket) window.socket = socketTiempoReal;

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

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && estado.modo === MODOS.LIMITADO) ejecutarSondeo();
  });

  const socket = socketTiempoReal;
  if (!socket || typeof socket.on !== 'function') {
    registrar(EVENTOS.SIN_CLIENTE);
    return { obtenerModo: () => estado.modo };
  }

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
