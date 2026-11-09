// Responsable: Camila - HU-25: numero de version y aviso de conflicto
/**
 * @file concurrencia.js
 * @description Control de concurrencia optimista (HU-25): indicadores en tiempo real
 * "X está editando", envío de edición con versión base, cola offline de ediciones
 * y modal interactivo para resolver conflictos HTTP 409 (Conservar mía, Aceptar la suya, Fusionar).
 * @author Camila Mariné Crespo Zurita
 */

import { api } from '../../core/api.js';
import {
    obtenerVersionTarjeta,
    obtenerEstadoConfirmadoTarjeta,
    confirmarVersionTarjeta,
    aplicarEventoTarjetaConvergente
} from './convergencia.js';

const CLAVE_EDICIONES_OFFLINE = 'ediciones_pendientes_tarjeta';

const ETIQUETAS_CAMPOS = {
    titulo: 'Título',
    descripcion: 'Descripción',
    responsable_id: 'Responsable (ID)',
    horas_estimadas: 'Horas estimadas',
    etiquetas: 'Etiquetas'
};

const CAMPOS_EDITABLES = ['titulo', 'descripcion', 'responsable_id', 'horas_estimadas', 'etiquetas'];

/** Estado de la tarjeta que el usuario tiene abierta en el modal de edición. */
let sesionEdicionActual = null;

/** Estado del conflicto 409 actualmente visible en el modal de resolución. */
let conflictoActivo = null;

/**
 * Formatea un valor de campo para mostrarlo de forma legible en la tabla de conflictos.
 * @param {string} campo
 * @param {*} valor
 * @returns {string}
 */
function formatearValorCampo(campo, valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (campo === 'etiquetas') {
        const lista = Array.isArray(valor)
            ? valor
            : String(valor).split(',').map((s) => s.trim()).filter(Boolean);
        return lista.length ? lista.join(', ') : '—';
    }
    if (campo === 'horas_estimadas') {
        return `${valor} h`;
    }
    return String(valor);
}

/**
 * Normaliza un valor para comparar si dos versiones de un campo son equivalentes.
 * @param {string} campo
 * @param {*} valor
 * @returns {string}
 */
function valorComparable(campo, valor) {
    if (campo === 'etiquetas') {
        const arr = Array.isArray(valor)
            ? valor.map((e) => String(e).trim()).filter(Boolean)
            : String(valor ?? '').split(',').map((e) => e.trim()).filter(Boolean);
        return JSON.stringify(arr);
    }
    if (campo === 'horas_estimadas' || campo === 'responsable_id') {
        if (valor === null || valor === undefined || valor === '') return '';
        const n = Number(valor);
        return Number.isFinite(n) && n > 0 ? String(n) : '';
    }
    return String(valor ?? '').trim();
}

/**
 * Envía al servidor el aviso de que el usuario actual inició o terminó de editar una tarjeta.
 * @param {number|string} tareaId
 * @param {boolean} editando
 * @returns {Promise<void>}
 */
export async function notificarPresenciaEdicion(tareaId, editando) {
    const id = Number(tareaId);
    if (!Number.isInteger(id) || id <= 0 || !navigator.onLine) return;

    try {
        await api(`/tarjetas/${id}/editando`, {
            metodo: 'POST',
            cuerpo: { editando: Boolean(editando) }
        });
    } catch {
        // Si falla la red al avisar presencia, no interrumpe el trabajo del usuario
    }
}

/**
 * Construye el texto "X está editando" a partir de la lista de editores activos.
 * @param {Array<{usuarioId?: number, nombre: string}>} editores
 * @returns {string}
 */
export function formatearTextoEditores(editores = []) {
    if (!Array.isArray(editores) || editores.length === 0) return '';
    const nombres = editores.map((e) => e.nombre).filter(Boolean);
    if (nombres.length === 0) return '';
    if (nombres.length === 1) return `${nombres[0]} está editando...`;
    return `${nombres.join(', ')} están editando...`;
}

/**
 * Actualiza el indicador visual "X está editando" en la tarjeta del tablero
 * y en el encabezado del modal de edición si esa misma tarjeta está abierta.
 *
 * @param {number|string} tareaId
 * @param {Array<{usuarioId?: number, nombre: string}>} editores
 * @returns {void}
 */
