/**
 * @file tablero.js
 * 
 * @fileoverview Lógica de la pantalla del tablero del sprint (HU-17 a HU-25, HU-58, HU-59).
 * Se arma con los módulos de tablero y maneja la comunicación inicial y filtros.
 * 
 * @author Camila Marine Crespo Zurita
 * @author Citlaly Morales Viveros
 * 
 * @see {@link module:tablero/columnas}
 */

// HU-52: debe ser el primer import. Crea la conexión en tiempo real y la publica en window.socket antes de que
// reconexion.js se cargue (la toma al cargarse). No se conecta hasta llamar a iniciarTiempoReal.
import { iniciarTiempoReal } from '../componentes/tiempo-real-limitado.js';
import { inicializarTablero } from './tablero/columnas.js';
import { inicializarFiltros, sincronizarConServidor } from './tablero/filtros.js';
import { inicializarMenuMover, hayArrastreEnCurso } from './tablero/mover-menu.js';
import { montarBarraSuperior } from '../core/layout.js';
import { cargarPermisos } from '../core/permisos-ui.js';
import { escucharMovimientosSocket } from './tablero/reconexion.js';
import { iniciarControlConcurrencia, sincronizarEdicionesPendientes } from './tablero/concurrencia.js';

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
document.addEventListener('DOMContentLoaded', async() => {
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

    // Inicializar controles de concurrencia y sincronizar cambios offline pendientes
    iniciarControlConcurrencia();
    await sincronizarEdicionesPendientes();
    /**
     * Inicia la carga de las columnas, tarjetas y cálculo de días del sprint activo.
     */
    inicializarTablero(proyectoActivoId);

    /**
     * Carga los permisos del proyecto activo para mostrar solo las acciones de su rol.
     */
    const permisos = cargarPermisos(Number(proyectoActivoId));
    permisos.catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });

    /**
     * Filtros, agrupación en carriles y su persistencia (HU-21). La respuesta de permisos trae el usuario
     * para guardar los filtros por proyecto y persona.
     */
    inicializarFiltros(proyectoActivoId, permisos);

    /**
     * Menú "Mover a…" para pantallas táctiles y seguimiento de arrastres (HU-52).
     */
    inicializarMenuMover();

    /**
     * Inicializa la escucha por WebSockets y la sincronización offline (HU-58).
     */
    escucharMovimientosSocket(proyectoActivoId);

    /**
     * Conecta el tiempo real; si el WebSocket está bloqueado, sondea cada 5 s y avisa "tiempo real limitado" (HU-52).
     * El sondeo se salta mientras hay un arrastre o un modal abierto.
     */
    iniciarTiempoReal({
        proyectoId: proyectoActivoId,
        sondear: sincronizarConServidor,
        obtenerContexto: () => ({
            arrastrando: hayArrastreEnCurso(),
            modalAbierto: Boolean(document.querySelector('.modal-overlay:not(.modal--hidden)')),
        }),
        contenedorAviso: document.getElementById('sprint-estado')?.parentElement || null,
    });

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