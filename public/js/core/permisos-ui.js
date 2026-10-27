// Responsable: Citlaly - HU-42: oculta en pantalla lo que el rol no puede usar

import { api } from './api.js';

/**
 * @file permisos-ui.js
 * @description Oculta en la interfaz lo que el rol de la persona no autoriza. Los elementos se marcan en el
 * HTML con data-permiso="clave"; si llevan varias claves separadas por espacios, basta con tener una. La lista
 * de permisos llega del servidor para el proyecto abierto, de modo que la pantalla nunca decide por su cuenta.
 * Mientras no se conocen los permisos, o si no se pudieron obtener, los elementos marcados quedan ocultos.
 * Ocultar es solo comodidad visual: cada petición se vuelve a validar en el servidor.
 * @author Citlaly Morales Viveros
 */

// Atributo con el que cada pantalla marca los elementos que requieren un permiso
const ATRIBUTO = 'data-permiso';

// Tiempo mínimo entre consultas disparadas por rechazos o reconexiones, para no saturar al servidor
const ESPERA_MINIMA_MS = 1500;

// Permisos conocidos del proyecto abierto; sin datos todo lo marcado permanece oculto
let proyectoActual = null;
let estado = { usuarioId: null, rol: null, etiquetaRol: null, permisos: new Set(), cargado: false, sinAcceso: false };

let cargaEnCurso = null;
let ultimaCarga = 0;
let observador = null;

/**
 * Indicar si la persona tiene un permiso en el proyecto abierto.
 *
 * @param {string} clave - Clave de la matriz de permisos, por ejemplo "historia.gestionar".
 * @returns {boolean}
 */
export function tienePermiso(clave) {
    return estado.permisos.has(clave);
}

/**
 * Obtener el rol vigente de la persona en el proyecto abierto.
 *
 * @returns {string|null} "scrum_master", "product_owner", "developer" o null si no tiene rol.
 */
export function rolActual() {
    return estado.rol;
}

/**
 * Comprobar si un elemento marcado con data-permiso está autorizado.
 *
 * @param {Element} elemento - Elemento marcado.
 * @returns {boolean}
 */
function estaAutorizado(elemento) {
    const claves = (elemento.getAttribute(ATRIBUTO) || '').split(/\s+/).filter(Boolean);
    return claves.some(tienePermiso);
}

/**
 * Mostrar u ocultar un elemento. Se usa un estilo en línea y no el atributo "hidden", porque las clases de
 * botones y tarjetas definen su propio display y lo anularían; además se recuerda el display original.
 *
 * @param {HTMLElement} elemento - Elemento a mostrar u ocultar.
 * @param {boolean} visible - true para mostrarlo.
 * @returns {void}
 */
function alternarVisibilidad(elemento, visible) {
    const oculto = elemento.dataset.permisoOculto === 'true';
    if (visible && oculto) {
        elemento.style.removeProperty('display');
        if (elemento.dataset.permisoDisplay) elemento.style.setProperty('display', elemento.dataset.permisoDisplay);
        delete elemento.dataset.permisoOculto;
        delete elemento.dataset.permisoDisplay;
    } else if (!visible && !oculto) {
        elemento.dataset.permisoDisplay = elemento.style.getPropertyValue('display');
        elemento.dataset.permisoOculto = 'true';
        elemento.style.setProperty('display', 'none', 'important');
    }
}

/**
 * Mostrar en la barra superior el rol que la persona tiene en el proyecto abierto.
 * El rol es por proyecto, por eso se reemplaza el texto que la barra arma al montarse.
 *
 * @returns {void}
 */
function pintarRol() {
    if (!estado.cargado) return;
    const rol = document.querySelector('.barra-superior__usuario-rol');
    if (rol) rol.textContent = estado.sinAcceso ? '' : estado.etiquetaRol || 'Sin rol en el proyecto';
}

/**
 * Aplicar los permisos a los elementos marcados dentro de una raíz (toda la página por omisión).
 *
 * @param {Document|Element} [raiz=document] - Zona donde buscar elementos marcados.
 * @returns {void}
 */
export function aplicarPermisos(raiz = document) {
    const elementos = [...raiz.querySelectorAll(`[${ATRIBUTO}]`)];
    if (raiz.matches?.(`[${ATRIBUTO}]`)) elementos.unshift(raiz);
    elementos.forEach((elemento) => alternarVisibilidad(elemento, estaAutorizado(elemento)));
    pintarRol();
}

/**
 * Vigilar el documento para aplicar los permisos a lo que las pantallas agregan después de cargar,
 * como las tarjetas de una lista o los botones de un detalle.
 *
 * @returns {void}
 */
