/**
 * @file tarjeta.js
 * @description Construcción programática pura de tarjetas de tareas mediante DOM API (HU-18, HU-19, HU-22).
 * @author Camila Mariné Crespo Zurita
 */

/**
 * Aplica las clases de Tailwind según los días restantes para el vencimiento.
 * 
 * @function aplicarEstiloSemaforo
 * @param {HTMLElement} elemento 
 * @param {number} dias 
 */
function aplicarEstiloSemaforo(elemento, dias) {
    if (!dias || dias <= 2) {
        elemento.classList.add('bg-red-100', 'text-red-700', 'border-red-200');
    } else if (dias <= 5) {
        elemento.classList.add('bg-amber-100', 'text-amber-700', 'border-amber-200');
    } else {
        elemento.classList.add('bg-emerald-100', 'text-emerald-700', 'border-emerald-200');
    }
}

/**
 * Genera el nodo de la tarjeta mediante nodos DOM puros sin cadenas HTML.
 * 
 * @function crearElementoTarjeta
 * @param {Object} tarea 
 * @returns {HTMLDivElement}
 */
export function crearElementoTarjeta(tarea) {
    const contenedor = document.createElement('div');
    contenedor.id = `tarjeta-${tarea.id}`;
    contenedor.dataset.tareaId = tarea.id;
    contenedor.draggable = !tarea.bloqueada;

    contenedor.classList.add(
        'tarjeta-item', 'p-3', 'rounded-lg', 'shadow-sm', 'cursor-grab', 
        'hover:shadow-md', 'transition-all', 'relative', 'group', 'select-none'
    );

    if (tarea.bloqueada) {
        contenedor.classList.add('border-2', 'border-rose-500', 'bg-rose-50/30');
    } else {
        contenedor.classList.add('border', 'border-slate-200', 'bg-white');
    }

    // --- ENCABEZADO (#ID, Días restantes, Candado) ---
    const encabezado = document.createElement('div');
    encabezado.classList.add('flex', 'items-center', 'justify-between', 'gap-2', 'mb-1.5');

    const idPadre = document.createElement('span');
    idPadre.classList.add('text-[11px]', 'font-medium', 'text-slate-400');
    idPadre.textContent = `#${tarea.id}${tarea.historia_padre ? ` • ${tarea.historia_padre}` : ''}`;

    const cajaBadges = document.createElement('div');
    cajaBadges.classList.add('flex', 'items-center', 'gap-1');

    const badgeDias = document.createElement('span');
    badgeDias.classList.add('text-[10px]', 'px-1.5', 'py-0.5', 'rounded', 'border');
    const dias = tarea.diasRestantes || 5;
    badgeDias.textContent = `${dias}d`;
    aplicarEstiloSemaforo(badgeDias, dias);
    cajaBadges.appendChild(badgeDias);

    if (tarea.bloqueada) {
        const candado = document.createElement('span');
        candado.title = 'Tarea Bloqueada';
        candado.classList.add('text-rose-600', 'font-bold', 'text-xs');
        candado.textContent = '🔒';
        cajaBadges.appendChild(candado);
    }

    encabezado.appendChild(idPadre);
    encabezado.appendChild(cajaBadges);

    // --- TÍTULO ---
    const titulo = document.createElement('h4');
    titulo.classList.add('text-sm', 'font-semibold', 'text-slate-800', 'line-clamp-2', 'mb-1');
    titulo.textContent = tarea.titulo;
    titulo.title = tarea.titulo;

    contenedor.appendChild(encabezado);
    contenedor.appendChild(titulo);

    // --- DESCRIPCIÓN ---
    if (tarea.descripcion) {
        const descripcion = document.createElement('p');
        descripcion.classList.add('text-xs', 'text-slate-500', 'line-clamp-2', 'mb-2');
        descripcion.textContent = tarea.descripcion;
        contenedor.appendChild(descripcion);
    }

    // --- PIE DE TARJETA (Responsable y Horas) ---
    const pie = document.createElement('div');
    pie.classList.add('flex', 'items-center', 'justify-between', 'mt-2', 'pt-2', 'border-t', 'border-slate-100', 'text-xs', 'text-slate-500');

    // Responsable
    const cajaResponsable = document.createElement('div');
    cajaResponsable.classList.add('flex', 'items-center', 'gap-1', 'font-medium');

    const iconoUsuario = document.createElement('span');
    iconoUsuario.textContent = '👤';

    const nombreResponsable = document.createElement('span');
    nombreResponsable.classList.add('truncate', 'max-w-[100px]');

    if (tarea.responsable) {
        nombreResponsable.textContent = tarea.responsable_inactivo ? 'Usuario inactivo' : tarea.responsable;
        cajaResponsable.classList.add('text-slate-700');
    } else {
        nombreResponsable.textContent = 'Sin asignar';
        cajaResponsable.classList.add('text-slate-400', 'italic');
    }

    cajaResponsable.appendChild(iconoUsuario);
    cajaResponsable.appendChild(nombreResponsable);

    // Horas
    const cajaHoras = document.createElement('div');
    cajaHoras.classList.add('font-mono', 'text-[11px]', 'bg-slate-100', 'px-1.5', 'py-0.5', 'rounded', 'text-slate-600');
    cajaHoras.title = 'Horas Reales';

    const horasValor = (tarea.horas_reales && Number(tarea.horas_reales) > 0) ? `${tarea.horas_reales}h` : '—';
    cajaHoras.textContent = `⏱️ ${horasValor}`;

    pie.appendChild(cajaResponsable);
    pie.appendChild(cajaHoras);

    contenedor.appendChild(pie);

    return contenedor;
}

/**
 * Dibuja las tarjetas y actualiza contadores WIP sin cadenas de texto HTML.
 * 
 * @function renderizarTarjetasEnTablero
 * @param {Array<Object>} tareas 
 */
export function renderizarTarjetasEnTablero(tareas = []) {
    document.querySelectorAll('[id^="lista-tarjetas-"]').forEach(lista => {
        lista.replaceChildren();
    });

    const conteoPorColumna = {};

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