export function pintarIndicadorEditando(tareaId, editores = []) {
    const id = Number(tareaId);
    const texto = formatearTextoEditores(editores);

    const badgeTarjeta = document.getElementById(`indicador-editando-${id}`);
    if (badgeTarjeta) {
        badgeTarjeta.textContent = texto;
        badgeTarjeta.hidden = !texto;
    }

    if (sesionEdicionActual && Number(sesionEdicionActual.tareaId) === id) {
        const avisoModal = document.getElementById('modal-editar-presencia');
        if (avisoModal) {
            avisoModal.textContent = texto;
            avisoModal.hidden = !texto;
        }
    }
}

/**
 * Muestra un aviso breve en la parte superior del tablero cuando ocurre una fusión automática
 * o una resolución de concurrencia.
 * @param {string} mensaje
 * @returns {void}
 */
export function mostrarAvisoConcurrenciaTablero(mensaje) {
    const banner = document.getElementById('aviso-concurrencia-tablero');
    if (!banner) return;
    banner.textContent = mensaje;
    banner.hidden = false;

    clearTimeout(banner._temporizador);
    banner._temporizador = setTimeout(() => {
        banner.hidden = true;
    }, 4500);
}

/**
 * Guarda una edición pendiente en localStorage cuando el usuario se queda sin conexión.
 * @param {Object} edicion
 * @returns {void}
 */
function guardarEdicionOffline(edicion) {
    const cola = JSON.parse(localStorage.getItem(CLAVE_EDICIONES_OFFLINE) || '[]');
    const filtrada = cola.filter((item) => Number(item.tareaId) !== Number(edicion.tareaId));
    filtrada.push(edicion);
    localStorage.setItem(CLAVE_EDICIONES_OFFLINE, JSON.stringify(filtrada));

    const elTarjeta = document.getElementById(`tarjeta-${edicion.tareaId}`);
    if (elTarjeta) {
        elTarjeta.classList.add('tarjeta-item--pendiente');
    }
}

/**
 * Abre el modal para editar los campos de una tarjeta registrando su versión base (HU-25).
 * @param {number|string} tareaId
 * @returns {Promise<void>}
 */
export async function abrirModalEditarTarjeta(tareaId) {
    const id = Number(tareaId);
    if (!Number.isInteger(id) || id <= 0) return;

    const modalOverlay = document.getElementById('overlay-editar-tarjeta');
    if (!modalOverlay) return;

    let datosTarjeta = obtenerEstadoConfirmadoTarjeta(id);

    if (navigator.onLine) {
        try {
            const res = await api(`/tarjetas/${id}`);
            const recibida = res?.data?.tarea || res?.datos?.tarea;
            if (recibida) {
                datosTarjeta = recibida;
                confirmarVersionTarjeta(id, recibida.version, recibida);
            }
        } catch (error) {
            console.warn('[HU-25] Usando copia local de la tarjeta para edición:', error);
        }
    }

    if (!datosTarjeta) return;

    const base = {
        titulo: datosTarjeta.titulo || '',
        descripcion: datosTarjeta.descripcion || '',
        responsable_id: datosTarjeta.responsable_id ?? null,
        horas_estimadas: datosTarjeta.horas_estimadas ?? null,
        etiquetas: Array.isArray(datosTarjeta.etiquetas) ? [...datosTarjeta.etiquetas] : []
    };

    sesionEdicionActual = {
        tareaId: id,
        version: Number(datosTarjeta.version) || obtenerVersionTarjeta(id),
        base
    };

    const inputTitulo = document.getElementById('editar-tarjeta-titulo');
    const inputDescripcion = document.getElementById('editar-tarjeta-descripcion');
    const inputHoras = document.getElementById('editar-tarjeta-horas');
    const inputEtiquetas = document.getElementById('editar-tarjeta-etiquetas');
    const selectResponsable = document.getElementById('editar-tarjeta-responsable');
    const etiquetaVersion = document.getElementById('editar-tarjeta-version');
    const errorModal = document.getElementById('editar-tarjeta-error');

    if (inputTitulo) inputTitulo.value = base.titulo;
    if (inputDescripcion) inputDescripcion.value = base.descripcion;
    if (inputHoras) inputHoras.value = base.horas_estimadas !== null ? String(base.horas_estimadas) : '';
    if (inputEtiquetas) inputEtiquetas.value = base.etiquetas.join(', ');
    if (etiquetaVersion) etiquetaVersion.textContent = `v${sesionEdicionActual.version}`;
    if (errorModal) {
        errorModal.textContent = '';
        errorModal.hidden = true;
    }

    // Poblar selector de responsable tomando las opciones del filtro del tablero
    if (selectResponsable) {
        const filtroPersona = document.getElementById('filtro-persona');
        selectResponsable.replaceChildren();
        const opSinAsignar = document.createElement('option');
        opSinAsignar.value = '';
        opSinAsignar.textContent = 'Sin asignar';
        selectResponsable.appendChild(opSinAsignar);

        if (filtroPersona) {
            Array.from(filtroPersona.options).forEach((op) => {
                if (!op.value) return;
                const nuevaOp = document.createElement('option');
                nuevaOp.value = op.value;
                nuevaOp.textContent = op.textContent;
                selectResponsable.appendChild(nuevaOp);
            });
        }
        selectResponsable.value = base.responsable_id ? String(base.responsable_id) : '';
    }

    pintarIndicadorEditando(id, datosTarjeta.editores || []);
    modalOverlay.classList.remove('modal--hidden');
    await notificarPresenciaEdicion(id, true);
}

