// Responsable: Citlaly - HU-39, HU-40, HU-41: logica de la pantalla de equipos, roles y modal de invitar (llama a la API y escucha sockets)

/**
 * @file equipos.js
 * @description Página de equipos: lista los equipos visibles para la persona usuaria y permite
 * crearlos, renombrarlos, eliminarlos, agregar integrantes, cambiar administradores y quitar
 * integrantes resolviendo antes sus tareas abiertas y responsabilidades de Scrum. Los permisos
 * reales se validan en el servidor; la interfaz solo muestra lo que el servidor indica.
 * @author Citlaly Morales Viveros
 */
import { api } from '../core/api.js';
import { montarBarraSuperior } from '../core/layout.js';
import { escaparHtml, iniciales, pluralizar } from '../core/utils.js';
import { inicializarNotificaciones } from '../componentes/notificaciones.js';

const $ = (id) => document.getElementById(id);

const ETIQUETA_ROL = { product_owner: 'Product Owner', scrum_master: 'Scrum Master', developer: 'Developer' };
const ROLES_CLAVE = ['product_owner', 'scrum_master'];

// Insertar la barra superior; esto también crea el contenedor de la campana de notificaciones
montarBarraSuperior();

/**
 * Montar la campana de notificaciones en la barra superior sin bloquear la página si falla.
 * @returns {void}
 */
function montarNotificaciones() {
    try {
        const raiz = $('notificaciones-root');
        if (raiz) inicializarNotificaciones({ contenedor: raiz, socket: null });
    } catch (error) {
        console.error('[equipos] No se pudieron montar las notificaciones:', error);
    }
}
montarNotificaciones();

let equipos = [];
let puedeCrear = false;

/* Mensajes y errores */

/**
 * Mostrar el resultado de la última acción encima de la lista.
 * @param {'exito'|'advertencia'|'error'} tipo - Tono del mensaje.
 * @param {string|string[]} textos - Uno o varios párrafos.
 * @returns {void}
 */
function mostrarMensaje(tipo, textos) {
    const caja = $('equipos-mensaje');
    const lista = (Array.isArray(textos) ? textos : [textos]).filter(Boolean);
    caja.className = `eq-mensaje eq-mensaje--${tipo}`;
    caja.innerHTML = lista.map((texto) => `<p>${escaparHtml(texto)}</p>`).join('');
    caja.hidden = false;
    caja.scrollIntoView?.({ block: 'nearest' });
}

/** Ocultar el mensaje de resultado. */
function ocultarMensaje() {
    $('equipos-mensaje').hidden = true;
}

/**
 * Mostrar u ocultar un texto de error junto a un campo o al pie de un diálogo.
 * @param {string} id - Identificador del elemento de error.
 * @param {string} [texto] - Texto a mostrar; vacío para ocultarlo.
 * @returns {void}
 */
function ponerError(id, texto = '') {
    const elemento = $(id);
    elemento.textContent = texto;
    elemento.hidden = !texto;
}

/**
 * Obtener el texto legible de un error de la API.
 * @param {Error & {estado?: number, cuerpo?: {mensaje?: string}}} error - Error lanzado por api().
 * @returns {string}
 */
function textoError(error) {
    if (error?.cuerpo?.mensaje) return error.cuerpo.mensaje;
    if (error?.estado === 401) return 'Tu sesión terminó. Inicia sesión de nuevo.';
    if (error?.estado === 403) return 'No tienes permiso para realizar esta acción.';
    return 'No se pudo completar la operación. Inténtalo de nuevo.';
}

/* Lista de equipos */

/**
 * Generar la fila de un integrante con sus acciones, si la persona puede gestionar el equipo.
 * @param {Object} equipo - Equipo al que pertenece.
 * @param {Object} miembro - Integrante.
 * @returns {string} HTML de la fila.
 */
function filaMiembro(equipo, miembro) {
    const insignias = [
        miembro.activo ? '' : '<span class="insignia insignia--neutro">Inactivo</span>',
    ].join(' ');
    const datos = `data-equipo="${equipo.id}" data-usuario="${miembro.id}"`;
    const acciones = equipo.puede_gestionar
        ? `<button class="boton boton--secundario boton--pequeno eq-peligro" type="button" data-accion="quitar" ${datos}>Quitar</button>`
        : '';
    return `<li class="miembro">
    <span class="miembro__avatar" aria-hidden="true">${escaparHtml(iniciales(miembro.nombre))}</span>
    <div class="miembro__datos">
      <div class="miembro__nombre">${escaparHtml(miembro.nombre)} ${insignias}</div>
      <div class="miembro__correo">${escaparHtml(miembro.correo)}</div>
    </div>
    <div class="miembro__acciones">${acciones}</div>
  </li>`;
}

