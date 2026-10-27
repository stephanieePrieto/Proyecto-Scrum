/**
 * @fileoverview Lógica de la pantalla del tablero del sprint (HU-17 a HU-25, HU-58, HU-59).
 * Se arma con los módulos de tablero y maneja la comunicación inicial y filtros.
 * @author Camila
 * @see {@link module:tablero/columnas}
 */

import { inicializarTablero, cargarTablero } from './tablero/columnas.js';
import { montarBarraSuperior } from '../core/layout.js';

/**
 * Listener principal que se ejecuta una vez que el DOM ha sido completamente cargado.
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
    /**
     * 1. Inyecta la barra de navegación superior en la interfaz.
     */
    if (typeof montarBarraSuperior === 'function') {
        montarBarraSuperior();
    }

    /**
     * 2. Inicia la carga de las columnas y tarjetas correspondientes al sprint activo.
     */
    inicializarTablero();

    /**
     * 3. Configura los escuchadores de eventos para los botones de acción del encabezado.
     */
    const btnNuevaTarea = document.getElementById('btn-nueva-tarea');
    if (btnNuevaTarea) {
        btnNuevaTarea.addEventListener('click', () => {
            // Se activará cuando se integre el modal de creación de tareas
            console.log('Abrir modal para crear tarea');
        });
    }

    const btnConfigurar = document.getElementById('btn-configurar-tablero');
    if (btnConfigurar) {
        btnConfigurar.addEventListener('click', () => {
            // Se activará con el modal de personalización de columnas (HU-17)
            console.log('Abrir modal para personalizar columnas');
        });
    }

    /**
     * 4. Configura los escuchadores para los filtros dinámicos (Persona / Épica).
     */
    const filtroPersona = document.getElementById('filtro-persona');
    const filtroEpica = document.getElementById('filtro-epica');

    if (filtroPersona) {
        filtroPersona.addEventListener('change', (e) => {
            cargarTablero({ personaId: e.target.value });
        });
    }

    if (filtroEpica) {
        filtroEpica.addEventListener('change', (e) => {
            cargarTablero({ epicaId: e.target.value });
        });
    }
});