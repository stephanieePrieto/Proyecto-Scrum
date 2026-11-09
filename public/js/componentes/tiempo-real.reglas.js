// Responsable: Alfonso - HU-52: reglas puras para decidir entre tiempo real y sondeo cada 5 s
/**
 * @file tiempo-real.reglas.js
 * @description Lógica pura de la HU-52 (criterio 5), sin DOM, sin red y sin localStorage, para probarla con Jest:
 *   - Máquina de estados de la conexión: "conectando" → "tiempo_real" o "limitado".
 *   - Qué hacer al cambiar de estado (iniciar o detener el sondeo, mostrar u ocultar el aviso, sincronizar).
 *   - Cuánto esperar para reabrir la conexión si el servidor la rechaza.
 *   - Cuándo saltar un ciclo de sondeo (arrastre en curso, pestaña oculta, petición pendiente, modal abierto).
 *   - Si un arrastre sigue vivo aunque el navegador no haya avisado que terminó (por ejemplo, al girar la tablet).
 *   - Si los datos del tablero cambiaron, para no repintar sin necesidad.
 */

/** Cada cuánto se consulta el servidor cuando el WebSocket está bloqueado. */
export const INTERVALO_SONDEO_MS = 5000;

/** Intentos fallidos seguidos de WebSocket a partir de los cuales se considera bloqueado. */
export const FALLOS_PARA_LIMITAR = 2;

/** Tiempo sin eventos de arrastre a partir del cual un arrastre se da por terminado. */
export const ARRASTRE_INACTIVO_MS = 1500;

/** Espera inicial y máxima para reabrir la conexión cuando el servidor la rechaza. */
export const REINTENTO_RECHAZO_MIN_MS = 2000;
export const REINTENTO_RECHAZO_MAX_MS = 30000;

/** Estados de la conexión en tiempo real. */
export const MODOS = Object.freeze({
  CONECTANDO: 'conectando',
  TIEMPO_REAL: 'tiempo_real',
  LIMITADO: 'limitado',
});

/** Eventos que puede registrar la conexión. */
export const EVENTOS = Object.freeze({
  CONECTADO: 'conectado',
  ERROR: 'error',
  DESCONECTADO: 'desconectado',
  SIN_CLIENTE: 'sin_cliente',
});

const MODOS_VALIDOS = new Set(Object.values(MODOS));

/** @returns {{modo: string, fallosSeguidos: number}} */
export function estadoInicial() {
  return { modo: MODOS.CONECTANDO, fallosSeguidos: 0 };
}

/**
 * Normaliza un estado recibido; si no es válido, devuelve el inicial.
 * @param {*} estado
 * @returns {{modo: string, fallosSeguidos: number}}
 */
function normalizar(estado) {
  if (!estado || !MODOS_VALIDOS.has(estado.modo)) return estadoInicial();
  const fallos = Number.isInteger(estado.fallosSeguidos) && estado.fallosSeguidos > 0 ? estado.fallosSeguidos : 0;
  return { modo: estado.modo, fallosSeguidos: fallos };
}

/**
 * Calcula el nuevo estado de la conexión tras un evento. No modifica el estado recibido.
 *   - conectado: tiempo real y se reinician los fallos.
 *   - error (incluye tiempo agotado): suma un fallo; con FALLOS_PARA_LIMITAR seguidos pasa a "limitado".
 *   - desconectado: si estaba en tiempo real, vuelve a "conectando" (un corte breve no limita de inmediato).
 *   - sin_cliente: no se pudo cargar el cliente de Socket.io (posible bloqueo); pasa directo a "limitado".
 *
 * @param {*} estado - Estado actual.
 * @param {string} evento - Uno de EVENTOS; cualquier otro deja el estado igual.
 * @returns {{modo: string, fallosSeguidos: number}}
 */
export function registrarEventoConexion(estado, evento) {
  const actual = normalizar(estado);
  switch (evento) {
    case EVENTOS.CONECTADO:
      return { modo: MODOS.TIEMPO_REAL, fallosSeguidos: 0 };
    case EVENTOS.ERROR: {
      const fallosSeguidos = actual.fallosSeguidos + 1;
      const modo = fallosSeguidos >= FALLOS_PARA_LIMITAR || actual.modo === MODOS.LIMITADO ? MODOS.LIMITADO : MODOS.CONECTANDO;
      return { modo, fallosSeguidos };
    }
    case EVENTOS.DESCONECTADO:
      return actual.modo === MODOS.TIEMPO_REAL ? { modo: MODOS.CONECTANDO, fallosSeguidos: 0 } : actual;
    case EVENTOS.SIN_CLIENTE:
      return { modo: MODOS.LIMITADO, fallosSeguidos: Math.max(actual.fallosSeguidos, FALLOS_PARA_LIMITAR) };
    default:
      return actual;
  }
}