/**
 * Generar la tarjeta de un equipo.
 * @param {Object} equipo - Equipo con integrantes, advertencias y permiso de gestión.
 * @returns {string} HTML de la tarjeta.
 */
function tarjetaEquipo(equipo) {
    const integrantes = `${equipo.total_miembros} ${pluralizar(equipo.total_miembros, 'integrante', 'integrantes')}`;
    const proyectos = `${equipo.total_proyectos} ${pluralizar(equipo.total_proyectos, 'proyecto', 'proyectos')}`;
    const datos = `data-equipo="${equipo.id}"`;
    const acciones = equipo.puede_gestionar
        ? `<div class="equipo__acciones">
        <button class="boton boton--secundario boton--pequeno" type="button" data-accion="renombrar" ${datos}>Cambiar nombre</button>
        <button class="boton boton--secundario boton--pequeno" type="button" data-accion="agregar" ${datos}>Agregar integrantes</button>
        <button class="boton boton--secundario boton--pequeno eq-peligro" type="button" data-accion="eliminar" ${datos}>Eliminar</button>
      </div>`
        : '';
    const advertencias = equipo.advertencias
        .map((aviso) => `<p class="eq-mensaje eq-mensaje--advertencia">${escaparHtml(aviso.mensaje)}</p>`).join('');
    const filas = equipo.miembros.map((miembro) => filaMiembro(equipo, miembro)).join('')
        || '<li class="eq-resultados__vacio">Este equipo no tiene integrantes.</li>';

    return `<article class="tarjeta equipo">
    <div class="equipo__cabecera">
      <div>
        <h2 class="equipo__nombre">${escaparHtml(equipo.nombre)}</h2>
        <p class="equipo__meta">${integrantes} · ${proyectos}</p>
      </div>
      ${acciones}
    </div>
    ${advertencias}
    <ul class="equipo__miembros">${filas}</ul>
  </article>`;
}

/** Pintar la lista, o el estado vacío si la persona no tiene equipos. */
function pintar() {
    $('btn-nuevo-equipo').hidden = !puedeCrear;
    const lista = $('equipos-lista');
    if (!equipos.length) {
        lista.innerHTML = `<div class="aviso aviso--vacio">
      <h2 class="aviso__titulo">Aún no hay equipos</h2>
      <p class="aviso__texto">${puedeCrear ? 'Crea el primer equipo para empezar a trabajar en paralelo.' : 'Todavía no perteneces a ningún equipo.'}</p>
      ${puedeCrear ? '<button class="boton boton--primario" type="button" data-accion="nuevo">Crear equipo</button>' : ''}
    </div>`;
        return;
    }
    lista.innerHTML = equipos.map(tarjetaEquipo).join('');
}

/** Consultar los equipos al servidor, mostrando esqueletos mientras carga. */
async function cargar() {
    const lista = $('equipos-lista');
    lista.innerHTML = Array.from({ length: 2 }, () => `<article class="tarjeta equipo equipo--carga" aria-busy="true">
    <span class="esqueleto esqueleto--titulo"></span><span class="esqueleto esqueleto--linea"></span><span class="esqueleto esqueleto--linea"></span>
  </article>`).join('');
    try {
        const datos = await api('/equipos');
        equipos = datos.equipos;
        puedeCrear = datos.puede_crear;
        pintar();
    } catch (error) {
        $('btn-nuevo-equipo').hidden = true;
        lista.innerHTML = `<div class="tarjeta equipos__error" role="alert">
      <p>${escaparHtml(textoError(error))}</p>
      <button class="boton boton--secundario" type="button" data-accion="reintentar">Reintentar</button>
    </div>`;
    }
}

/* Crear, renombrar y agregar integrantes */

const dialogoEquipo = $('dialogo-equipo');
const elegidos = new Map();
let modo = 'crear';
let equipoEnEdicion = null;
let resultados = [];
let busqueda = null;
let temporizador = null;

