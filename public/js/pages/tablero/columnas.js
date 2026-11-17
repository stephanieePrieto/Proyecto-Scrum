/**
 * @file columnas.js
 * @description Gestión, maquetación programática en DOM y configuración de columnas (HU-17).
 * 
 * @author Camila Mariné Crespo Zurita
 * @author Alfonso Mendoza Vasquez
 */

import { renderizarTarjetasEnTablero } from './tarjeta.js';
import { inicializarDragAndDrop } from './arrastrar.js';
import { api } from '../../core/api.js';

/**
 * Cliente HTTP aislado para realizar peticiones.
 * @namespace API
 */
const API = {
    get: (url) => api(url),
    put: (url, datos) => api(url, { metodo: 'PUT', cuerpo: datos })
};

const contenedorTablero = document.getElementById('tablero-contenedor');
const modalConfig = document.getElementById('overlay-configurar-columnas');

/** @type {Array<Object>} */
let columnasActivas = [];

/** @type {Array<Object>} */
let tareasActivas = [];

/** @type {number|string} */
let proyectoIdActual = localStorage.getItem('proyectoActivo') || null;

/** HU-26: evita registrar dos veces los avisos de tiempo real del flujo continuo. */
let escuchandoFlujoContinuo = false;

/**
 * HU-26: ajusta el encabezado al modo de trabajo. En flujo continuo no hay sprint: se muestra
 * "Flujo continuo" y se ocultan los días restantes. El modo queda en body[data-modo-flujo] para
 * que el botón "+ Tarea" (tablero.js) sepa qué hacer.
 *
 * @param {{modo?: string}} datos - Respuesta de GET /api/tablero/:proyectoId.
 * @returns {void}
 */
function aplicarModoEncabezado(datos) {
    const continuo = datos?.modo === 'continuo';
    document.body.dataset.modoFlujo = continuo ? 'continuo' : 'scrum';

    const elNombre = document.getElementById('sprint-nombre');
    const elEstado = document.getElementById('sprint-estado');
    const elDias = document.getElementById('sprint-dias-restantes');
    if (elEstado) {
        elEstado.textContent = continuo ? 'Sin sprints' : 'Activo';
        elEstado.className = `insignia ${continuo ? 'insignia--info' : 'insignia--exito'}`;
    }
    if (elDias) elDias.hidden = continuo;
    if (continuo && elNombre) elNombre.textContent = 'Flujo continuo';
}

/**
 * HU-26: tiempo real del flujo continuo.
 *  - "tablero:tarea-creada": se sincroniza con el servidor sin redibujar todo, para que la tarjeta nueva aparezca.
 *  - "proyecto:modo-cambiado": se recarga la página para tomar el modo nuevo. Si hay una ventana abierta
 *    (por ejemplo, editando una tarjeta) no se interrumpe: se muestra un aviso con un botón para recargar.
 * Si el WebSocket está bloqueado, el sondeo de HU-52 (sincronizarConServidor) ya trae las tarjetas nuevas.
 *
 * @returns {void}
 */
function escucharFlujoContinuo() {
    if (escuchandoFlujoContinuo || !window.socket) return;
    escuchandoFlujoContinuo = true;
    const esDeEsteProyecto = (datos) => String(datos?.proyectoId) === String(proyectoIdActual);

    window.socket.on('tablero:tarea-creada', async (datos) => {
        if (!esDeEsteProyecto(datos)) return;
        try {
            const { sincronizarConServidor } = await import('./filtros.js');
            await sincronizarConServidor();
        } catch (error) {
            console.error('[HU-26] No se pudo mostrar la tarea nueva:', error);
        }
    });

    window.socket.on('proyecto:modo-cambiado', (datos) => {
        if (!esDeEsteProyecto(datos)) return;
        const hayVentanaAbierta = document.querySelector('.modal-overlay:not(.modal--hidden), dialog[open]');
        if (!hayVentanaAbierta) {
            window.location.reload();
            return;
        }
        if (document.getElementById('aviso-modo-cambiado')) return;
        const aviso = document.createElement('div');
        aviso.id = 'aviso-modo-cambiado';
        aviso.className = 'alerta alerta--advertencia';
        aviso.setAttribute('role', 'status');
        aviso.style.marginBottom = 'var(--espacio-4)';
        const texto = document.createElement('span');
        texto.textContent = `${datos.usuarioNombre || 'Alguien'} cambió el modo de trabajo del proyecto. `;
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'btn btn--secondary';
        boton.textContent = 'Recargar tablero';
        boton.addEventListener('click', () => window.location.reload());
        aviso.append(texto, boton);
        document.getElementById('contenedor-tablero')?.prepend(aviso);
    });
}

