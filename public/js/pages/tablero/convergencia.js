// Responsable: Camila - HU-59: descartar eventos viejos y mantener el mismo estado para todos
/**
 * @file convergencia.js
 * @description Convergencia de estado en tiempo real para el tablero Kanban (HU-59):
 * descarte de eventos duplicados o tardíos por número de versión, reversión de cambios
 * optimistas rechazados por el servidor y resincronización sin recargar la página.
 * @author Camila Mariné Crespo Zurita
 */

import { api } from '../../core/api.js';
import { crearElementoTarjeta, renderizarTarjetasEnTablero } from './tarjeta.js';
import { actualizarContadoresYAlertasWip } from './arrastrar.js';

/**
 * Mapa de la última versión confirmada por tarjeta: tareaId -> version (number).
 * @type {Map<number, number>}
 */
const versionesPorTarjeta = new Map();

/**
 * Mapa del último estado confirmado por el servidor para cada tarjeta: tareaId -> Object.
 * @type {Map<number, Object>}
 */
const estadoServidorPorTarjeta = new Map();

/**
 * Registra el catálogo inicial de tarjetas y sus versiones cuando el tablero carga o se resincroniza.
 * @param {Array<Object>} tareas - Lista de tareas devuelta por el servidor.
 * @returns {void}
 */
export function registrarEstadoInicialTablero(tareas = []) {
    if (!Array.isArray(tareas)) return;

    tareas.forEach((tarea) => {
        const id = Number(tarea.id);
        const version = Number(tarea.version) || 1;
        if (Number.isInteger(id) && id > 0) {
            versionesPorTarjeta.set(id, version);
            estadoServidorPorTarjeta.set(id, { ...tarea, version });

            const elTarjeta = document.getElementById(`tarjeta-${id}`);
            if (elTarjeta) {
                elTarjeta.dataset.version = String(version);
                if (tarea.orden !== undefined && tarea.orden !== null) {
                    elTarjeta.dataset.orden = String(tarea.orden);
                }
            }
        }
    });
}

/**
 * Obtiene la última versión conocida de una tarjeta en el cliente.
 * @param {number|string} tareaId - ID de la tarjeta.
 * @returns {number} Versión actual (mínimo 1).
 */
export function obtenerVersionTarjeta(tareaId) {
    const id = Number(tareaId);
    if (versionesPorTarjeta.has(id)) {
        return versionesPorTarjeta.get(id);
    }
    const elTarjeta = document.getElementById(`tarjeta-${id}`);
    const versionDom = Number(elTarjeta?.dataset?.version);
    return Number.isInteger(versionDom) && versionDom > 0 ? versionDom : 1;
}

/**
 * Obtiene la última copia de datos confirmada por el servidor para una tarjeta.
 * @param {number|string} tareaId
 * @returns {Object|null}
 */
export function obtenerEstadoConfirmadoTarjeta(tareaId) {
    const estado = estadoServidorPorTarjeta.get(Number(tareaId));
    return estado ? { ...estado } : null;
}

/**
 * Actualiza la versión y los datos confirmados de una tarjeta tanto en memoria como en el DOM.
 * @param {number|string} tareaId - ID de la tarjeta.
 * @param {number} nuevaVersion - Número de versión confirmado por el servidor.
 * @param {Object} [datosTarea] - Datos actualizados de la tarjeta.
 * @returns {void}
 */
export function confirmarVersionTarjeta(tareaId, nuevaVersion, datosTarea = null) {
    const id = Number(tareaId);
    const version = Number(nuevaVersion);
    if (!Number.isInteger(id) || id <= 0) return;

    if (Number.isInteger(version) && version > 0) {
        versionesPorTarjeta.set(id, version);
    }

    if (datosTarea && typeof datosTarea === 'object') {
        const previo = estadoServidorPorTarjeta.get(id) || {};
        estadoServidorPorTarjeta.set(id, {
            ...previo,
            ...datosTarea,
            id,
            version: Number.isInteger(version) && version > 0 ? version : (previo.version || 1)
        });
    }

    const elTarjeta = document.getElementById(`tarjeta-${id}`);
    if (elTarjeta && Number.isInteger(version) && version > 0) {
        elTarjeta.dataset.version = String(version);
    }
}

/**
 * Evalúa si un evento entrante en tiempo real debe procesarse o descartarse.
 * Descarta eventos con versión menor o igual a la que ya tiene el cliente (duplicados o tardíos).
 *
 * @param {number|string} tareaId - ID de la tarjeta afectada.
 * @param {number|string} versionEntrante - Versión que trae el evento de Socket.io.
 * @returns {boolean} `true` si el evento es más reciente y debe aplicarse; `false` si debe descartarse.
 */