/**
 * Cierra el modal de edición de tarjeta y libera el indicador "X está editando".
 * @returns {Promise<void>}
 */
export async function cerrarModalEditarTarjeta() {
    const modalOverlay = document.getElementById('overlay-editar-tarjeta');
    if (modalOverlay) {
        modalOverlay.classList.add('modal--hidden');
    }
    if (sesionEdicionActual?.tareaId) {
        const id = sesionEdicionActual.tareaId;
        sesionEdicionActual = null;
        await notificarPresenciaEdicion(id, false);
    }
}

/**
 * Lee los valores capturados actualmente en el formulario de edición de tarjeta.
 * @returns {Object}
 */
function leerValoresFormularioEdicion() {
    const titulo = document.getElementById('editar-tarjeta-titulo')?.value.trim() || '';
    const descripcion = document.getElementById('editar-tarjeta-descripcion')?.value.trim() || '';
    const horasVal = document.getElementById('editar-tarjeta-horas')?.value.trim() || '';
    const respVal = document.getElementById('editar-tarjeta-responsable')?.value || '';
    const etiquetasVal = document.getElementById('editar-tarjeta-etiquetas')?.value || '';

    return {
        titulo,
        descripcion,
        responsable_id: respVal ? Number(respVal) : null,
        horas_estimadas: horasVal ? Number(horasVal) : null,
        etiquetas: etiquetasVal.split(',').map((e) => e.trim()).filter(Boolean)
    };
}

/**
 * Envía los cambios de una tarjeta al servidor con control de versión optimista (HU-25).
 * Si la versión cambió y hay colisión en el mismo campo, abre el modal de resolución 409.
 *
 * @param {number|string} tareaId
 * @param {Object} cambios
 * @param {{version?: number, base?: Object|null, forzar?: boolean}} [opciones={}]
 * @returns {Promise<boolean>} `true` si se guardó; `false` si quedó pendiente o en conflicto.
 */
export async function guardarEdicionTarjeta(tareaId, cambios, { version, base = null, forzar = false } = {}) {
    const id = Number(tareaId);
    const versionEnviada = Number(version) || sesionEdicionActual?.version || obtenerVersionTarjeta(id);
    const baseEnviada = base || sesionEdicionActual?.base || null;

    if (!navigator.onLine) {
        guardarEdicionOffline({
            tareaId: id,
            cambios,
            version: versionEnviada,
            base: baseEnviada
        });
        await cerrarModalEditarTarjeta();
        mostrarAvisoConcurrenciaTablero('Sin conexión: tus cambios se guardaron localmente y se revisarán al reconectar.');
        return false;
    }

    try {
        const respuesta = await api(`/tarjetas/${id}`, {
            metodo: 'PUT',
            cuerpo: {
                ...cambios,
                version: versionEnviada,
                base: baseEnviada,
                forzar: Boolean(forzar)
            }
        });

        const resultado = respuesta?.data || respuesta?.datos || {};
        const tareaActualizada = resultado.tarea;

        if (tareaActualizada) {
            aplicarEventoTarjetaConvergente({
                tareaId: id,
                version: tareaActualizada.version,
                tarea: tareaActualizada
            });
        }

        await cerrarModalEditarTarjeta();
        cerrarModalConflictoTarjeta();

        if (resultado.fusionadoAutomaticamente) {
            mostrarAvisoConcurrenciaTablero('Cambios fusionados automáticamente con otra edición reciente.');
        } else {
            mostrarAvisoConcurrenciaTablero('Tarjeta actualizada correctamente.');
        }

        return true;
    } catch (error) {
        if (error?.estado === 409 && error?.cuerpo?.detalles) {
            abrirModalConflictoTarjeta({
                ...error.cuerpo.detalles,
                tareaId: id,
                propuestaCliente: cambios,
                base: baseEnviada
            });
            return false;
        }

        const errorModal = document.getElementById('editar-tarjeta-error');
        if (errorModal) {
            errorModal.textContent = error?.cuerpo?.mensaje || 'No se pudo guardar la tarjeta.';
            errorModal.hidden = false;
        }
        return false;
    }
}