/** Pintar los usuarios encontrados que todavía no se han elegido. */
function pintarResultados() {
    const disponibles = resultados.filter((usuario) => !elegidos.has(usuario.id));
    $('resultados-usuarios').innerHTML = disponibles.length
        ? disponibles.map((usuario) => `<li class="eq-resultado">
        <div><div class="eq-resultado__nombre">${escaparHtml(usuario.nombre)}</div><div class="eq-resultado__correo">${escaparHtml(usuario.correo)}</div></div>
        <button class="boton boton--secundario boton--pequeno" type="button" data-elegir="${usuario.id}">Agregar</button>
      </li>`).join('')
        : '<li class="eq-resultados__vacio">No se encontraron usuarios.</li>';
}

/** Pintar los usuarios elegidos como etiquetas que se pueden quitar. */
function pintarElegidos() {
    $('elegidos-usuarios').innerHTML = [...elegidos.values()].map((usuario) => `<li class="eq-chip">
    ${escaparHtml(usuario.nombre)}
    <button class="eq-chip__quitar" type="button" data-quitar-elegido="${usuario.id}" aria-label="Quitar a ${escaparHtml(usuario.nombre)}">×</button>
  </li>`).join('');
}

/** Buscar usuarios activos que se puedan agregar; cancela la búsqueda anterior si sigue en curso. */
async function buscarUsuarios() {
    busqueda?.abort();
    busqueda = new AbortController();
    const parametros = new URLSearchParams({ q: $('buscar-usuarios').value.trim() });
    if (modo === 'agregar') parametros.set('equipo_id', equipoEnEdicion.id);
    try {
        const datos = await api(`/equipos/usuarios-disponibles?${parametros}`, { signal: busqueda.signal });
        resultados = datos.usuarios;
        pintarResultados();
    } catch (error) {
        if (error.name === 'AbortError') return;
        $('resultados-usuarios').innerHTML = `<li class="eq-resultados__vacio">${escaparHtml(textoError(error))}</li>`;
    }
}

/**
 * Abrir el diálogo en uno de sus tres modos.
 * @param {'crear'|'renombrar'|'agregar'} nuevoModo - Acción a realizar.
 * @param {Object|null} [equipo] - Equipo sobre el que se actúa (renombrar y agregar).
 * @returns {void}
 */
function abrirDialogoEquipo(nuevoModo, equipo = null) {
    modo = nuevoModo;
    equipoEnEdicion = equipo;
    elegidos.clear();
    resultados = [];
    $('equipo-titulo').textContent = {
        crear: 'Nuevo equipo',
        renombrar: 'Cambiar nombre del equipo',
        agregar: `Agregar integrantes a «${equipo?.nombre ?? ''}»`,
    }[modo];
    $('campo-nombre').hidden = modo === 'agregar';
    $('seccion-miembros').hidden = modo === 'renombrar';
    $('nota-creador').hidden = modo !== 'crear';
    $('equipo-nombre').value = modo === 'renombrar' ? equipo.nombre : '';
    $('buscar-usuarios').value = '';
    ['error-nombre', 'error-miembros', 'error-equipo'].forEach((id) => ponerError(id));
    $('resultados-usuarios').innerHTML = '';
    pintarElegidos();
    $('equipo-guardar').disabled = false;
    dialogoEquipo.showModal();
    if (modo !== 'renombrar') buscarUsuarios();
    ($('campo-nombre').hidden ? $('buscar-usuarios') : $('equipo-nombre')).focus();
}

/**
 * Guardar según el modo del diálogo y mostrar el resultado, incluidas las advertencias de tamaño
 * que devuelve el servidor una vez guardado el equipo.
 * @param {SubmitEvent} evento - Envío del formulario.
 * @returns {Promise<void>}
 */
