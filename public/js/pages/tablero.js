// Responsable: Camila - HU-17 a HU-25, HU-58, HU-59: logica de la pantalla del tablero del sprint (se arma con los archivos de js/pages/tablero/) (llama a la API y escucha sockets)
import { inicializarTablero, cargarTablero } from './tablero/columnas.js';

document.addEventListener('DOMContentLoaded', () => {
    // 1. Iniciar la carga de columnas y tarjetas del sprint activo
    inicializarTablero();

    // 2. Escuchadores para botones de acción del encabezado
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

    // 3. Escuchadores de filtros (Persona / Épica)
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