function observarCambios() {
    if (observador || typeof MutationObserver === 'undefined' || !document.body) return;
    observador = new MutationObserver((cambios) => {
        for (const cambio of cambios) {
            for (const nodo of cambio.addedNodes) {
                if (nodo.nodeType === Node.ELEMENT_NODE) aplicarPermisos(nodo);
            }
        }
    });
    observador.observe(document.body, { childList: true, subtree: true });
}

/**
 * Guardar los permisos recibidos, actualizar la interfaz y avisar a la página con el evento
 * "permisos:actualizados" para que vuelva a pintar lo que dependa del rol (por ejemplo, el arrastre).
 *
 * @param {Object|null} datos - Respuesta del servidor, o null cuando la persona no tiene acceso al proyecto.
 * @returns {void}
 */
function guardarPermisos(datos) {
    estado = {
        usuarioId: datos?.usuario_id ?? estado.usuarioId,
        rol: datos?.rol ?? null,
        etiquetaRol: datos?.etiqueta_rol ?? null,
        permisos: new Set(datos?.permisos ?? []),
        cargado: true,
        sinAcceso: datos === null,
    };
    aplicarPermisos();
    window.dispatchEvent(new CustomEvent('permisos:actualizados', {
        detail: { proyectoId: proyectoActual, rol: estado.rol, permisos: [...estado.permisos], sinAcceso: estado.sinAcceso },
    }));
}

/**
 * Consultar al servidor los permisos vigentes de la persona en un proyecto y aplicarlos a la página.
 * Si el servidor responde 403 o 404 se asume que ya no tiene acceso y se oculta todo lo marcado;
 * ante cualquier otro fallo se conservan los permisos anteriores y se vuelve a lanzar el error.
 *
 * @param {number|string} proyectoId - Identificador del proyecto abierto.
 * @returns {Promise<Object>} Rol y permisos recibidos del servidor.
 */
export function cargarPermisos(proyectoId) {
    const id = Number(proyectoId);
    if (!Number.isInteger(id) || id <= 0) return Promise.reject(new Error('El identificador del proyecto no es válido.'));
    if (cargaEnCurso && proyectoActual === id) return cargaEnCurso;

    if (proyectoActual !== id) estado = { ...estado, permisos: new Set(), cargado: false, sinAcceso: false };
    proyectoActual = id;
    aplicarPermisos();

    const consulta = (async () => {
        try {
            const datos = await api(`/miembros/proyecto/${id}/mis-permisos`);
            if (proyectoActual === id) guardarPermisos(datos);
            return datos;
        } catch (error) {
            if (proyectoActual === id && (error.estado === 403 || error.estado === 404)) guardarPermisos(null);
            throw error;
        } finally {
            ultimaCarga = Date.now();
            if (cargaEnCurso === consulta) cargaEnCurso = null;
        }
    })();
    cargaEnCurso = consulta;
    return consulta;
}

/**
 * Volver a consultar los permisos del proyecto abierto sin interrumpir la pantalla si falla.
 *
 * @param {boolean} [respetarEspera=false] - Omitir la consulta si se hizo una hace instantes.
 * @returns {Promise<void>}
 */
async function refrescarPermisos(respetarEspera = false) {
    if (proyectoActual === null) return;
    if (respetarEspera && Date.now() - ultimaCarga < ESPERA_MINIMA_MS) return;
    try {
        await cargarPermisos(proyectoActual);
    } catch (error) {
        console.error('No se pudieron actualizar los permisos', error);
    }
}

/**
 * Actualizar los permisos cuando el servidor avisa por socket que cambió el rol de la persona, y al
 * reconectarse, por si el aviso se perdió mientras estaba desconectada.
 *
 * @param {{on: function(string, function): void}} socket - Conexión de socket.io de la página.
 * @returns {void}
 */
export function escucharCambiosDeRol(socket) {
    socket.on('rol_cambiado', (datos) => {
        if (datos?.proyecto_id !== proyectoActual) return;
        if (estado.usuarioId !== null && datos.usuario_id !== estado.usuarioId) return;
        refrescarPermisos();
    });
    socket.on('connect', () => refrescarPermisos(true));
}

// Cuando el servidor rechaza una acción por permisos (api.js emite este evento), el rol pudo haber cambiado
window.addEventListener('permisos:rechazado', () => refrescarPermisos(true));

// Ocultar desde el inicio lo marcado, antes de conocer los permisos, y vigilar lo que se agregue después
aplicarPermisos();
if (document.body) observarCambios();
else document.addEventListener('DOMContentLoaded', () => { aplicarPermisos(); observarCambios(); });