async function guardarEquipo(evento) {
    evento.preventDefault();
    ['error-nombre', 'error-miembros', 'error-equipo'].forEach((id) => ponerError(id));
    const nombre = $('equipo-nombre').value.trim();
    const miembros = [...elegidos.keys()];

    if (modo !== 'agregar' && !nombre) return ponerError('error-nombre', 'Escribe el nombre del equipo.');
    if (modo === 'agregar' && !miembros.length) return ponerError('error-miembros', 'Selecciona al menos un usuario.');

    $('equipo-guardar').disabled = true;
    try {
        const id = equipoEnEdicion?.id;
        const peticion = {
            crear: ['/equipos', { metodo: 'POST', cuerpo: { nombre, miembros } }],
            renombrar: [`/equipos/${id}`, { metodo: 'PUT', cuerpo: { nombre } }],
            agregar: [`/equipos/${id}/miembros`, { metodo: 'POST', cuerpo: { miembros } }],
        }[modo];
        const { equipo } = await api(...peticion);
        dialogoEquipo.close();
        await cargar();
        const exito = {
            crear: `Equipo «${equipo.nombre}» creado.`,
            renombrar: 'El nombre del equipo se actualizó.',
            agregar: `Integrantes agregados a «${equipo.nombre}».`,
        }[modo];
        mostrarMensaje(equipo.advertencias.length ? 'advertencia' : 'exito', [exito, ...equipo.advertencias.map((a) => a.mensaje)]);
    } catch (error) {
        const campos = error?.cuerpo?.detalles?.campos;
        if (campos?.nombre) ponerError('error-nombre', campos.nombre);
        if (campos?.miembros) ponerError('error-miembros', campos.miembros);
        if (!campos?.nombre && !campos?.miembros) ponerError('error-equipo', textoError(error));
    } finally {
        $('equipo-guardar').disabled = false;
    }
}

/* Quitar integrantes */

const dialogoQuitar = $('dialogo-quitar');
let quitar = null;

/**
 * Rol que tiene un integrante restante en un proyecto, o null si no participa.
 * @param {number} usuarioId - Integrante restante.
 * @param {number} proyectoId - Proyecto.
 * @returns {string|null}
 */
function rolDe(usuarioId, proyectoId) {
    const candidato = quitar.pendientes.candidatos.find((c) => c.id === usuarioId);
    return candidato?.membresias.find((m) => m.proyecto_id === proyectoId)?.rol ?? null;
}

/**
 * Opciones del selector de personas para una tarea o para un rol de Scrum.
 * @param {number} proyectoId - Proyecto al que pertenece la tarea o el rol.
 * @param {'tarea'|'rol'} tipo - Para qué se elige a la persona.
 * @returns {string} HTML de las opciones.
 */
function opcionesCandidatos(proyectoId, tipo) {
    const opciones = quitar.pendientes.candidatos.map((candidato) => {
        const rol = rolDe(candidato.id, proyectoId);
        let nota;
        if (!rol) nota = tipo === 'tarea' ? 'se agregará al proyecto como Developer' : 'se agregará al proyecto con este rol';
        else if (tipo === 'rol' && rol === 'developer') nota = 'ya es Developer en este proyecto; cambiará su rol';
        else nota = `${ETIQUETA_ROL[rol]} en este proyecto`;
        return `<option value="${candidato.id}">${escaparHtml(candidato.nombre)} (${escaparHtml(nota)})</option>`;
    });
    return `<option value="">Elige a una persona</option>${opciones.join('')}`;
}

