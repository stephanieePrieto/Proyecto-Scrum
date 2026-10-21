// Responsable: Camila - HU-17: columnas configurables
import { API } from '../../core/api.js';
import { renderizarTarjetasEnTablero } from './tarjeta.js'; // Importamos tu componente de tarjetas

const contenedorTablero = document.getElementById('tablero-contenedor');
const modalConfig = document.getElementById('modal-configurar-columnas');

// Variables globales para el estado
let columnasActivas = [];
let proyectoIdActual = localStorage.getItem('proyectoActivoId') || 1; // Esto lo definirá el equipo en el Dashboard

//Mostrar skeletons mientras carga (HU-17)
export function mostrarSkeletonsTablero() {
    contenedorTablero.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        contenedorTablero.innerHTML += `
            <div class="w-80 flex-shrink-0 bg-slate-100 rounded-xl p-3 flex flex-col gap-3 h-full max-h-full">
                <div class="flex justify-between items-center mb-2">
                    <div class="h-5 bg-slate-200 animate-pulse rounded w-1/2"></div>
                    <div class="h-5 bg-slate-200 animate-pulse rounded w-8"></div>
                </div>
                <div class="h-24 bg-white animate-pulse rounded border border-slate-200"></div>
                <div class="h-32 bg-white animate-pulse rounded border border-slate-200"></div>
            </div>
        `;
    }
}

//Renderizar columnas vacías
export function renderizarColumnas(columnas) {
    columnasActivas = columnas;
    contenedorTablero.innerHTML = '';

    if (!columnas || columnas.length === 0) {
        contenedorTablero.innerHTML = `
            <div class="flex flex-col items-center justify-center w-full h-full text-slate-500">
                <p>No hay un sprint activo o no hay columnas.</p>
                <a href="/planificacion-sprint" class="text-indigo-600 font-medium hover:underline mt-2">Ir a planificar sprint</a>
            </div>
        `;
        return;
    }

    columnas.forEach(col => {
        contenedorTablero.innerHTML += `
            <div class="w-80 flex-shrink-0 bg-slate-100 rounded-xl p-3 flex flex-col max-h-full overflow-hidden" data-columna-id="${col.id}">
                <div class="flex justify-between items-center mb-3 px-1">
                    <h3 class="font-medium text-slate-700 text-sm">${col.nombre}</h3>
                    <span class="text-xs font-semibold text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full" id="wip-col-${col.id}">0 / ${col.limite_wip || '∞'}</span>
                </div>
                <!-- Contenedor donde caerán las tarjetas -->
                <div class="flex-1 overflow-y-auto space-y-3" id="lista-tarjetas-${col.id}"></div>
            </div>
        `;
    });
}

//Petición real al Backend para traer todo el Tablero
export async function cargarTablero(proyectoId) {
    proyectoIdActual = proyectoId;
    try {
        mostrarSkeletonsTablero();

        // Llamada a la API que configuraste en tablero.routes.js
        const respuesta = await API.get(`/api/tablero/${proyectoIdActual}`);

        if (respuesta && respuesta.datos) {
            // Actualizar textos del encabezado
            if (respuesta.datos.sprint) {
                document.getElementById('sprint-nombre').textContent = respuesta.datos.sprint.nombre;
            }

            // Pintar la interfaz con los datos reales
            renderizarColumnas(respuesta.datos.columnas);

            if (respuesta.datos.tareas) {
                renderizarTarjetasEnTablero(respuesta.datos.tareas); // Llama a tu función de tarjeta.js
            }
        }
    } catch (error) {
        console.error("Error al cargar el tablero:", error);
        contenedorTablero.innerHTML = `
            <div class="flex flex-col items-center justify-center w-full h-full text-rose-500">
                <p>Error al cargar el tablero.</p>
                <button onclick="window.location.reload()" class="underline font-medium mt-2">Reintentar</button>
            </div>
        `;
    }
}

//Lógica para configurar columnas (solo SM o Admin)
export function iniciarConfiguracionColumnas() {
    const btnConfig = document.getElementById('btn-configurar-columnas');
    const btnCerrarConfig = document.getElementById('btn-cerrar-config-modal');
    const btnGuardarConfig = document.getElementById('btn-guardar-config-columnas');

    // Escuchar el evento de recarga para cuando guardes o lleguen datos por socket
    document.addEventListener('tablero:recargar', () => cargarTablero(proyectoIdActual));

    btnConfig.addEventListener('click', () => {
        const listaInputs = document.getElementById('lista-config-columnas');
        listaInputs.innerHTML = '';
        columnasActivas.forEach(col => {
            listaInputs.innerHTML += `
                <div class="flex flex-col gap-1">
                    <label class="text-sm font-medium text-slate-700">Nombre columna</label>
                    <input type="text" value="${col.nombre}" data-id="${col.id}" class="config-col-input border border-slate-300 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                </div>
            `;
        });
        modalConfig.showModal();
    });

    btnCerrarConfig.addEventListener('click', () => modalConfig.close());

    btnGuardarConfig.addEventListener('click', async () => {
        const inputs = document.querySelectorAll('.config-col-input');
        const nuevosNombres = Array.from(inputs).map(inp => ({
            id: inp.dataset.id,
            nombre: inp.value.trim()
        }));

        if (nuevosNombres.some(n => n.nombre === '')) {
            // El diseño pide mensajes genéricos sin códigos técnicos y accionables
            alert('El nombre de la columna no puede estar vacío.');
            return;
        }

        try {
            // Prevención de errores: Deshabilitar el botón para evitar doble envío
            btnGuardarConfig.disabled = true;
            btnGuardarConfig.textContent = "Guardando...";

            // Petición real al backend
            await API.put(`/api/tablero/${proyectoIdActual}/columnas`, { columnas: nuevosNombres });

            modalConfig.close();
            // Refrescar tablero para ver los cambios
            document.dispatchEvent(new CustomEvent('tablero:recargar'));
        } catch (error) {
            console.error("Error al guardar configuración:", error);
            alert("No se pudo guardar la configuración. Revisa tu conexión e intenta de nuevo.");
        } finally {
            // Devolver el botón a su estado original
            btnGuardarConfig.disabled = false;
            btnGuardarConfig.textContent = "Guardar Cambios";
        }
    });
}

//Arranque inicial
cargarTablero(proyectoIdActual);
iniciarConfiguracionColumnas();