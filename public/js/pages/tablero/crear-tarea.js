/**
 * @file crear-tarea.js
 * @description Creación de tareas técnicas desde el tablero del Sprint activo.
 */
import { api } from '../../core/api.js';
import { mensajeError } from '../../core/errores.js';
import { mostrarAviso } from './filtros.js';

/**
 * Conecta el formulario de creación con la historia seleccionada del Sprint activo.
 * @param {string|number} proyectoId
 * @param {Promise<Object>} permisosPromise
 */
export function inicializarCrearTarea(proyectoId, permisosPromise) {
    const boton = document.getElementById('btn-nueva-tarea');
    const dialogo = document.getElementById('dialogo-nueva-tarea');
    const formulario = document.getElementById('formulario-nueva-tarea');
    const selectorHistoria = document.getElementById('nueva-tarea-historia');
    const selectorResponsable = document.getElementById('nueva-tarea-responsable');
    const error = document.getElementById('error-nueva-tarea');
    const botonGuardar = document.getElementById('btn-guardar-nueva-tarea');
    let sprintActivo = null;
    let historias = [];

    document.addEventListener('tablero:cargado', (evento) => {
        if (String(evento.detail?.proyectoId) !== String(proyectoId)) return;
        sprintActivo = evento.detail.sprint ?? null;
        historias = evento.detail.historias ?? [];
    });

    document.getElementById('btn-cancelar-nueva-tarea').addEventListener('click', () => dialogo.close());

    boton.addEventListener('click', async () => {
        if (document.body.dataset.modoFlujo === 'continuo') {
            try {
                const { abrirTareaContinua } = await import('../../componentes/tarea-continua.js');
                await abrirTareaContinua({
                    proyectoId,
                    alCrear: () => document.dispatchEvent(new CustomEvent('tablero:recargar')),
                });
            } catch (errorContinuo) {
                console.error('[tablero] No se pudo abrir el formulario de flujo continuo:', errorContinuo);
                mostrarAviso(mensajeError(errorContinuo, 'No se pudo abrir el formulario de tareas.'), 'error');
            }
            return;
        }

        error.hidden = true;
        formulario.reset();
        selectorHistoria.replaceChildren(new Option('Selecciona una historia…', ''));
        selectorResponsable.replaceChildren();

        try {
            const permisos = await permisosPromise;
            if (!permisos?.permisos?.includes('tarea.gestionar')) {
                throw new Error('No tienes permiso para crear tareas en este proyecto.');
            }
            if (!sprintActivo || !historias.length) {
                throw new Error('El Sprint activo no tiene historias de usuario disponibles para agregar tareas.');
            }

            historias.forEach((historia) => {
                const prefijo = historia.numero_hu ? `${historia.numero_hu} · ` : '';
                const epica = historia.epica_nombre ? ` (${historia.epica_nombre})` : '';
                selectorHistoria.add(new Option(`${prefijo}${historia.titulo}${epica}`, String(historia.id)));
            });

            if (permisos.rol === 'scrum_master') {
                const datosMiembros = await api(`/miembros/proyecto/${proyectoId}`);
                const miembros = (datosMiembros.miembros || []).filter((miembro) => miembro.activo);
                selectorResponsable.replaceChildren(new Option('Selecciona una persona…', ''));
                miembros.forEach((miembro) => selectorResponsable.add(
                    new Option(miembro.nombre, String(miembro.usuario_id))
                ));
                if (!miembros.length) throw new Error('No hay integrantes activos a quienes asignar la tarea.');
            } else {
                selectorResponsable.add(new Option('Asignarme la tarea', String(permisos.usuario_id)));
                selectorResponsable.value = String(permisos.usuario_id);
            }

            dialogo.showModal();
            document.getElementById('nueva-tarea-historia').focus();
        } catch (errorCarga) {
            error.textContent = mensajeError(errorCarga, 'No se pudo preparar la tarea. Revisa tu conexión e inténtalo de nuevo.');
            error.hidden = false;
            dialogo.showModal();
        }
    });

    formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        if (botonGuardar.disabled) return;

        const historiaId = Number(selectorHistoria.value);
        const responsableId = Number(selectorResponsable.value);
        const titulo = document.getElementById('nueva-tarea-titulo').value.trim();
        const descripcion = document.getElementById('nueva-tarea-descripcion').value.trim();
        const horas = Number(document.getElementById('nueva-tarea-horas').value);
        if (!historiaId || !titulo || !responsableId || !Number.isFinite(horas) || horas <= 0 ||
            horas > 99999.9 || Math.abs(horas * 10 - Math.round(horas * 10)) > 1e-8) {
            error.textContent = 'Completa la historia, el título, la persona responsable y las horas estimadas (máximo un decimal).';
            error.hidden = false;
            return;
        }

        error.hidden = true;
        botonGuardar.disabled = true;
        botonGuardar.textContent = 'Guardando…';
        try {
            await api('/tareas', {
                metodo: 'POST',
                cuerpo: {
                    historia_id: historiaId,
                    titulo,
                    descripcion,
                    responsable_id: responsableId,
                    horas_estimadas: horas,
                },
            });
            dialogo.close();
            document.dispatchEvent(new CustomEvent('tablero:recargar'));
        } catch (errorGuardado) {
            error.textContent = mensajeError(errorGuardado, 'No se pudo crear la tarea. Revisa los datos e inténtalo de nuevo.');
            error.hidden = false;
        } finally {
            botonGuardar.disabled = false;
            botonGuardar.textContent = 'Crear tarea';
        }
    });
}
