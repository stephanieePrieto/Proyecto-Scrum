/**
 * @file tarjeta.js
 * @description Renderizado y gestión visual de tarjetas de tareas en el tablero del sprint (HU-18, HU-22).
 * @author Camila Mariné Crespo Zurita
 */

/**
 * Función auxiliar local Y para calcular las clases CSS del semáforo de vencimiento.
 * 
 * @function calcularColorSemaforo
 * @param {number} diasRestantes - Días restantes para el vencimiento de la tarea.
 * @returns {string} Clases CSS de Tailwind para color e indicación visual.
 */
const calcularColorSemaforo = (diasRestantes) => {
    if (!diasRestantes || diasRestantes <= 2) return 'bg-red-100 text-red-700 border-red-200';
    if (diasRestantes <= 5) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-emerald-100 text-emerald-700 border-emerald-200';
};

/**
 * Genera el elemento HTML interactivo para una tarjeta individual.
 * 
 * @function crearElementoTarjeta
 * @param {Object} tarea - Objeto con los datos de la tarea.
 * @param {number|string} tarea.id - Identificador único de la tarea.
 * @param {string} tarea.titulo - Título principal de la tarea.
 * @param {string} [tarea.descripcion] - Descripción detallada opcional.
 * @param {number} [tarea.diasRestantes] - Días restantes para el cálculo del semáforo.
 * @returns {HTMLDivElement} Elemento DOM de la tarjeta.
 */
export function crearElementoTarjeta(tarea) {
    const tarjeta = document.createElement('div');
    tarjeta.id = `tarjeta-${tarea.id}`;
    tarjeta.dataset.tareaId = tarea.id;
    tarjeta.draggable = true;
    tarjeta.className = 'tarjeta-item bg-white p-3 rounded-lg shadow-sm border border-slate-200 cursor-grab hover:shadow-md transition-all relative group select-none';

    const colorSemaforo = calcularColorSemaforo(tarea.diasRestantes || 5);

    tarjeta.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="text-xs px-2 py-0.5 rounded-full border font-medium ${colorSemaforo}">
                ${tarea.diasRestantes || 5}d restantes
            </span>
            <span class="text-[11px] font-medium text-slate-400">#${tarea.id}</span>
        </div>
        <h4 class="text-sm font-semibold text-slate-800 line-clamp-2 mb-1">${tarea.titulo}</h4>
        ${tarea.descripcion ? `<p class="text-xs text-slate-500 line-clamp-2 mb-2">${tarea.descripcion}</p>` : ''}
    `;

    return tarjeta;
}

/**
 * Renderiza el listado de tarjetas y actualiza automáticamente los contadores WIP de cada columna.
 * 
 * @function renderizarTarjetasEnTablero
 * @param {Array<Object>} tareas - Arreglo de tareas a dibujar.
 * @returns {void}
 */
export function renderizarTarjetasEnTablero(tareas = []) {
    //Limpiar tarjetas anteriores
    document.querySelectorAll('[id^="lista-tarjetas-"]').forEach(lista => {
        lista.replaceChildren();
    });

    const conteoPorColumna = {};

    //Renderizar cada tarjeta y contar cuántas hay por columna
    if (Array.isArray(tareas) && tareas.length > 0) {
        tareas.forEach(tarea => {
            const idColumna = tarea.columna_id || tarea.columnaId;
            const contenedorColumna = document.getElementById(`lista-tarjetas-${idColumna}`);

            if (contenedorColumna) {
                contenedorColumna.appendChild(crearElementoTarjeta(tarea));
                conteoPorColumna[idColumna] = (conteoPorColumna[idColumna] || 0) + 1;
            }
        });
    }

    //Actualizar los badges de WIP en los encabezados de las columnas
    document.querySelectorAll('[data-columna-id]').forEach(columnaEl => {
        const idCol = columnaEl.dataset.columnaId;
        const elWip = document.getElementById(`wip-col-${idCol}`);

        if (elWip) {
            const cantidadActual = conteoPorColumna[idCol] || 0;
            const partes = elWip.textContent.split('/');
            const limite = partes[1] ? partes[1].trim() : '∞';

            elWip.textContent = `${cantidadActual} / ${limite}`;
        }
    });
}