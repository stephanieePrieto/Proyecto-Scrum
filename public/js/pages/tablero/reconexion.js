/**
 * @file reconexion.js
 * @description Gestión de eventos WebSockets, avisos visuales de red, cola local offline y resincronización (HU-18, HU-58).
 * @author Camila Mariné Crespo Zurita
 */

import * as socketModule from '../../core/socket.js';
import { api } from '../../core/api.js';
const socket = socketModule.socket || socketModule.default || window.socket;

/**
 * Sincroniza la cola local de movimientos pendientes con el servidor al recuperar la red (HU-58).
 * 
 * @function sincronizarMovimientosPendientes
 * @param {number|string} proyectoId - ID del proyecto activo.
 * @returns {Promise<void>}
 */
async function sincronizarMovimientosPendientes(proyectoId) {
    const colaGuardada = JSON.parse(localStorage.getItem('movimientos_pendientes') || '[]');
    // Una sola petición por tarjeta: se conserva el último movimiento de cada una
    const cola = [...new Map(colaGuardada.map((m) => [Number(m.tareaId), m])).values()];
    if (cola.length === 0) return;

    const estadoRed = document.getElementById('sprint-estado');
    if (estadoRed) {
        estadoRed.textContent = `Sincronizando ${cola.length} cambios...`;
        estadoRed.className = 'insignia-estado rounded-full bg-indigo-100 text-indigo-700 px-2 py-0.5 text-xs font-medium animate-pulse';
    }

    const pendientesActualizados = [];

    for (const movimiento of cola) {
        try {
            // api() agrega el token CSRF; lanza error si la respuesta no es 2xx
            await api('/tablero/mover-tarjeta', { metodo: 'POST', cuerpo: movimiento });
        } catch (error) {
            console.error("Error al sincronizar movimiento pendiente:", error);
            pendientesActualizados.push(movimiento);
        }
    }

    localStorage.setItem('movimientos_pendientes', JSON.stringify(pendientesActualizados));

    if (estadoRed) {
        if (pendientesActualizados.length === 0) {
            estadoRed.textContent = 'Activo - Sincronizado';
            estadoRed.className = 'insignia-estado rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium';
            setTimeout(() => {
                estadoRed.textContent = 'Activo';
            }, 3000);
        } else {
            estadoRed.textContent = `Pendientes: ${pendientesActualizados.length}`;
            estadoRed.className = 'insignia-estado rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium';
        }
    }
}

/**
 * Escucha la llegada de actualizaciones remotas por Socket.io y gestiona la insignia de conectividad.
 * 
 * @function escucharMovimientosSocket
 * @param {number|string} [proyectoId] - ID del proyecto activo para la resincronización.
 * @returns {void}
 */
export function escucharMovimientosSocket(proyectoId) {
    if (socket) {
        socket.on('tablero:tarjeta_movida', (data) => {
            const elTarjeta = document.getElementById(`tarjeta-${data.tareaId}`);
            const elListaDestino = document.getElementById(`lista-tarjetas-${data.columnaId}`);

            if (elTarjeta && elListaDestino) {
                elListaDestino.appendChild(elTarjeta);

                const aviso = document.createElement('div');
                aviso.className = 'text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded shadow absolute -top-2 right-2 z-10 animate-bounce';
                aviso.textContent = `${data.usuarioNombre} la movió`;
                elTarjeta.appendChild(aviso);

                setTimeout(() => aviso.remove(), 2500);
            }
        });

        socket.on('disconnect', () => {
            const estadoRed = document.getElementById('sprint-estado');
            if (estadoRed) {
                estadoRed.textContent = 'Sin conexión - Pendiente de sincronizar';
                estadoRed.className = 'insignia-estado rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium';
            }
        });

        socket.on('connect', async () => {
            const estadoRed = document.getElementById('sprint-estado');
            if (estadoRed) {
                estadoRed.textContent = 'Activo';
                estadoRed.className = 'insignia-estado rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium';
            }
            if (proyectoId) {
                await sincronizarMovimientosPendientes(proyectoId);
            }
        });
    }

    // Escuchadores nativos de red del navegador (HU-58)
    window.addEventListener('offline', () => {
        const estadoRed = document.getElementById('sprint-estado');
        if (estadoRed) {
            estadoRed.textContent = 'Sin conexión de red';
            estadoRed.className = 'insignia-estado rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium';
        }
    });

    window.addEventListener('online', async () => {
        const estadoRed = document.getElementById('sprint-estado');
        if (estadoRed) {
            estadoRed.textContent = 'Red restablecida';
            estadoRed.className = 'insignia-estado rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium';
        }
        if (proyectoId) {
            await sincronizarMovimientosPendientes(proyectoId);
        }
    });
}