/**
 * @file arrastrar.js
 * @description Manejo interactivo de Drag & Drop, alertas WIP, sockets y resiliencia offline (HU-18, HU-22).
 * @author Camila Mariné Crespo Zurita
 */

let tarjetaArrastrada = null;
let columnaOrigenId = null;
let posicionOrigen = null;

/**
 * Evalúa los límites WIP de cada columna y aplica alertas visuales si se superan (HU-22).
 * 
 * @function actualizarContadoresYAlertasWip
 * @returns {void}
 */
function actualizarContadoresYAlertasWip() {
    document.querySelectorAll('[data-columna-id]').forEach(columnaEl => {
        const idCol = columnaEl.dataset.columnaId;
        const lista = columnaEl.querySelector('[id^="lista-tarjetas-"]');
        const elWip = document.getElementById(`wip-col-${idCol}`);

        if (lista && elWip) {
            const cantidad = lista.children.length;
            const limiteTexto = elWip.textContent.split('/')[1]?.trim() || '∞';
            const limiteNum = limiteTexto === '∞' ? Infinity : Number(limiteTexto);

            elWip.textContent = `${cantidad} / ${limiteTexto}`;

            // Criterio HU-22: Alerta visual si se supera el límite WIP
            if (cantidad > limiteNum) {
                elWip.classList.remove('bg-slate-200', 'text-slate-500');
                elWip.classList.add('bg-rose-100', 'text-rose-700', 'font-bold', 'animate-pulse');
                columnaEl.classList.add('ring-2', 'ring-rose-400');
            } else {
                elWip.classList.remove('bg-rose-100', 'text-rose-700', 'font-bold', 'animate-pulse');
                elWip.classList.add('bg-slate-200', 'text-slate-500');
                columnaEl.classList.remove('ring-2', 'ring-rose-400');
            }
        }
    });
}

/**
 * Guarda el movimiento en la cola local para cuando se pierda la conexión (Modo Offline).
 * 
 * @function guardarMovimientoPendiente
 * @param {Object} movimiento 
 */
function guardarMovimientoPendiente(movimiento) {
    const cola = JSON.parse(localStorage.getItem('movimientos_pendientes') || '[]');
    cola.push(movimiento);
    localStorage.setItem('movimientos_pendientes', JSON.stringify(cola));
}

/**
 * Registra los escuchadores de eventos para arrastrar y soltar elementos.
 * 
 * @function inicializarDragAndDrop
 * @param {number|string} proyectoId - ID del proyecto activo.
 * @returns {void}
 */
export function inicializarDragAndDrop(proyectoId) {
    const contenedorTablero = document.getElementById('tablero-contenedor');
    if (!contenedorTablero) return;

    // 1. Validar permisos de usuario (Ejemplo: Restricción para PO o lectura)
    const usuarioSesion = JSON.parse(localStorage.getItem('usuario_sesion') || '{"rol":"DEV"}');

    // Escuchar eventos en tiempo real entrantes (WebSockets)
    if (window.socket) {
        window.socket.on('tablero:tarjeta-movida', (datos) => {
            if (Number(datos.proyectoId) === Number(proyectoId)) {
                const tarjeta = document.querySelector(`[data-tarea-id="${datos.tareaId}"]`);
                const listaDestino = document.querySelector(`[data-columna-id="${datos.nuevaColumnaId}"] [id^="lista-tarjetas-"]`);
                if (tarjeta && listaDestino) {
                    listaDestino.appendChild(tarjeta);
                    actualizarContadoresYAlertasWip();
                }
            }
        });
    }

    // DragStart
    contenedorTablero.addEventListener('dragstart', (e) => {
        // Bloqueo por rol si el usuario no tiene permisos de edición
        if (usuarioSesion.rol === 'READ_ONLY') {
            e.preventDefault();
            alert("Tu rol no tiene permisos para mover tarjetas en este tablero.");
            return;
        }

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

    // DragEnd
    contenedorTablero.addEventListener('dragend', (e) => {
        const tarjeta = e.target.closest('.tarjeta-item');
        if (tarjeta) {
            tarjeta.classList.remove('opacity-40', 'scale-95');
        }
        document.querySelectorAll('[id^="lista-tarjetas-"]').forEach(lista => {
            lista.classList.remove('bg-indigo-50/50');
        });
    });

    // DragOver
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

    // DragLeave
    contenedorTablero.addEventListener('dragleave', (e) => {
        const columna = e.target.closest('[data-columna-id]');
        if (columna) {
            const listaTarjetas = columna.querySelector('[id^="lista-tarjetas-"]');
            if (listaTarjetas && !columna.contains(e.relatedTarget)) {
                listaTarjetas.classList.remove('bg-indigo-50/50');
            }
        }
    });

    // Drop
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

        // Movimiento visual optimista
        listaDestino.appendChild(tarjetaArrastrada);
        actualizarContadoresYAlertasWip();

        // 2. Manejo en caso de pérdida de conexión (Offline Mode)
        if (!navigator.onLine) {
            tarjetaArrastrada.classList.add('border-dashed', 'border-amber-400');
            guardarMovimientoPendiente({
                proyectoId: Number(proyectoId),
                tareaId: Number(tareaId),
                nuevaColumnaId: Number(columnaDestinoId)
            });
            alert("Sin conexión. El movimiento se ha marcado como 'pendiente de sincronizar'.");
            return;
        }

        try {
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

            // Emitir evento por WebSockets para otros usuarios conectados (< 1s)
            if (window.socket) {
                window.socket.emit('tablero:mover-tarjeta', {
                    proyectoId: Number(proyectoId),
                    tareaId: Number(tareaId),
                    nuevaColumnaId: Number(columnaDestinoId)
                });
            }

        } catch (error) {
            console.error("Error al mover tarjeta, revirtiendo posición:", error);

            // Reversión automática en caso de rechazo o falla
            if (listaOrigen) {
                if (posicionOrigen >= listaOrigen.children.length) {
                    listaOrigen.appendChild(tarjetaArrastrada);
                } else {
                    listaOrigen.insertBefore(tarjetaArrastrada, listaOrigen.children[posicionOrigen]);
                }
                actualizarContadoresYAlertasWip();
            }
            alert("No se pudo guardar el movimiento de la tarjeta. Se ha revertido el cambio.");
        }
    });
}