/**
 * Abre el modal interactivo "Esta tarjeta cambió" para que el usuario decida entre
 * "Conservar mía", "Aceptar la suya" o "Fusionar" permitiendo ver y elegir cada campo (HU-25).
 *
 * @param {Object} detalles
 * @returns {void}
 */
export function abrirModalConflictoTarjeta(detalles) {
    const overlayConflicto = document.getElementById('overlay-conflicto-tarjeta');
    const cuerpoTabla = document.getElementById('tabla-conflicto-cuerpo');
    if (!overlayConflicto || !cuerpoTabla) return;

    conflictoActivo = detalles;
    cuerpoTabla.replaceChildren();

    const mia = detalles.propuestaCliente || {};
    const suya = detalles.actual || {};
    const base = detalles.base || {};

    CAMPOS_EDITABLES.forEach((campo) => {
        const igualEntreAmbas = valorComparable(campo, mia[campo]) === valorComparable(campo, suya[campo]);
        if (igualEntreAmbas) return;

        const fila = document.createElement('tr');
        fila.classList.add('conflicto-fila');
        fila.dataset.campo = campo;

        const celdaCampo = document.createElement('th');
        celdaCampo.scope = 'row';
        celdaCampo.classList.add('conflicto-celda', 'conflicto-celda--campo');
        celdaCampo.textContent = ETIQUETAS_CAMPOS[campo] || campo;

        // decidir cuál preseleccionar para la fusión asistida:
        // si el usuario cambió el campo respecto a su base, se preselecciona "mia"; si no, "suya"
        const clienteLoModifico = base && Object.prototype.hasOwnProperty.call(base, campo)
            ? valorComparable(campo, mia[campo]) !== valorComparable(campo, base[campo])
            : true;

        const celdaMia = document.createElement('td');
        celdaMia.classList.add('conflicto-celda');
        const labelMia = document.createElement('label');
        labelMia.classList.add('conflicto-opcion');
        const radioMia = document.createElement('input');
        radioMia.type = 'radio';
        radioMia.name = `conflicto-eleccion-${campo}`;
        radioMia.value = 'mia';
        radioMia.checked = clienteLoModifico;
        const textoMia = document.createElement('span');
        textoMia.textContent = formatearValorCampo(campo, mia[campo]);
        labelMia.appendChild(radioMia);
        labelMia.appendChild(textoMia);
        celdaMia.appendChild(labelMia);

        const celdaSuya = document.createElement('td');
        celdaSuya.classList.add('conflicto-celda');
        const labelSuya = document.createElement('label');
        labelSuya.classList.add('conflicto-opcion');
        const radioSuya = document.createElement('input');
        radioSuya.type = 'radio';
        radioSuya.name = `conflicto-eleccion-${campo}`;
        radioSuya.value = 'suya';
        radioSuya.checked = !clienteLoModifico;
        const textoSuya = document.createElement('span');
        textoSuya.textContent = formatearValorCampo(campo, suya[campo]);
        labelSuya.appendChild(radioSuya);
        labelSuya.appendChild(textoSuya);
        celdaSuya.appendChild(labelSuya);

        fila.appendChild(celdaCampo);
        fila.appendChild(celdaMia);
        fila.appendChild(celdaSuya);
        cuerpoTabla.appendChild(fila);
    });

    overlayConflicto.classList.remove('modal--hidden');
}

/**
 * Cierra el modal de conflicto de versión.
 * @returns {void}
 */
export function cerrarModalConflictoTarjeta() {
    const overlayConflicto = document.getElementById('overlay-conflicto-tarjeta');
    if (overlayConflicto) {
        overlayConflicto.classList.add('modal--hidden');
    }
    conflictoActivo = null;
}