/** Pintar lo que hay que resolver antes de quitar al integrante y validar el estado inicial. */
function pintarPendientes() {
    const p = quitar.pendientes;
    const cantidad = p.proyectos.length;
    const bloques = [`<p>Vas a quitar a <strong>${escaparHtml(p.integrante.nombre)}</strong> del equipo «${escaparHtml(quitar.equipoNombre)}».${cantidad ? ` También se retirará su participación en ${cantidad} ${pluralizar(cantidad, 'proyecto', 'proyectos')} de este equipo` : ''
        }; sus otros equipos y proyectos no cambian.</p>`];

    if (p.tareas.length) {
        const filas = p.tareas.map((tarea) => {
            const sprint = tarea.sprint_nombre ? `${tarea.sprint_nombre} (${tarea.sprint_estado})` : 'Sin sprint';
            const detalle = [tarea.proyecto_nombre, sprint, tarea.columna_nombre ?? 'Sin columna', tarea.bloqueada ? 'Bloqueada' : ''].filter(Boolean).join(' · ');
            return `<div class="eq-fila" data-fila-tarea="${tarea.id}">
        <div><div class="eq-fila__titulo">${escaparHtml(tarea.titulo)}</div><div class="eq-fila__detalle">${escaparHtml(detalle)}</div></div>
        <select class="eq-select" data-tarea="${tarea.id}" aria-label="Responsable de la tarea ${escaparHtml(tarea.titulo)}">${opcionesCandidatos(tarea.proyecto_id, 'tarea')}</select>
        <p class="eq-fila__aviso" hidden></p>
      </div>`;
        }).join('');
        bloques.push(`<div class="eq-bloque">
      <p class="eq-bloque__titulo">Tareas abiertas (${p.tareas.length})</p>
      <p class="eq-fila__detalle">Elige quién se encargará de cada una. Las tareas terminadas y las de sprints cerrados se conservan como historial.</p>
      ${filas}
    </div>`);
    }

    if (p.roles.length) {
        const filas = p.roles.map((rol) => {
            if (!rol.requiere_reemplazo) {
                return `<p class="eq-fila__detalle">«${escaparHtml(rol.proyecto_nombre)}»: el proyecto conserva otro Scrum Master, no hace falta transferir el rol.</p>`;
            }
            return `<div class="eq-fila" data-fila-rol="${rol.proyecto_id}">
        <div><div class="eq-fila__titulo">${escaparHtml(rol.proyecto_nombre)}</div>
          <div class="eq-fila__detalle">Era ${ETIQUETA_ROL[rol.rol]}. Elige a quien asumirá el rol.</div></div>
        <select class="eq-select" data-rol="${rol.proyecto_id}" aria-label="Reemplazo como ${ETIQUETA_ROL[rol.rol]} en ${escaparHtml(rol.proyecto_nombre)}">${opcionesCandidatos(rol.proyecto_id, 'rol')}</select>
        <p class="eq-fila__aviso" hidden></p>
        <label class="eq-confirmar" hidden><input type="checkbox" data-confirmar="${rol.proyecto_id}" /> Confirmo que su rol de Developer cambiará a ${ETIQUETA_ROL[rol.rol]}.</label>
      </div>`;
        }).join('');
        bloques.push(`<div class="eq-bloque"><p class="eq-bloque__titulo">Responsabilidades de Scrum</p>${filas}</div>`);
    }

    if (!p.requiere_resolucion) bloques.push('<p>No hay tareas ni responsabilidades pendientes de resolver.</p>');
    $('quitar-contenido').innerHTML = bloques.join('');
    revalidarQuitar();
}

/**
 * Mostrar u ocultar el aviso de una fila.
 * @param {HTMLElement} elemento - Párrafo de aviso.
 * @param {string} texto - Texto del aviso; vacío para ocultarlo.
 * @returns {void}
 */
function ponerAviso(elemento, texto) {
    elemento.textContent = texto;
    elemento.hidden = !texto;
}

/**
 * Comprobar las elecciones hechas, avisar de los conflictos y habilitar la confirmación
 * solo cuando todo está resuelto. El servidor vuelve a validar todo al guardar.
 * @returns {void}
 */
function revalidarQuitar() {
    const p = quitar.pendientes;
    const contenido = $('quitar-contenido');
    const nombreDe = (id) => p.candidatos.find((c) => c.id === id)?.nombre ?? '';
    const reemplazos = new Map();
    let valido = true;

    for (const rol of p.roles.filter((r) => r.requiere_reemplazo)) {
        const fila = contenido.querySelector(`[data-fila-rol="${rol.proyecto_id}"]`);
        const elegido = Number(fila.querySelector('[data-rol]').value) || null;
        const caja = fila.querySelector('.eq-confirmar');
        let aviso = '';
        let pedirConfirmacion = false;
        if (!elegido) {
            valido = false;
        } else {
            const actual = rolDe(elegido, rol.proyecto_id);
            if (actual && actual !== 'developer' && actual !== rol.rol) {
                aviso = `${nombreDe(elegido)} ya es ${ETIQUETA_ROL[actual]} en este proyecto. Elige a otra persona.`;
                valido = false;
            } else if (actual === 'developer') {
                pedirConfirmacion = true;
                if (!caja.querySelector('input').checked) valido = false;
            }
            reemplazos.set(rol.proyecto_id, { usuario_id: elegido, rol: rol.rol });
        }
        caja.hidden = !pedirConfirmacion;
        ponerAviso(fila.querySelector('.eq-fila__aviso'), aviso);
    }

    for (const tarea of p.tareas) {
        const fila = contenido.querySelector(`[data-fila-tarea="${tarea.id}"]`);
        const elegido = Number(fila.querySelector('[data-tarea]').value) || null;
        let aviso = '';
        if (!elegido) {
            valido = false;
        } else {
            const promovido = reemplazos.get(tarea.proyecto_id);
            const rolFinal = promovido?.usuario_id === elegido ? promovido.rol : rolDe(elegido, tarea.proyecto_id);
            if (ROLES_CLAVE.includes(rolFinal)) {
                aviso = `${nombreDe(elegido)} es ${ETIQUETA_ROL[rolFinal]} en este proyecto. Elige a otra persona o resuelve ese rol por separado.`;
                valido = false;
            }
        }
        ponerAviso(fila.querySelector('.eq-fila__aviso'), aviso);
    }

    $('quitar-confirmar').disabled = !valido;
}