export function debeProcesarEventoVersion(tareaId, versionEntrante) {
    const id = Number(tareaId);
    const entrante = Number(versionEntrante);

    if (!Number.isInteger(id) || id <= 0) return false;
    // Si el evento no incluye versión explícita, se permite por compatibilidad
    if (!Number.isInteger(entrante) || entrante <= 0) return true;

    const versionLocal = obtenerVersionTarjeta(id);
    if (entrante <= versionLocal) {
        return false; // Evento duplicado o fuera de orden (viejo) descartado
    }

    return true;
}

/**
 * Captura una instantánea del estado y posición actual de una tarjeta en el DOM
 * antes de aplicar un movimiento o edición optimista.
 *
 * @param {number|string} tareaId - ID de la tarjeta.
 * @returns {Object|null} Instantánea para poder revertir en caso de rechazo del servidor.
 */
export function capturarInstantaneaOptimista(tareaId) {
    const id = Number(tareaId);
    const elTarjeta = document.getElementById(`tarjeta-${id}`);
    if (!elTarjeta) return null;

    const columnaEl = elTarjeta.closest('[data-columna-id]');
    const listaPadre = elTarjeta.parentElement;
    const indice = listaPadre ? Array.from(listaPadre.children).indexOf(elTarjeta) : -1;

    return {
        tareaId: id,
        columnaId: columnaEl ? Number(columnaEl.dataset.columnaId) : null,
        indice,
        version: obtenerVersionTarjeta(id),
        datosConfirmados: obtenerEstadoConfirmadoTarjeta(id)
    };
}

/**
 * Inserta una tarjeta dentro de la lista de su columna respetando el orden determinista (orden ASC, id ASC).
 * @param {HTMLElement} listaDestino - Contenedor `#lista-tarjetas-{columnaId}`.
 * @param {HTMLElement} elTarjeta - Nodo DOM de la tarjeta.
 * @param {number|null} [ordenDeseado=null] - Posición u orden indicado por el servidor.
 * @returns {void}
 */
export function insertarTarjetaConOrdenDeterminista(listaDestino, elTarjeta, ordenDeseado = null) {
    if (!listaDestino || !elTarjeta) return;

    const idActual = Number(elTarjeta.dataset.tareaId);
    const ordenActual = ordenDeseado !== null && ordenDeseado !== undefined && Number.isFinite(Number(ordenDeseado))
        ? Number(ordenDeseado)
        : Number(elTarjeta.dataset.orden) || null;

    if (ordenActual !== null) {
        elTarjeta.dataset.orden = String(ordenActual);
    }

    const hermanas = Array.from(listaDestino.children).filter((nodo) => nodo !== elTarjeta);

    if (ordenActual === null || hermanas.length === 0) {
        listaDestino.appendChild(elTarjeta);
        return;
    }

    const nodoReferencia = hermanas.find((hermana) => {
        const ordenHermana = Number(hermana.dataset.orden);
        const idHermana = Number(hermana.dataset.tareaId);
        if (Number.isFinite(ordenHermana) && ordenHermana !== ordenActual) {
            return ordenActual < ordenHermana;
        }
        return idActual < idHermana;
    });

    if (nodoReferencia) {
        listaDestino.insertBefore(elTarjeta, nodoReferencia);
    } else {
        listaDestino.appendChild(elTarjeta);
    }
}

/**
 * Revierte un cambio optimista en la interfaz cuando el servidor rechaza la operación (403, 409, 500)
 * dejando la tarjeta en el estado que decide el servidor o en su posición previa confirmada.
 *
 * @param {Object|null} instantanea - Instantánea capturada con `capturarInstantaneaOptimista`.
 * @param {Object|null} [tareaServidor=null] - Estado autoritativo devuelto por el servidor (si existe).
 * @returns {void}
 */
export function revertirCambioOptimista(instantanea, tareaServidor = null) {
    if (!instantanea && !tareaServidor) return;

    const id = Number(tareaServidor?.id ?? instantanea?.tareaId);
    const datosAutoritativos = tareaServidor || instantanea?.datosConfirmados || null;

    if (datosAutoritativos) {
        confirmarVersionTarjeta(id, datosAutoritativos.version || instantanea?.version || 1, datosAutoritativos);
    }

    const elExistente = document.getElementById(`tarjeta-${id}`);
    const columnaDestinoId = Number(
        tareaServidor?.columna_id ??
        tareaServidor?.columnaId ??
        instantanea?.columnaId
    );
    const listaDestino = document.getElementById(`lista-tarjetas-${columnaDestinoId}`);

    if (datosAutoritativos && listaDestino) {
        const nuevoNodo = crearElementoTarjeta(datosAutoritativos);
        nuevoNodo.dataset.version = String(datosAutoritativos.version || 1);
        if (datosAutoritativos.orden !== undefined) {
            nuevoNodo.dataset.orden = String(datosAutoritativos.orden);
        }

        if (elExistente && elExistente.parentElement === listaDestino && instantanea?.indice >= 0 && !tareaServidor) {
            elExistente.replaceWith(nuevoNodo);
        } else {
            elExistente?.remove();
            if (!tareaServidor && instantanea?.indice >= 0 && instantanea.indice < listaDestino.children.length) {
                listaDestino.insertBefore(nuevoNodo, listaDestino.children[instantanea.indice]);
            } else {
                insertarTarjetaConOrdenDeterminista(listaDestino, nuevoNodo, datosAutoritativos.orden);
            }
        }
    } else if (elExistente && listaDestino) {
        if (instantanea?.indice >= 0 && instantanea.indice < listaDestino.children.length) {
            listaDestino.insertBefore(elExistente, listaDestino.children[instantanea.indice]);
        } else {
            listaDestino.appendChild(elExistente);
        }
    }

    actualizarContadoresYAlertasWip();
}