/**
 * Genera nodos esqueléticos (skeletons) mediante la API del DOM durante la carga.
 * 
 * @function mostrarSkeletonsTablero
 * @returns {void}
 */
export function mostrarSkeletonsTablero() {
    if (!contenedorTablero) return;
    contenedorTablero.replaceChildren();

    for (let i = 0; i < 4; i++) {
        const skeletonCol = document.createElement('div');
        skeletonCol.classList.add('w-80', 'flex-shrink-0', 'bg-slate-100', 'rounded-xl', 'p-3', 'flex', 'flex-col', 'gap-3', 'h-full');

        const header = document.createElement('div');
        header.classList.add('flex', 'justify-between', 'items-center', 'mb-2');

        const bar1 = document.createElement('div');
        bar1.classList.add('h-5', 'bg-slate-200', 'animate-pulse', 'rounded', 'w-1/2');

        const bar2 = document.createElement('div');
        bar2.classList.add('h-5', 'bg-slate-200', 'animate-pulse', 'rounded', 'w-8');

        header.appendChild(bar1);
        header.appendChild(bar2);

        const card1 = document.createElement('div');
        card1.classList.add('h-24', 'bg-white', 'animate-pulse', 'rounded', 'border', 'border-slate-200');

        const card2 = document.createElement('div');
        card2.classList.add('h-32', 'bg-white', 'animate-pulse', 'rounded', 'border', 'border-slate-200');

        skeletonCol.appendChild(header);
        skeletonCol.appendChild(card1);
        skeletonCol.appendChild(card2);

        contenedorTablero.appendChild(skeletonCol);
    }
}

/**
 * Renderiza la estructura de columnas construyendo elementos del DOM directamente.
 * 
 * @function renderizarColumnas
 * @param {Array<Object>} columnas - Arreglo de datos de columnas.
 * @returns {void}
 */