/** Consultar al servidor lo pendiente de resolver y pintarlo. */
async function cargarPendientes() {
    try {
        const { pendientes } = await api(`/equipos/${quitar.equipoId}/miembros/${quitar.usuarioId}/pendientes`);
        quitar.pendientes = pendientes;
        pintarPendientes();
    } catch (error) {
        $('quitar-contenido').innerHTML = '';
        ponerError('quitar-error', textoError(error));
    }
}

/**
 * Abrir el diálogo para quitar a un integrante.
 * @param {Object} equipo - Equipo.
 * @param {number} usuarioId - Integrante que saldría.
 * @returns {Promise<void>}
 */
async function abrirQuitar(equipo, usuarioId) {
    quitar = { equipoId: equipo.id, usuarioId, equipoNombre: equipo.nombre, pendientes: null };
    $('quitar-contenido').innerHTML = '<p>Revisando tareas y responsabilidades…</p>';
    ponerError('quitar-error');
    $('quitar-confirmar').disabled = true;
    dialogoQuitar.showModal();
    await cargarPendientes();
}

/** Enviar las decisiones al servidor, que las valida de nuevo y aplica todo en una sola transacción. */
async function confirmarQuitar() {
    const p = quitar.pendientes;
    const contenido = $('quitar-contenido');
    const cuerpo = {
        reasignaciones: p.tareas.map((tarea) => ({
            tarea_id: tarea.id,
            usuario_id: Number(contenido.querySelector(`[data-tarea="${tarea.id}"]`).value),
        })),
        transferencias: p.roles.filter((r) => r.requiere_reemplazo).map((rol) => ({
            proyecto_id: rol.proyecto_id,
            usuario_id: Number(contenido.querySelector(`[data-rol="${rol.proyecto_id}"]`).value),
            confirmar_cambio_rol: contenido.querySelector(`[data-confirmar="${rol.proyecto_id}"]`).checked,
        })),
    };

    ponerError('quitar-error');
    $('quitar-confirmar').disabled = true;
    try {
        const respuesta = await api(`/equipos/${quitar.equipoId}/miembros/${quitar.usuarioId}/quitar`, { metodo: 'POST', cuerpo });
        dialogoQuitar.close();
        await cargar();
        const textos = [`${p.integrante.nombre} salió del equipo «${quitar.equipoNombre}».`];
        if (respuesta.reasignadas) textos.push(`Se reasignaron ${respuesta.reasignadas} ${pluralizar(respuesta.reasignadas, 'tarea', 'tareas')}.`);
        const advertencias = (respuesta.equipo?.advertencias ?? []).map((a) => a.mensaje);
        mostrarMensaje(advertencias.length ? 'advertencia' : 'exito', [...textos, ...advertencias]);
    } catch (error) {
        const motivo = error?.cuerpo?.detalles?.motivo;
        // Si algo cambió mientras se decidía, volver a consultar lo pendiente antes de mostrar el aviso
        if (motivo === 'cambio_concurrente' || motivo === 'pendientes_sin_resolver') await cargarPendientes();
        ponerError('quitar-error', textoError(error));
    }
}

/* Eliminar equipos */

const dialogoEliminar = $('dialogo-eliminar');
let equipoAEliminar = null;

