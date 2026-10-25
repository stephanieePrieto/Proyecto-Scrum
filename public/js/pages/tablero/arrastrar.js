/**
 * @file arrastrar.js
 * @description Manejo interactivo de Drag & Drop para tarjetas del tablero y regresión por errores (HU-18).
 * @author Camila Mariné Crespo Zurita
 */

let tarjetaArrastrada = null;
let columnaOrigenId = null;
let posicionOrigen = null;

/**
 * Recalcula y actualiza los badges de contadores WIP en la interfaz.
 * 
 * @function actualizarContadoresWip
 * @returns {void}
 */
function actualizarContadoresWip() {
    document.querySelectorAll('[data-columna-id]').forEach(columnaEl => {
        const idCol = columnaEl.dataset.columnaId;
        const lista = columnaEl.querySelector('[id^="lista-tarjetas-"]');
        const elWip = document.getElementById(`wip-col-${idCol}`);

        if (lista && elWip) {
            const cantidad = lista.children.length;
            const limite = elWip.textContent.split('/')[1]?.trim() || '∞';
            elWip.textContent = `${cantidad} / ${limite}`;
        }
    });
}

/**
 * Registra los escuchadores de eventos para arrastrar y soltar elementos en el contenedor del tablero.
 * 
 * @function inicializarDragAndDrop
 * @param {number|string} proyectoId - ID del proyecto activo.
 * @returns {void}
 */
export function inicializarDragAndDrop(proyectoId) {
    const contenedorTablero = document.getElementById('tablero-contenedor');
    if (!contenedorTablero) return;

    // 1. Inicio del arrastre
    contenedorTablero.addEventListener('dragstart', (e) => {
        const tarjeta = e.target.closest('.tarjeta-item');
        if (!tarjeta) return;

        tarjetaArrastrada = tarjeta;
        const columnaOrigen = tarjeta.closest('[data-columna-id]');
        columnaOrigenId = columnaOrigen ? columnaOrigen.dataset.columnaId : null;
        posicionOrigen = Array.from(tarjeta.parentNode.children).indexOf(tarjeta);

        tarjeta.classList.add('opacity-40', 'scale-95');
        e.dataTransfer.setData('text/plain', tarjeta.dataset.tareaId);
        e.dataTransfer.effectAllowed = 'move';
    });

    // 2. Fin del arrastre (limpieza de clases)
    contenedorTablero.addEventListener('dragend', (e) => {
        const tarjeta = e.target.closest('.tarjeta-item');
        if (tarjeta) {
            tarjeta.classList.remove('opacity-40', 'scale-95');
        }
        document.querySelectorAll('[id^="lista-tarjetas-"]').forEach(lista => {
            lista.classList.remove('bg-indigo-50/50');
        });
    });

    // 3. Permitir la zona de soltado (quita el cursor 🚫)
    contenedorTablero.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const columna = e.target.closest('[data-columna-id]');
        if (columna) {
            const listaTarjetas = columna.querySelector('[id^="lista-tarjetas-"]');
            if (listaTarjetas) {
                listaTarjetas.classList.add('bg-indigo-50/50');
            }
        }
    });

    // 4. Quitar feedback visual al salir de una columna
    contenedorTablero.addEventListener('dragleave', (e) => {
        const columna = e.target.closest('[data-columna-id]');
        if (columna) {
            const listaTarjetas = columna.querySelector('[id^="lista-tarjetas-"]');
            if (listaTarjetas && !columna.contains(e.relatedTarget)) {
                listaTarjetas.classList.remove('bg-indigo-50/50');
            }
        }
    });

    // 5. Procesar soltado (Drop)
    contenedorTablero.addEventListener('drop', async (e) => {
        e.preventDefault();

        document.querySelectorAll('[id^="lista-tarjetas-"]').forEach(lista => {
            lista.classList.remove('bg-indigo-50/50');
        });

        const columnaDestino = e.target.closest('[data-columna-id]');
        if (!columnaDestino || !tarjetaArrastrada) return;

        const columnaDestinoId = columnaDestino.dataset.columnaId;
        const tareaId = tarjetaArrastrada.dataset.tareaId;
        const listaDestino = columnaDestino.querySelector('[id^="lista-tarjetas-"]');
        const listaOrigen = document.getElementById(`lista-tarjetas-${columnaOrigenId}`);

        if (!listaDestino) return;

        // Cambiar de columna en el DOM de forma optimista
        listaDestino.appendChild(tarjetaArrastrada);
        actualizarContadoresWip();

        try {
            // Petición POST a /api/tablero/mover-tarjeta coincidiendo con tablero.routes.js
            const respuesta = await fetch('/api/tablero/mover-tarjeta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proyectoId: Number(proyectoId),
                    tareaId: Number(tareaId),
                    nuevaColumnaId: Number(columnaDestinoId),
                    nuevoOrden: listaDestino.children.length
                })
            });

            if (!respuesta.ok) {
                throw new Error(`Error en el servidor (${respuesta.status})`);
            }
        } catch (error) {
            console.error("Error al mover tarjeta, revirtiendo posición:", error);

            // Revertir a la posición previa si ocurre un fallo
            if (listaOrigen) {
                if (posicionOrigen >= listaOrigen.children.length) {
                    listaOrigen.appendChild(tarjetaArrastrada);
                } else {
                    listaOrigen.insertBefore(tarjetaArrastrada, listaOrigen.children[posicionOrigen]);
                }
                actualizarContadoresWip();
            }
            alert("No se pudo guardar el movimiento de la tarjeta.");
        }
    });
}