export function renderizarColumnas(columnas) {
    if (!contenedorTablero) return;
    columnasActivas = columnas;
    contenedorTablero.replaceChildren();

    if (!columnas || columnas.length === 0) {
        const contenedorVacio = document.createElement('div');
        contenedorVacio.classList.add('flex', 'flex-col', 'items-center', 'justify-center', 'w-full', 'h-full', 'text-slate-500');

        const mensaje = document.createElement('p');
        mensaje.textContent = 'No hay un sprint activo o no hay columnas.';

        const enlace = document.createElement('a');
        enlace.href = '/planificacion-sprint';
        enlace.classList.add('text-indigo-600', 'font-medium', 'hover:underline', 'mt-2');
        enlace.textContent = 'Ir a planificar sprint';

        contenedorVacio.appendChild(mensaje);
        contenedorVacio.appendChild(enlace);
        contenedorTablero.appendChild(contenedorVacio);
        return;
    }

    columnas.forEach(col => {
        const columnaElemento = document.createElement('div');
        columnaElemento.classList.add('w-80', 'flex-shrink-0', 'bg-slate-100', 'rounded-xl', 'p-3', 'flex', 'flex-col', 'max-h-full', 'overflow-hidden');
        columnaElemento.dataset.columnaId = col.id;
        //mantener el límite WIP en el dataset para referencia futura pero sin mostrarlo en el html
        columnaElemento.dataset.limiteWip = col.limite_wip || '∞';
        columnaElemento.dataset.esFinal = col.es_final ? 'true' : 'false';

        const encabezado = document.createElement('div');
        encabezado.classList.add('flex', 'justify-between', 'items-center', 'mb-3', 'px-1');

        const titulo = document.createElement('h3');
        titulo.classList.add('font-medium', 'text-slate-700', 'text-sm');
        titulo.textContent = col.nombre;

        const contadorWip = document.createElement('span');
        contadorWip.id = `wip-col-${col.id}`;
        contadorWip.classList.add('text-xs', 'font-semibold', 'text-slate-500', 'bg-slate-200', 'px-2', 'py-0.5', 'rounded-full');
        contadorWip.textContent = `0 `;

        encabezado.appendChild(titulo);
        encabezado.appendChild(contadorWip);

        const listaTarjetas = document.createElement('div');
        listaTarjetas.id = `lista-tarjetas-${col.id}`;
        // Se añade scroll independiente por columna (overflow-y-auto)
        listaTarjetas.classList.add('flex-1', 'overflow-y-auto', 'space-y-3', 'pr-1');

        columnaElemento.appendChild(encabezado);
        columnaElemento.appendChild(listaTarjetas);

        contenedorTablero.appendChild(columnaElemento);
    });
}

/**
 * Consulta la API, calcula los días restantes del sprint y coordina la construcción de la pantalla.
 * 
 * @async
 * @function cargarTablero
 * @param {number|string} proyectoId - Identificador del proyecto.
 * @returns {Promise<void>}
 */
export async function cargarTablero(proyectoId) {
    proyectoIdActual = proyectoId;
    try {
        mostrarSkeletonsTablero();

        const respuesta = await API.get(`/tablero/${proyectoIdActual}`);

        if (respuesta && respuesta.data) {
            // HU-26: encabezado según el modo (Scrum o flujo continuo) y avisos en tiempo real
            aplicarModoEncabezado(respuesta.data);
            escucharFlujoContinuo();

            if (respuesta.data.sprint) {
                const elSprintNombre = document.getElementById('sprint-nombre');
                if (elSprintNombre) elSprintNombre.textContent = respuesta.data.sprint.nombre;

                // Cálculo dinámico de días restantes del sprint activo
                const elSprintDias = document.getElementById('sprint-dias-restantes');
                if (elSprintDias && respuesta.data.sprint.fecha_fin) {
                    const fechaFin = new Date(respuesta.data.sprint.fecha_fin);
                    const hoy = new Date();
                    const diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
                    elSprintDias.textContent = `Quedan ${diasRestantes > 0 ? diasRestantes : 0} días`;
                }
            }

            renderizarColumnas(respuesta.data.columnas);

            if (respuesta.data.tareas) {
                tareasActivas = respuesta.data.tareas;
                renderizarTarjetasEnTablero(tareasActivas);
            }

            inicializarDragAndDrop(proyectoIdActual);

            // HU-21: avisar a tablero/filtros.js que hay datos nuevos para aplicar filtros y carriles
            document.dispatchEvent(new CustomEvent('tablero:cargado', {
                detail: {
                    proyectoId: proyectoIdActual,
                    sprint: respuesta.data.sprint || null,
                    historias: respuesta.data.historias || [],
                    columnas: respuesta.data.columnas || [],
                    tareas: tareasActivas
                }
            }));
        }
    } catch (error) {
        console.error("Error al cargar el tablero:", error);
        if (contenedorTablero) {
            contenedorTablero.replaceChildren();

            const contenedorError = document.createElement('div');
            contenedorError.classList.add('flex', 'flex-col', 'items-center', 'justify-center', 'w-full', 'h-full', 'text-rose-500');

            const textoError = document.createElement('p');
            textoError.textContent = 'Error al cargar el tablero.';

            const botonReintentar = document.createElement('button');
            botonReintentar.classList.add('underline', 'font-medium', 'mt-2');
            botonReintentar.textContent = 'Reintentar';
            botonReintentar.addEventListener('click', () => window.location.reload());

            contenedorError.appendChild(textoError);
            contenedorError.appendChild(botonReintentar);
            contenedorTablero.appendChild(contenedorError);
        }
    }
}