/**
 * Revisa y envía las ediciones de tarjetas que quedaron pendientes mientras el usuario
 * estuvo sin conexión, verificando posibles conflictos antes de guardar (HU-25).
 *
 * @returns {Promise<void>}
 */
export async function sincronizarEdicionesPendientes() {
    const cola = JSON.parse(localStorage.getItem(CLAVE_EDICIONES_OFFLINE) || '[]');
    if (!Array.isArray(cola) || cola.length === 0 || !navigator.onLine) return;

    const restantes = [];

    for (const item of cola) {
        try {
            const ok = await guardarEdicionTarjeta(item.tareaId, item.cambios, {
                version: item.version,
                base: item.base,
                forzar: false
            });
            const elTarjeta = document.getElementById(`tarjeta-${item.tareaId}`);
            if (elTarjeta) elTarjeta.classList.remove('tarjeta-item--pendiente');

            // Si saltó un conflicto 409, detenemos la cola para que el usuario resuelva el modal
            if (!ok && conflictoActivo) {
                break;
            }
        } catch {
            restantes.push(item);
        }
    }

    localStorage.setItem(CLAVE_EDICIONES_OFFLINE, JSON.stringify(restantes));
}

/**
 * Registra los eventos de los botones del modal de edición y del modal de conflictos 409.
 * @returns {void}
 */
export function iniciarControlConcurrencia() {
    const formEditar = document.getElementById('form-editar-tarjeta');
    const btnCancelarEditar = document.getElementById('btn-cancelar-editar-tarjeta');
    const btnConservarMia = document.getElementById('btn-conflicto-conservar-mia');
    const btnAceptarSuya = document.getElementById('btn-conflicto-aceptar-suya');
    const btnFusionar = document.getElementById('btn-conflicto-fusionar');
    const btnCerrarConflicto = document.getElementById('btn-conflicto-cerrar');

    if (btnCancelarEditar) {
        btnCancelarEditar.addEventListener('click', () => {
            cerrarModalEditarTarjeta();
        });
    }

    if (formEditar) {
        formEditar.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!sesionEdicionActual) return;
            const cambios = leerValoresFormularioEdicion();
            await guardarEdicionTarjeta(sesionEdicionActual.tareaId, cambios, {
                version: sesionEdicionActual.version,
                base: sesionEdicionActual.base,
                forzar: false
            });
        });
    }

    // Opción 1: Conservar mía
    if (btnConservarMia) {
        btnConservarMia.addEventListener('click', async () => {
            if (!conflictoActivo) return;
            const { tareaId, propuestaCliente, versionServidor } = conflictoActivo;
            await guardarEdicionTarjeta(tareaId, propuestaCliente, {
                version: versionServidor,
                forzar: true
            });
        });
    }

    // Opción 2: Aceptar la suya
    if (btnAceptarSuya) {
        btnAceptarSuya.addEventListener('click', async () => {
            if (!conflictoActivo) return;
            const { tareaId, actual, versionServidor } = conflictoActivo;
            if (actual) {
                aplicarEventoTarjetaConvergente({
                    tareaId,
                    version: versionServidor || actual.version,
                    tarea: actual
                });
            }
            cerrarModalConflictoTarjeta();
            await cerrarModalEditarTarjeta();
            mostrarAvisoConcurrenciaTablero('Se aplicó la versión guardada en el servidor.');
        });
    }

    // Opción 3: Fusionar (combina los campos según la selección de la tabla comparativa)
    if (btnFusionar) {
        btnFusionar.addEventListener('click', async () => {
            if (!conflictoActivo) return;
            const { tareaId, propuestaCliente = {}, actual = {}, versionServidor } = conflictoActivo;
            const fusion = {};

            CAMPOS_EDITABLES.forEach((campo) => {
                const radioElegido = document.querySelector(`input[name="conflicto-eleccion-${campo}"]:checked`);
                if (radioElegido) {
                    fusion[campo] = radioElegido.value === 'mia' ? propuestaCliente[campo] : actual[campo];
                } else {
                    fusion[campo] = propuestaCliente[campo] !== undefined ? propuestaCliente[campo] : actual[campo];
                }
            });

            await guardarEdicionTarjeta(tareaId, fusion, {
                version: versionServidor,
                forzar: true
            });
        });
    }

    if (btnCerrarConflicto) {
        btnCerrarConflicto.addEventListener('click', () => {
            cerrarModalConflictoTarjeta();
        });
    }
}