/**
 * Abrir el diálogo de eliminación. Si el equipo tiene proyectos solo informa el motivo del bloqueo.
 * @param {Object} equipo - Equipo.
 * @returns {void}
 */
function abrirEliminar(equipo) {
    equipoAEliminar = equipo;
    ponerError('eliminar-error');
    const nombre = escaparHtml(equipo.nombre);
    const proyectos = equipo.total_proyectos;
    if (proyectos > 0) {
        $('eliminar-contenido').innerHTML = `<div class="eq-mensaje eq-mensaje--error">
      <p>No se puede eliminar «${nombre}» porque tiene ${proyectos} ${pluralizar(proyectos, 'proyecto asociado', 'proyectos asociados')} (incluidos los archivados).</p>
      <p>Ningún proyecto se elimina de forma automática.</p></div>`;
        $('eliminar-confirmar').hidden = true;
    } else {
        const miembros = equipo.total_miembros;
        const invitaciones = equipo.invitaciones_pendientes;
        $('eliminar-contenido').innerHTML = `<p>¿Eliminar el equipo «${nombre}»? Esta acción no se puede deshacer.</p>
      <div class="eq-mensaje eq-mensaje--advertencia" style="margin-top: 12px">
        <p>También se eliminarán sus ${miembros} ${pluralizar(miembros, 'membresía', 'membresías')} y ${invitaciones} ${pluralizar(invitaciones, 'invitación pendiente', 'invitaciones pendientes')}.</p></div>`;
        $('eliminar-confirmar').hidden = false;
        $('eliminar-confirmar').disabled = false;
    }
    dialogoEliminar.showModal();
}

/** Eliminar el equipo; el servidor vuelve a comprobar que no tenga proyectos. */
async function confirmarEliminar() {
    ponerError('eliminar-error');
    $('eliminar-confirmar').disabled = true;
    try {
        await api(`/equipos/${equipoAEliminar.id}`, { metodo: 'DELETE' });
        dialogoEliminar.close();
        await cargar();
        mostrarMensaje('exito', `Equipo «${equipoAEliminar.nombre}» eliminado.`);
    } catch (error) {
        ponerError('eliminar-error', textoError(error));
        if (error?.cuerpo?.detalles?.motivo === 'tiene_proyectos') await cargar();
        $('eliminar-confirmar').disabled = false;
    }
}

/* Eventos */

$('btn-nuevo-equipo').addEventListener('click', () => { ocultarMensaje(); abrirDialogoEquipo('crear'); });

$('equipos-lista').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton) return;
    const equipo = equipos.find((e) => e.id === Number(boton.dataset.equipo));
    const usuarioId = Number(boton.dataset.usuario);
    const accion = boton.dataset.accion;
    if (accion === 'reintentar') return cargar();
    ocultarMensaje();
    if (accion === 'nuevo') return abrirDialogoEquipo('crear');
    if (!equipo) return undefined;
    if (accion === 'renombrar') return abrirDialogoEquipo('renombrar', equipo);
    if (accion === 'agregar') return abrirDialogoEquipo('agregar', equipo);
    if (accion === 'eliminar') return abrirEliminar(equipo);
    if (accion === 'quitar') return abrirQuitar(equipo, usuarioId);
    return undefined;
});

$('form-equipo').addEventListener('submit', guardarEquipo);
$('equipo-cancelar').addEventListener('click', () => dialogoEquipo.close());
$('buscar-usuarios').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(buscarUsuarios, 250);
});
$('resultados-usuarios').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-elegir]');
    const usuario = boton && resultados.find((u) => u.id === Number(boton.dataset.elegir));
    if (!usuario) return;
    elegidos.set(usuario.id, usuario);
    ponerError('error-miembros');
    pintarElegidos();
    pintarResultados();
});
$('elegidos-usuarios').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-quitar-elegido]');
    if (!boton) return;
    elegidos.delete(Number(boton.dataset.quitarElegido));
    pintarElegidos();
    pintarResultados();
});

$('quitar-contenido').addEventListener('change', revalidarQuitar);
$('quitar-cancelar').addEventListener('click', () => dialogoQuitar.close());
$('quitar-confirmar').addEventListener('click', confirmarQuitar);

$('eliminar-cancelar').addEventListener('click', () => dialogoEliminar.close());
$('eliminar-confirmar').addEventListener('click', confirmarEliminar);

cargar();