/**
 * Asigna eventos al modal de configuración generando los campos mediante nodos DOM.
 * 
 * @function iniciarConfiguracionColumnas
 * @returns {void}
 */
export function iniciarConfiguracionColumnas() {
    const btnConfig = document.getElementById('btn-configurar-columnas');
    const btnCerrarConfig = document.getElementById('btn-cerrar-config-modal');
    const btnGuardarConfig = document.getElementById('btn-guardar-config-columnas');

    document.addEventListener('tablero:recargar', () => cargarTablero(proyectoIdActual));

    if (btnConfig) {
        btnConfig.addEventListener('click', () => {
            const listaInputs = document.getElementById('lista-config-columnas');
            if (!listaInputs) return;

            listaInputs.replaceChildren();

            columnasActivas.forEach(col => {
                const campoGroup = document.createElement('div');
                campoGroup.classList.add('flex', 'flex-col', 'gap-1');

                const etiqueta = document.createElement('label');
                etiqueta.classList.add('text-sm', 'font-medium', 'text-slate-700');
                etiqueta.textContent = 'Nombre columna';

                const entrada = document.createElement('input');
                entrada.type = 'text';
                entrada.value = col.nombre;
                entrada.dataset.id = col.id;
                entrada.classList.add('config-col-input', 'border', 'border-slate-300', 'rounded', 'px-3', 'py-1.5', 'text-sm', 'focus:ring-2', 'focus:ring-indigo-500', 'outline-none');

                campoGroup.appendChild(etiqueta);
                campoGroup.appendChild(entrada);
                listaInputs.appendChild(campoGroup);
            });

            if (modalConfig) modalConfig.classList.remove('modal--hidden');
        });
    }

    if (btnCerrarConfig) {
        btnCerrarConfig.addEventListener('click', () => {
            if (modalConfig) modalConfig.classList.add('modal--hidden');
        });
    }

    if (btnGuardarConfig) {
        btnGuardarConfig.addEventListener('click', async () => {
            const inputs = document.querySelectorAll('.config-col-input');
            const nuevosNombres = Array.from(inputs).map(inp => ({
                id: inp.dataset.id,
                nombre: inp.value.trim()
            }));

            if (nuevosNombres.some(n => n.nombre === '')) {
                alert('El nombre de la columna no puede estar vacío.');
                return;
            }

            try {
                btnGuardarConfig.disabled = true;
                btnGuardarConfig.textContent = "Guardando...";

                await API.put(`/tablero/${proyectoIdActual}/columnas`, { columnas: nuevosNombres });

                if (modalConfig) modalConfig.classList.add('modal--hidden');
                document.dispatchEvent(new CustomEvent('tablero:recargar'));
            } catch (error) {
                console.error("Error al guardar configuración:", error);
                alert("No se pudo guardar la configuración. Revisa tu conexión e intenta de nuevo.");
            } finally {
                btnGuardarConfig.disabled = false;
                btnGuardarConfig.textContent = "Guardar Cambios";
            }
        });
    }
}

/**
 * Inicializa la vista completa del tablero.
 * 
 * @function inicializarTablero
 * @param {number|string} [proyectoId] - ID opcional del proyecto.
 * @returns {void}
 */
export function inicializarTablero(proyectoId = proyectoIdActual) {
    cargarTablero(proyectoId);
    iniciarConfiguracionColumnas();
}