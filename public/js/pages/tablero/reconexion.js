/**
 * @file reconexion.js
 * @description Gestión de eventos WebSockets en cliente y avisos visuales ante desconexiones de red (HU-18).
 * @author Camila Mariné Crespo Zurita
 */

import { socket } from '../../core/socket.js';

/**
 * Escucha la llegada de actualizaciones remotas por Socket.io y gestiona la insignia de conectividad.
 * 
 * @function escucharMovimientosSocket
 * @returns {void}
 */
export function escucharMovimientosSocket() {
    if (!socket) return;

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

    socket.on('connect', () => {
        const estadoRed = document.getElementById('sprint-estado');
        if (estadoRed) {
            estadoRed.textContent = 'Activo';
            estadoRed.className = 'insignia-estado rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-medium';
        }
    });
}