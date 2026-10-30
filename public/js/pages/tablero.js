/**
 * @fileoverview Lógica de la pantalla del tablero del sprint (HU-17 a HU-25, HU-58, HU-59).
 * Se arma con los módulos de tablero y maneja la comunicación inicial y filtros.
 * @author Camila
 * @see {@link module:tablero/columnas}
 */

import { inicializarTablero, aplicarFiltrosTablero } from './tablero/columnas.js';
import { montarBarraSuperior } from '../core/layout.js';

/**
 * Carga diferida del detalle de tarjeta (HU-20).
 * Usa import() para que un fallo en ese módulo no impida cargar el tablero.
 * @returns {void}
 */
function cargarDetalleTarjeta() {
    import('./tablero/detalle-tarjeta.js').catch((error) => {
        console.error('[HU-20] No se pudo cargar el detalle de tarjeta:', error);
    });
}

/**
 * Listener principal que se ejecuta una vez que el DOM ha sido completamente cargado.
 * @listens DOMContentLoaded
 */
document.addEventListener('DOMContentLoaded', () => {
    /**
     * Carga el detalle antes de validar el proyecto activo: el enlace ?tarea=ID de las
     * notificaciones debe abrir la tarjeta aunque no haya proyecto seleccionado.
     */
    cargarDetalleTarjeta();

    /**
     * Inyecta la barra de navegación superior en la interfaz.
     */
    if (typeof montarBarraSuperior === 'function') {
        montarBarraSuperior();
    }

    /**
     * Validación de proyecto activo en el almacenamiento local.
     */
    const proyectoActivoId = localStorage.getItem('proyectoActivo');
    const contenedorTablero = document.getElementById('contenedor-tablero');
    const tableroVacio = document.getElementById('tablero-vacio');

    if (!proyectoActivoId || proyectoActivoId === 'null') {
        // Mostrar estado vacío y ocultar el kanban
        if (contenedorTablero) contenedorTablero.style.display = 'none';
        if (tableroVacio) tableroVacio.style.display = 'block';

        // Retornar temprano para evitar peticiones innecesarias
        return;
    } else {
        // Asegurar que el tablero se muestre si hay proyecto
        if (contenedorTablero) contenedorTablero.style.display = 'flex';
        if (tableroVacio) tableroVacio.style.display = 'none';
    }

    /**
     * Inicia la carga de las columnas, tarjetas y cálculo de días del sprint activo.
     */
    inicializarTablero(proyectoActivoId);

    /**
     * Configura los escuchadores para los filtros dinámicos en tiempo real (Persona / Épica).
     */
    const filtroPersona = document.getElementById('filtro-persona');
    const filtroEpica = document.getElementById('filtro-epica');

    if (filtroPersona) {
        filtroPersona.addEventListener('change', aplicarFiltrosTablero);
    }

    if (filtroEpica) {
        filtroEpica.addEventListener('change', aplicarFiltrosTablero);
    }

    /**
     * Configura los escuchadores de eventos para los botones de acción del encabezado.
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
});