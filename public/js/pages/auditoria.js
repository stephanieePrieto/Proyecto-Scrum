// Responsable: Citlaly - HU-46: logica de la pantalla de bitacora de auditoria (llama a la API)
/**
 * @file auditoria.js
 * @description Lógica de la pantalla de bitácora de auditoría. Consulta y muestra los registros de auditoría.
 * Incluye actualización en tiempo real mediante Socket.io.
 *
 * @author Citlaly Morales Viveros
 */

import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml } from '../core/utils.js';
import { resolverProyecto, conectarTiempoReal } from '../pages/ceremonias/proyecto.js';
import { cargarPermisos, escucharCambiosDeRol } from '../core/permisos-ui.js';

// Insertar la barra superior de navegación
montarBarraSuperior();

// Referenciar los elementos de la página
const el = {
    selectorProyecto: document.getElementById('selector-proyecto'),
    aviso: document.getElementById('aviso'),
    filtroUsuario: document.getElementById('filtro-usuario'),
    filtroAccion: document.getElementById('filtro-accion'),
    filtroFechaDesde: document.getElementById('filtro-fecha-desde'),
    filtroFechaHasta: document.getElementById('filtro-fecha-hasta'),
    btnBuscar: document.getElementById('btn-buscar'),
    btnLimpiar: document.getElementById('btn-limpiar'),
    totalRegistros: document.getElementById('total-registros'),
    tablaCuerpo: document.getElementById('tabla-cuerpo'),
    mensajeVacia: document.getElementById('mensaje-vacia'),
    paginacion: document.getElementById('paginacion'),
    paginacionInfo: document.getElementById('paginacion-info'),
    btnAnterior: document.getElementById('btn-anterior'),
    btnSiguiente: document.getElementById('btn-siguiente'),
};

// Estado de la pantalla
const ctx = {
    proyectoId: null,
    proyectos: [],
    usuarios: [],
    acciones: [],
    paginaActual: 1,
    limite: 50,
    total: 0,
    cargando: false,
};

/**
 * Catálogo de acciones de auditoría disponibles.
 */
const ACCIONES_AUDITORIA = [
    'proyecto_creado', 'proyecto_modificado', 'proyecto_archivado',
    'sprint_creado', 'sprint_iniciado', 'sprint_cerrado',
    'historia_creada', 'historia_modificada', 'historia_eliminada',
    'historia_estado_cambiado', 'historia_propuesta_aceptada', 'historia_propuesta_rechazada',
    'epica_creada', 'epica_modificada', 'epica_eliminada',
    'tarea_creada', 'tarea_modificada', 'tarea_eliminada', 'tarea_movida',
    'tablero_configurado',
    'impedimento_creado', 'impedimento_resuelto',
    'invitacion_creada', 'invitacion_aceptada', 'invitacion_rechazada', 'invitacion_cancelada', 'invitacion_reenviada',
    'rol_proyecto_asignado', 'rol_proyecto_modificado', 'rol_proyecto_retirado',
];

/**
 * Mostrar un aviso general arriba de la pantalla (o ocultarlo si no hay texto).
 *
 * @param {'exito'|'error'|'advertencia'|''} tono
 * @param {string} texto
 * @returns {void}
 */
function mostrarAviso(tono, texto) {
    el.aviso.hidden = !texto;
    el.aviso.className = `alerta alerta--${tono || 'advertencia'}`;
    el.aviso.textContent = texto;
}

/**
 * Dar formato legible a una fecha ISO.
 *
 * @param {string} iso
 * @returns {string}
 */
