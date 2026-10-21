// Responsable: Camila - HU-19: Información en la tarjeta
import { calcularColorSemaforo } from '../../core/semaforo.js'; // Base HU-28

export function crearElementoTarjeta(tarea) {
    const div = document.createElement('div');

    // Conexión con tarjetas.css y los colores base del proyecto
    div.className = `tarjeta-item bg-white rounded-lg shadow-sm border p-3 flex flex-col gap-2 cursor-pointer hover:border-indigo-300 transition-colors`;

    // Conexión con avisos.css/insignias.css para el bloqueo (HU-19)
    if (tarea.bloqueada) {
        div.classList.add('tarjeta-bloqueada', 'border-l-4', 'border-l-rose-500');
    }

    div.id = `tarjeta-${tarea.id}`;
    div.dataset.tareaId = tarea.id;

    // Lógica de datos vacíos
    const horasRealesTxt = tarea.horas_reales ? `${tarea.horas_reales}h real` : '—';
    const horasEstimadasTxt = tarea.horas_estimadas ? `${tarea.horas_estimadas}h est.` : '?';

    // Conexión con core/semaforo.js para pintar las clases text-emerald-500, amber-500 o rose-500
    let colorTextoHoras = 'text-slate-600';
    if (tarea.horas_reales && tarea.horas_estimadas) {
        colorTextoHoras = calcularColorSemaforo(tarea.horas_estimadas, tarea.horas_reales) || colorTextoHoras;
    }

    // Estructura interna usando clases globales
    div.innerHTML = `
        <div class="flex justify-between items-start gap-2">
             <!-- Insignia de historia -->
             <span class="insignia-historia text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-wider truncate max-w-[120px]" title="${tarea.historia_padre}">
                ${tarea.historia_padre || 'Sin historia'}
             </span>
             ${tarea.bloqueada ? `<svg class="icono-bloqueo w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"></path></svg>` : ''}
        </div>
        
        <h4 class="texto-titulo text-sm font-medium text-slate-800 leading-tight break-words line-clamp-2" title="${tarea.titulo}">
            ${tarea.titulo}
        </h4>

        <div class="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <!-- Chip de Horas con el color del semáforo -->
            <div class="chip-horas flex items-center gap-1.5 bg-slate-50 rounded px-2 py-0.5 border border-slate-200 text-xs font-medium ${colorTextoHoras}">
                <svg class="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span>${horasEstimadasTxt} / ${horasRealesTxt}</span>
            </div>
            
            <div class="flex items-center gap-2">
                <!-- Puntos de historia -->
                ${tarea.puntos ? `<span class="insignia-puntos bg-indigo-50 text-indigo-700 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full border border-indigo-100">${tarea.puntos}</span>` : ''}
                <!-- Avatar -->
                <div class="avatar-usuario w-6 h-6 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-bold" title="${tarea.responsable_nombre || 'Sin Asignar'}">
                    ${tarea.responsable_nombre ? tarea.responsable_nombre.charAt(0) : '?'}
                </div>
            </div>
        </div>
    `;

    return div;
}