/**
 * Procesa cualquier evento entrante de Socket.io sobre una tarjeta garantizando convergencia:
 * si el evento es duplicado o más antiguo que el estado local se ignora; si es más nuevo,
 * actualiza el DOM y sincroniza su posición y versión.
 *
 * @param {Object} evento - Datos del evento recibido por WebSocket.
 * @returns {boolean} `true` si se aplicó el evento; `false` si fue descartado por versión antigua.
 */
export function aplicarEventoTarjetaConvergente(evento = {}) {
    const tareaId = Number(evento.tareaId ?? evento.id ?? evento.tarea?.id);
    const versionEntrante = Number(evento.version ?? evento.tarea?.version);

    if (!debeProcesarEventoVersion(tareaId, versionEntrante)) {
        return false;
    }

    const datosTarea = evento.tarea && typeof evento.tarea === 'object'
        ? evento.tarea
        : {
            ...(obtenerEstadoConfirmadoTarjeta(tareaId) || {}),
            id: tareaId,
            ...(evento.nuevaColumnaId || evento.columnaId
                ? { columna_id: Number(evento.nuevaColumnaId ?? evento.columnaId) }
                : {}),
            ...(evento.orden !== undefined ? { orden: Number(evento.orden) } : {}),
            ...(evento.bloqueada !== undefined ? { bloqueada: Boolean(evento.bloqueada) } : {}),
            ...(evento.motivoBloqueo !== undefined ? { motivo_bloqueo: evento.motivoBloqueo } : {}),
            ...(Number.isInteger(versionEntrante) && versionEntrante > 0 ? { version: versionEntrante } : {})
        };

    confirmarVersionTarjeta(tareaId, versionEntrante || obtenerVersionTarjeta(tareaId), datosTarea);

    const columnaDestinoId = Number(
        datosTarea.columna_id ??
        datosTarea.columnaId ??
        evento.nuevaColumnaId ??
        evento.columnaId
    );
    const listaDestino = document.getElementById(`lista-tarjetas-${columnaDestinoId}`);
    const elActual = document.getElementById(`tarjeta-${tareaId}`);

    if (evento.tarea && listaDestino) {
        const nuevoNodo = crearElementoTarjeta(datosTarea);
        nuevoNodo.dataset.version = String(datosTarea.version || versionEntrante || 1);
        if (datosTarea.orden !== undefined) {
            nuevoNodo.dataset.orden = String(datosTarea.orden);
        }

        if (elActual && elActual.parentElement === listaDestino && evento.orden === undefined) {
            elActual.replaceWith(nuevoNodo);
        } else {
            elActual?.remove();
            insertarTarjetaConOrdenDeterminista(listaDestino, nuevoNodo, datosTarea.orden);
        }
    } else if (elActual && listaDestino) {
        elActual.dataset.version = String(versionEntrante || obtenerVersionTarjeta(tareaId));
        insertarTarjetaConOrdenDeterminista(listaDestino, elActual, datosTarea.orden);
    }

    actualizarContadoresYAlertasWip();
    return true;
}

/**
 * Resincroniza el estado completo del tablero desde el servidor sin recargar la página (HU-59).
 * @param {number|string} proyectoId - ID del proyecto activo.
 * @returns {Promise<boolean>} `true` si convergió correctamente.
 */
export async function resincronizarTableroSinRecargar(proyectoId) {
    if (!proyectoId || proyectoId === 'null') return false;

    try {
        const respuesta = await api(`/tablero/${proyectoId}`);
        const datos = respuesta?.data || respuesta?.datos;
        if (!datos || !Array.isArray(datos.tareas)) return false;

        // Ordenar de forma determinista (orden ASC, id ASC) para que todos los clientes vean el mismo estado
        const tareasOrdenadas = [...datos.tareas].sort((a, b) => {
            const ordenA = Number(a.orden) || 0;
            const ordenB = Number(b.orden) || 0;
            if (ordenA !== ordenB) return ordenA - ordenB;
            return Number(a.id) - Number(b.id);
        });

        registrarEstadoInicialTablero(tareasOrdenadas);
        renderizarTarjetasEnTablero(tareasOrdenadas);
        actualizarContadoresYAlertasWip();

        return true;
    } catch (error) {
        console.error('[HU-59] No se pudo resincronizar el tablero:', error);
        return false;
    }
}