/**
 * Espera antes de reabrir la conexión cuando el servidor la rechazó (por ejemplo, con la sesión vencida).
 * En ese caso Socket.io no reintenta por su cuenta. Se duplica con cada fallo seguido, hasta 30 s.
 *
 * @param {number} fallosSeguidos - Fallos seguidos, contando el actual.
 * @returns {number} Milisegundos.
 */
export function esperaTrasRechazo(fallosSeguidos) {
  const fallos = Number.isInteger(fallosSeguidos) && fallosSeguidos > 0 ? fallosSeguidos : 1;
  return Math.min(REINTENTO_RECHAZO_MAX_MS, REINTENTO_RECHAZO_MIN_MS * 2 ** (fallos - 1));
}

/**
 * Indica qué debe hacer la interfaz al pasar de un estado a otro.
 * @param {*} anterior
 * @param {*} nuevo
 * @returns {{iniciarSondeo: boolean, detenerSondeo: boolean, mostrarAviso: boolean, ocultarAviso: boolean, sincronizarUnaVez: boolean}}
 */
export function accionesDeTransicion(anterior, nuevo) {
  const antes = normalizar(anterior).modo;
  const despues = normalizar(nuevo).modo;
  const entraLimitado = antes !== MODOS.LIMITADO && despues === MODOS.LIMITADO;
  const saleLimitado = antes === MODOS.LIMITADO && despues !== MODOS.LIMITADO;
  return {
    iniciarSondeo: entraLimitado,
    detenerSondeo: saleLimitado,
    mostrarAviso: entraLimitado,
    ocultarAviso: saleLimitado,
    // Al recuperar el tiempo real se consulta una vez para no perder lo que cambió mientras tanto
    sincronizarUnaVez: saleLimitado && despues === MODOS.TIEMPO_REAL,
  };
}

/**
 * Indica si un arrastre sigue en curso. El navegador envía eventos "drag" cada pocos cientos de milisegundos
 * mientras se arrastra; si dejan de llegar (por ejemplo, al girar la tablet sin que llegue "dragend"),
 * el arrastre se da por terminado.
 *
 * @param {{activo: boolean, ultimoEvento: number, ahora: number}} datos - Tiempos en milisegundos.
 * @returns {boolean}
 */
export function arrastreVigente({ activo, ultimoEvento, ahora } = {}) {
  if (!activo) return false;
  if (!Number.isFinite(ultimoEvento) || !Number.isFinite(ahora)) return true;
  return ahora - ultimoEvento < ARRASTRE_INACTIVO_MS;
}

/**
 * Decide si se ejecuta un ciclo de sondeo.
 * @param {{modo: string, arrastrando?: boolean, pestanaOculta?: boolean, peticionEnCurso?: boolean, modalAbierto?: boolean}} contexto
 * @returns {{ejecutar: boolean, motivo: string|null}} motivo explica por qué se salta el ciclo.
 */
export function decidirCicloSondeo({ modo, arrastrando = false, pestanaOculta = false, peticionEnCurso = false, modalAbierto = false } = {}) {
  if (modo !== MODOS.LIMITADO) return { ejecutar: false, motivo: 'modo' };
  if (arrastrando) return { ejecutar: false, motivo: 'arrastre' };
  if (modalAbierto) return { ejecutar: false, motivo: 'modal' };
  if (pestanaOculta) return { ejecutar: false, motivo: 'pestana_oculta' };
  if (peticionEnCurso) return { ejecutar: false, motivo: 'peticion_en_curso' };
  return { ejecutar: true, motivo: null };
}

/**
 * Texto que resume lo visible del tablero; si no cambia, no hace falta repintar.
 * No depende del orden en que lleguen las tareas.
 *
 * @param {{columnas?: Object[], tareas?: Object[]}} datos
 * @returns {string}
 */
export function firmaTablero({ columnas = [], tareas = [] } = {}) {
  const lista = (valor) => (Array.isArray(valor) ? valor : []);
  const columnasFirma = lista(columnas)
    .map((c) => [c.id, c.nombre, c.orden, c.limite_wip ?? '', c.wip_duro ?? '', c.es_final ?? ''].join('~'))
    .sort();
  const tareasFirma = lista(tareas)
    .map((t) => [
      t.id, t.version, t.columna_id, t.orden, t.titulo, t.descripcion ?? '', t.responsable_id ?? '', t.responsable ?? '',
      t.bloqueada ? 1 : 0, (Array.isArray(t.etiquetas) ? t.etiquetas : []).join(','), t.horas_reales ?? '',
      t.epica_id ?? '', t.historia_id ?? '',
    ].join('~'))
    .sort();
  return `${columnasFirma.join('|')}#${tareasFirma.join('|')}`;
}

/**
 * Indica si los datos del tablero cambiaron entre dos lecturas.
 * @param {{columnas?: Object[], tareas?: Object[]}} antes
 * @param {{columnas?: Object[], tareas?: Object[]}} despues
 * @returns {boolean}
 */
export function huboCambios(antes, despues) {
  return firmaTablero(antes) !== firmaTablero(despues);
}
