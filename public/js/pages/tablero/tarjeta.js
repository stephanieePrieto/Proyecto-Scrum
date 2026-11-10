/**
 * @file tarjeta.js
 * @description Construcción programática pura de tarjetas de tareas mediante DOM API (HU-18, HU-19, HU-22, HU-23, HU-25).
 * @author Camila Mariné Crespo Zurita
 */

const CLASES_PASTEL_ROTATIVAS = [
    'tarjeta-encargado--naranja',
    'tarjeta-encargado--azul',
    'tarjeta-encargado--amarillo',
    'tarjeta-encargado--lavanda',
    'tarjeta-encargado--menta',
    'tarjeta-encargado--rosa',
    'tarjeta-encargado--coral',
    'tarjeta-encargado--celeste'
];

/**
 * Determina la clase CSS de color pastel según la persona encargada de la tarea.
 * 
 * @function obtenerClaseColorEncargado
 * @param {Object} tarea 
 * @returns {string}
 */
function obtenerClaseColorEncargado(tarea) {
    const nombre = String(tarea.responsable || tarea.responsable_nombre || '').trim().toLowerCase();
    const responsableId = Number(tarea.responsable_id);

    if (!nombre && (!Number.isInteger(responsableId) || responsableId <= 0)) {
        return 'tarjeta-encargado--sin-asignar';
    }

    if (nombre.includes('dana')) return 'tarjeta-encargado--naranja';
    if (nombre.includes('diego')) return 'tarjeta-encargado--azul';
    if (nombre.includes('alfonso')) return 'tarjeta-encargado--amarillo';
    if (nombre.includes('camila')) return 'tarjeta-encargado--lavanda';
    if (nombre.includes('stephy') || nombre.includes('stephanie')) return 'tarjeta-encargado--menta';
    if (nombre.includes('citlaly')) return 'tarjeta-encargado--rosa';
    if (nombre.includes('jetz')) return 'tarjeta-encargado--coral';
    if (nombre.includes('juan')) return 'tarjeta-encargado--celeste';

    const semilla = Number.isInteger(responsableId) && responsableId > 0
        ? responsableId
        : Array.from(nombre).reduce((acum, char) => acum + char.charCodeAt(0), 0);

    return CLASES_PASTEL_ROTATIVAS[Math.abs(semilla) % CLASES_PASTEL_ROTATIVAS.length];
}

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

    contenedor.dataset.version = String(tarea.version || 1);
    contenedor.dataset.orden = String(tarea.orden || 0);

    contenedor.draggable = true;
    contenedor.dataset.bloqueada = tarea.bloqueada ? 'true' : 'false';

    contenedor.tabIndex = 0;

    contenedor.classList.add(
        'tarjeta-item', 'p-3', 'rounded-lg', 'shadow-sm', 'cursor-grab',
        'hover:shadow-md', 'transition-all', 'relative', 'group', 'select-none'
    );

    contenedor.classList.add(obtenerClaseColorEncargado(tarea));

    if (tarea.bloqueada) {
        contenedor.classList.add('border-2', 'border-rose-500', 'bg-rose-50/30', 'tarjeta-item--bloqueada');
    } else if (tarea.supera_umbral) {
        contenedor.classList.add('tarjeta-item--desviacion');
        contenedor.title = 'Esta tarea supera el umbral de desviación';
    } else {
        contenedor.classList.add('border', 'border-slate-200');
    }

    // --- INDICADOR DE EDICIÓN EN TIEMPO REAL ("X está editando" - HU-25) ---
    const indicadorEditando = document.createElement('div');
    indicadorEditando.id = `indicador-editando-${tarea.id}`;
    indicadorEditando.className = 'tarjeta-editando-badge';
    indicadorEditando.hidden = true;
    contenedor.appendChild(indicadorEditando);

    // --- ENCABEZADO (#ID, Días restantes, Candado, Botón Editar ✏️) ---
    const encabezado = document.createElement('div');
    encabezado.classList.add('flex', 'items-center', 'justify-between', 'gap-2', 'mb-1.5');

    const idPadre = document.createElement('span');
    idPadre.classList.add('text-[11px]', 'font-medium', 'text-slate-400');
    idPadre.textContent = `#${tarea.id}${tarea.historia_padre ? ` • ${tarea.historia_padre}` : ''}`;

    const cajaBadges = document.createElement('div');
    cajaBadges.classList.add('flex', 'items-center', 'gap-1.5');

    const badgeDias = document.createElement('span');
    badgeDias.classList.add('text-[10px]', 'px-1.5', 'py-0.5', 'rounded', 'border');
    const dias = tarea.diasRestantes || 5;
    badgeDias.textContent = `${dias}d`;
    aplicarEstiloSemaforo(badgeDias, dias);
    cajaBadges.appendChild(badgeDias);

    if (tarea.bloqueada) {
        const candado = document.createElement('a');
        candado.title = 'Tarea Bloqueada - Ver impedimento';
        candado.classList.add('text-rose-600', 'font-bold', 'text-xs', 'cursor-pointer', 'hover:opacity-80');
        candado.textContent = '🔒';
        candado.href = tarea.idImpedimento ? `/impedimentos/${tarea.idImpedimento}` : '#';
        candado.target = '_blank';
        cajaBadges.appendChild(candado);
    }

    // Botón directo para abrir el modal de edición optimista sin interferir con el click general
    const botonEditar = document.createElement('button');
    botonEditar.type = 'button';
    botonEditar.title = 'Editar tarjeta';
    botonEditar.className = 'tarjeta-editar-btn';
    botonEditar.textContent = '✏️';
    botonEditar.addEventListener('click', (e) => {
        e.stopPropagation();
        import('./concurrencia.js').then((mod) => {
            mod.abrirModalEditarTarjeta(tarea.id);
        });
    });
    cajaBadges.appendChild(botonEditar);

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

    // HU-52 (Alfonso): botón "Mover a…" para pantallas táctiles
    const botonMover = document.createElement('button');
    botonMover.type = 'button';
    botonMover.className = 'tarjeta-mover-btn';
    botonMover.dataset.tareaId = tarea.id;
    botonMover.dataset.permiso = 'tarea.gestionar';
    botonMover.setAttribute('aria-label', `Mover «${tarea.titulo}» a otra columna`);
    botonMover.textContent = 'Mover a…';
    pie.appendChild(botonMover);

    contenedor.appendChild(pie);

    // El doble clic se mantiene como alternativa, deteniendo la propagación
    contenedor.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        import('./concurrencia.js').then((mod) => {
            mod.abrirModalEditarTarjeta(tarea.id);
        });
    });

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
            elWip.textContent = cantidadActual;
        }
    });
}