function formatearFecha(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Obtener el nombre de usuario a partir de su ID.
 *
 * @param {number} usuarioId
 * @returns {string}
 */
function obtenerNombreUsuario(usuarioId) {
    const usuario = ctx.usuarios.find(u => u.id === usuarioId);
    return usuario ? usuario.nombre : 'Usuario desconocido';
}

/**
 * Obtener el nombre legible de una acción.
 *
 * @param {string} accion
 * @returns {string}
 */
function obtenerNombreAccion(accion) {
    const mapeo = {
        'proyecto_creado': 'Proyecto creado',
        'proyecto_modificado': 'Proyecto modificado',
        'proyecto_archivado': 'Proyecto archivado',
        'sprint_creado': 'Sprint creado',
        'sprint_iniciado': 'Sprint iniciado',
        'sprint_cerrado': 'Sprint cerrado',
        'historia_creada': 'Historia creada',
        'historia_modificada': 'Historia modificada',
        'historia_eliminada': 'Historia eliminada',
        'historia_estado_cambiado': 'Estado de historia cambiado',
        'historia_propuesta_aceptada': 'Propuesta aceptada',
        'historia_propuesta_rechazada': 'Propuesta rechazada',
        'epica_creada': 'Épica creada',
        'epica_modificada': 'Épica modificada',
        'epica_eliminada': 'Épica eliminada',
        'tarea_creada': 'Tarea creada',
        'tarea_modificada': 'Tarea modificada',
        'tarea_eliminada': 'Tarea eliminada',
        'tarea_movida': 'Tarea movida',
        'tablero_configurado': 'Tablero configurado',
        'impedimento_creado': 'Impedimento creado',
        'impedimento_resuelto': 'Impedimento resuelto',
        'invitacion_creada': 'Invitación creada',
        'invitacion_aceptada': 'Invitación aceptada',
        'invitacion_rechazada': 'Invitación rechazada',
        'invitacion_cancelada': 'Invitación cancelada',
        'invitacion_reenviada': 'Invitación reenviada',
        'rol_proyecto_asignado': 'Rol asignado',
        'rol_proyecto_modificado': 'Rol modificado',
        'rol_proyecto_retirado': 'Rol retirado',
    };
    return mapeo[accion] || accion;
}

/**
 * Obtener el nombre legible de un objeto.
 *
 * @param {string} objeto
 * @returns {string}
 */
function obtenerNombreObjeto(objeto) {
    const mapeo = {
        'proyecto': 'Proyecto',
        'sprint': 'Sprint',
        'historia': 'Historia',
        'epica': 'Épica',
        'tarea': 'Tarea',
        'tablero': 'Tablero',
        'impedimento': 'Impedimento',
        'invitacion': 'Invitación',
    };
    return mapeo[objeto] || objeto;
}

/**
 * Formatear el detalle JSON para mostrarlo de forma legible.
 *
 * @param {Object|null} detalle
 * @returns {string}
 */
function formatearDetalle(detalle) {
    if (!detalle) return '—';
    try {
        const obj = typeof detalle === 'string' ? JSON.parse(detalle) : detalle;
        const entries = Object.entries(obj);
        if (entries.length === 0) return '—';
        return entries.map(([key, value]) => {
            const formattedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            return `${escaparHtml(key)}: ${escaparHtml(formattedValue)}`;
        }).join(', ');
    } catch {
        return escaparHtml(String(detalle));
    }
}

/**
 * Cargar los proyectos del usuario y resolver el proyecto activo.
 *
 * @returns {Promise<void>}
 */
async function cargarProyecto() {
    try {
        const { id, proyectos } = await resolverProyecto();
        ctx.proyectoId = id;
        ctx.proyectos = proyectos;

        if (!ctx.proyectoId) {
            mostrarAviso('advertencia', 'No tienes proyectos asignados.');
            return;
        }

        // Con el proyecto resuelto se cargan los permisos de la persona
        cargarPermisos(ctx.proyectoId).catch(() => { /* sin permisos conocidos, los botones restringidos siguen ocultos */ });
    } catch (error) {
        mostrarAviso('error', 'No se pudo cargar la lista de proyectos.');
        console.error('[auditoria] Error al cargar proyecto:', error);
    }
}

/**
 * Cargar los miembros del proyecto para el filtro de usuario.
 *
 * @returns {Promise<void>}
 */
async function cargarUsuarios() {
    if (!ctx.proyectoId) return;

    try {
        const respuesta = await api(`/miembros/proyecto/${ctx.proyectoId}`);
        // El endpoint devuelve { miembros: [...], matriz: {...}, ... }
        // miembros es un array de objetos con usuario_id, nombre, correo, activo, rol
        ctx.usuarios = respuesta.miembros || [];

        // Llenar el selector de usuarios
        const opciones = ctx.usuarios.map(u =>
            `<option value="${u.usuario_id}">${escaparHtml(u.nombre)} (${escaparHtml(u.rol)})</option>`
        );
        el.filtroUsuario.innerHTML = '<option value="">Todos los usuarios</option>' + opciones.join('');
    } catch (error) {
        console.error('[auditoria] Error al cargar usuarios:', error);
    }
}

/**
 * Cargar las acciones disponibles para el filtro.
 *
 * @returns {void}
 */
function cargarAcciones() {
    const opciones = ACCIONES_AUDITORIA.map(accion =>
        `<option value="${accion}">${escaparHtml(obtenerNombreAccion(accion))}</option>`
    );
    el.filtroAccion.innerHTML = '<option value="">Todas las acciones</option>' + opciones.join('');
}

/**
 * Inicializar la pantalla.
 *
 * @returns {Promise<void>}
 */
async function inicializar() {
    await cargarProyecto();
    cargarAcciones();

    if (ctx.proyectoId) {
        await cargarUsuarios();
        await consultarAuditoria();
    }
}

/**
 * Obtener los parámetros de los filtros.
 *
 * @returns {Object}
 */
function obtenerFiltros() {
    return {
        usuarioId: el.filtroUsuario.value,
        accion: el.filtroAccion.value,
        fechaDesde: el.filtroFechaDesde.value,
        fechaHasta: el.filtroFechaHasta.value,
    };
}

/**
 * Consultar los registros de auditoría.
 *
 * @param {number} [pagina=1] - Número de página.
 * @returns {Promise<void>}
 */
async function consultarAuditoria(pagina = 1) {
    if (!ctx.proyectoId) return;

    ctx.cargando = true;
    mostrarAviso('', '');

    // Actualizar estado de paginación
    ctx.paginaActual = Math.max(1, pagina || 1);

    const filtros = obtenerFiltros();
    const params = new URLSearchParams();

    if (filtros.usuarioId) params.set('usuarioId', filtros.usuarioId);
    if (filtros.accion) params.set('accion', filtros.accion);
    if (filtros.fechaDesde) params.set('fechaDesde', filtros.fechaDesde);
    if (filtros.fechaHasta) params.set('fechaHasta', filtros.fechaHasta);
    params.set('limite', String(ctx.limite));
    params.set('offset', String((ctx.paginaActual - 1) * ctx.limite));

    try {
        const respuesta = await api(
            `/auditoria/proyecto/${ctx.proyectoId}?${params.toString()}`,
            {
                metodo: 'GET',
                cuerpo: null,
            }
        );

        // Aplicar filtros cliente (el backend ya filtró, pero el selector de usuario necesita los datos)
        ctx.total = respuesta.total || 0;

        // Actualizar la tabla
        pintarResultados(respuesta.registros || []);

        // Actualizar información de paginación
        actualizarPaginacion();

    } catch (error) {
        if (error.estado === 403) {
            mostrarAviso('error', 'No tienes permiso para consultar la bitácora de auditoría. Solo el Scrum Master puede acceder.');
        } else if (error.estado === 404) {
            mostrarAviso('error', 'Proyecto no encontrado.');
        } else {
            mostrarAviso('error', 'No se pudo cargar la bitácora de auditoría.');
        }
        console.error('[auditoria] Error al consultar:', error);
        ctx.total = 0;
        pintarResultados([]);
        actualizarPaginacion();
    } finally {
        ctx.cargando = false;
    }
}

/**
 * Actualizar la información de paginación.
 *
 * @returns {void}
 */
function actualizarPaginacion() {
    const totalPaginas = ctx.total > 0 ? Math.ceil(ctx.total / ctx.limite) : 0;

    el.paginacionInfo.textContent = `Página ${ctx.paginaActual} de ${Math.max(1, totalPaginas)} (${ctx.total} registros)`;
    el.totalRegistros.textContent = `${ctx.total} ${ctx.total === 1 ? 'registro' : 'registros'}`;

    el.btnAnterior.disabled = ctx.paginaActual <= 1;
    el.btnSiguiente.disabled = ctx.paginaActual >= Math.max(1, totalPaginas) || ctx.total === 0;

    el.paginacion.hidden = ctx.total === 0;
    el.tablaCuerpo.parentElement.setAttribute('aria-busy', String(ctx.cargando));
}

/**
 * Pintar los resultados en la tabla.
 *
 * @param {Array} registros
 * @returns {void}
 */
function pintarResultados(registros) {
    if (registros.length === 0) {
        el.tablaCuerpo.innerHTML = '';
        el.mensajeVacia.hidden = false;
        return;
    }

    el.mensajeVacia.hidden = true;

    const filas = registros.map(registro => {
        const usuarioNombre = registro.usuarioNombre || obtenerNombreUsuario(registro.usuarioId);
        const detalleText = formatearDetalle(registro.detalle);

        return `
            <tr>
                <td>${formatearFecha(registro.creadoEn)}</td>
                <td>${escaparHtml(usuarioNombre)}</td>
                <td>${escaparHtml(obtenerNombreAccion(registro.accion))}</td>
                <td>${escaparHtml(obtenerNombreObjeto(registro.objeto))}${registro.objetoId ? ` (#${registro.objetoId})` : ''}</td>
                <td title="${escaparHtml(detalleText)}">${escaparHtml(detalleText.slice(0, 100))}${detalleText.length > 100 ? '...' : ''}</td>
            </tr>
        `;
    });

    el.tablaCuerpo.innerHTML = filas.join('');
}

function configurarEventos() {
    // Buscar
    el.btnBuscar.addEventListener('click', () => {
        consultarAuditoria(1);
    });

    // Limpiar filtros
    el.btnLimpiar.addEventListener('click', () => {
        el.filtroUsuario.value = '';
        el.filtroAccion.value = '';
        el.filtroFechaDesde.value = '';
        el.filtroFechaHasta.value = '';
        consultarAuditoria(1);
    });

    // Paginación
    el.btnAnterior.addEventListener('click', () => {
        if (ctx.paginaActual > 1) {
            consultarAuditoria(ctx.paginaActual - 1);
        }
    });

    el.btnSiguiente.addEventListener('click', () => {
        const totalPaginas = ctx.total > 0 ? Math.ceil(ctx.total / ctx.limite) : 0;
        if (ctx.paginaActual < Math.max(1, totalPaginas)) {
            consultarAuditoria(ctx.paginaActual + 1);
        }
    });

    // Permitir buscar con Enter en los filtros
    [el.filtroUsuario, el.filtroAccion, el.filtroFechaDesde, el.filtroFechaHasta].forEach(input => {
        input.addEventListener('change', () => {
            consultarAuditoria(1);
        });
    });
}

/**
 * Conectar a Socket.io para recibir actualizaciones en tiempo real cuando
 * se registren nuevas acciones en la bitácora.
 *
 * @returns {void}
 */
function conectarSocket() {
    if (!ctx.proyectoId || typeof window.io !== 'function') return;

    const socket = window.io();

    // Mantiene los permisos al día si cambia el rol de la persona
    escucharCambiosDeRol(socket);

    socket.on('connect', () => {
        socket.emit('unirse_proyecto', ctx.proyectoId);
    });

    // Escuchar eventos de auditoría
    socket.on('auditoria:nuevo_registro', (datos) => {
        if (datos.proyecto_id === ctx.proyectoId) {
            // Recargar la lista si estamos en la primera página o el filtro coincide
            const filtros = obtenerFiltros();
            const coincide = (
                (!filtros.usuarioId || filtros.usuarioId === String(datos.usuario_id)) &&
                (!filtros.accion || filtros.accion === datos.accion) &&
                (!filtros.fechaDesde || datos.creado_en >= filtros.fechaDesde) &&
                (!filtros.fechaHasta || datos.creado_en < `${filtros.fechaHasta}T23:59:59`)
            );

            if (ctx.paginaActual === 1 && coincide) {
                // Si estamos en la primera página, recargar para mostrar el nuevo registro
                consultarAuditoria(1);
            } else if (coincide) {
                // Si el registro coincide con los filtros, incrementar el total
                ctx.total++;
                actualizarPaginacion();
            }
        }
    });
}

// Inicializar al cargar la página
configurarEventos();
inicializar();

// Conectar Socket.io después de que el proyecto esté cargado
// Usar un pequeño delay para asegurar que ctx.proyectoId esté definido
setTimeout(() => {
    if (ctx.proyectoId) {
        conectarSocket();
    }
}, 500);
