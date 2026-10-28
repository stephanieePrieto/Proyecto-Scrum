// BASE (no modificar sin avisar al equipo) - HU-42: revisa membresia y rol por proyecto (lo escribe Citlaly)

/**
 * @file permisos.js
 * @description Comprobaciones de permisos centralizadas. Todas consultan la base de datos y no el
 * token, de modo que un cambio de administrador o de estado de la cuenta surte efecto de inmediato.
 * Cada función acepta opcionalmente el cliente de una transacción para consultar dentro de ella.
 * @author Citlaly Morales Viveros
 */
import { pool } from '../config/db.js';
import { ErrorApp } from './ErrorApp.js';

/**
 * Indica si la cuenta del usuario existe y está activa.
 *
 * @param {{id: number}} usuario - Usuario autenticado (req.user).
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esUsuarioActivo(usuario, cliente = pool) {
    if (!usuario?.id) return false;
    const { rows } = await cliente.query('SELECT 1 FROM usuarios WHERE id = $1 AND activo = TRUE', [usuario.id]);
    return rows.length > 0;
}

/**
 * Indica si el usuario es administrador global de la plataforma.
 * @deprecated La plataforma ya no tiene administrador global: el rol existe solo dentro de cada proyecto.
 * Se conserva para no romper a quien aún la importe y siempre devuelve false.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esAdminGlobal(usuario, cliente = pool) {
    return false;
}

/**
 * Indica si el usuario activo pertenece al equipo.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esMiembroEquipo(usuario, equipoId, cliente = pool) {
    if (!usuario?.id) return false;
    const { rows } = await cliente.query(
        `SELECT 1 FROM miembros_equipo m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.equipo_id = $1 AND m.usuario_id = $2 AND u.activo = TRUE`,
        [equipoId, usuario.id],
    );
    return rows.length > 0;
}

/**
 * Indica si el usuario activo puede administrar el equipo: lo creó o es Scrum Master de alguno
 * de sus proyectos no archivados.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esAdminEquipo(usuario, equipoId, cliente = pool) {
    if (!usuario?.id) return false;
    const { rows } = await cliente.query(
        `SELECT 1 FROM usuarios u
        WHERE u.id = $2 AND u.activo = TRUE
            AND (EXISTS (SELECT 1 FROM equipos e WHERE e.id = $1 AND e.creado_por = u.id)
            OR EXISTS (SELECT 1 FROM miembros_proyecto mp JOIN proyectos p ON p.id = mp.proyecto_id
                        WHERE p.equipo_id = $1 AND p.archivado = FALSE AND mp.usuario_id = u.id AND mp.rol = 'scrum_master'))`,
        [equipoId, usuario.id],
    );
    return rows.length > 0;
}

/**
 * Un usuario ve un equipo si es integrante de él o puede administrarlo.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeVerEquipo(usuario, equipoId, cliente = pool) {
    return (await esMiembroEquipo(usuario, equipoId, cliente)) || (await esAdminEquipo(usuario, equipoId, cliente));
}

/**
 * Un usuario gestiona un equipo si lo creó o es Scrum Master de alguno de sus proyectos.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeGestionarEquipo(usuario, equipoId, cliente = pool) {
    return esAdminEquipo(usuario, equipoId, cliente);
}

/**
 * Lanza un error 403 si el usuario no puede gestionar el equipo.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<void>}
 */
export async function exigirGestionEquipo(usuario, equipoId, cliente = pool) {
    if (!(await puedeGestionarEquipo(usuario, equipoId, cliente))) {
        throw new ErrorApp('No tienes permiso para gestionar este equipo.', 403);
    }
}

/**
 * Indica si el usuario activo es Scrum Master del proyecto.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esAdminProyecto(usuario, proyectoId, cliente = pool) {
    if (!usuario?.id) return false;
    const { rows } = await cliente.query(
        `SELECT 1 FROM miembros_proyecto m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.proyecto_id = $1 AND m.usuario_id = $2 AND m.rol = 'scrum_master' AND u.activo = TRUE`,
        [proyectoId, usuario.id],
    );
    return rows.length > 0;
}

/**
 * Un usuario gestiona un proyecto si es Scrum Master del proyecto
 * o creó el equipo al que pertenece el proyecto.
 * También lo gestiona quien creó el proyecto, para que pueda asignar los roles iniciales.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeGestionarProyecto(usuario, proyectoId, cliente = pool) {
    if (await esAdminProyecto(usuario, proyectoId, cliente)) return true;
    const { rows } = await cliente.query(
        `SELECT 1 FROM proyectos p JOIN equipos e ON e.id = p.equipo_id
        JOIN usuarios u ON u.id = $2
        WHERE p.id = $1 AND u.activo = TRUE AND (e.creado_por = u.id OR p.creado_por = u.id)`,
        [proyectoId, usuario?.id],
    );
    return rows.length > 0;
}

/**
 * Roles que existen dentro de un proyecto. Corresponden a los valores de miembros_proyecto.rol.
 */
export const ROLES = Object.freeze({
    SCRUM_MASTER: 'scrum_master',
    PRODUCT_OWNER: 'product_owner',
    DEVELOPER: 'developer',
});

const { SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER } = ROLES;

/** Mensaje cuando el proyecto o el recurso no existe o la persona no tiene ningún vínculo con él. */
export const MENSAJE_NO_ENCONTRADO = 'No se encontró el recurso solicitado.';

/**
 * Define un permiso de la matriz.
 *
 * @param {string} descripcion - Acción que autoriza, redactada para completar "No tienes permiso para ...".
 * @param {string[]} roles - Roles del proyecto que pueden realizarla.
 * @param {Object} [extras] - Quién más puede realizarla además de los roles indicados.
 * @param {boolean} [extras.incluyeCreador=false] - Quien creó el proyecto o su equipo, aunque aún no tenga
 * rol asignado (necesario para repartir los roles iniciales).
 * @param {boolean} [extras.incluyeEquipo=false] - Los integrantes del equipo dueño del proyecto aunque no
 * tengan rol en él (solo para acciones de consulta).
 * @returns {Readonly<{descripcion: string, roles: readonly string[], incluyeCreador: boolean, incluyeEquipo: boolean}>}
 */
const definirPermiso = (descripcion, roles, { incluyeCreador = false, incluyeEquipo = false } = {}) =>
    Object.freeze({ descripcion, roles: Object.freeze([...roles]), incluyeCreador, incluyeEquipo });

/**
 * Matriz de permisos por rol dentro de un proyecto. Cada clave se usa en las rutas con requierePermiso.
 */
export const PERMISOS = Object.freeze({
    'proyecto.ver': definirPermiso('ver este proyecto', [SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER], { incluyeEquipo: true }),
    'historia.proponer': definirPermiso('proponer historias en el backlog', [SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER]),
    'historia.gestionar': definirPermiso('crear, editar, eliminar o reordenar historias', [SCRUM_MASTER, PRODUCT_OWNER]),
    'tarea.gestionar': definirPermiso('crear o editar tareas y mover tarjetas', [SCRUM_MASTER, PRODUCT_OWNER, DEVELOPER]),
    'sprint.gestionar': definirPermiso('planificar, iniciar o cerrar sprints', [SCRUM_MASTER]),
    'review.decidir': definirPermiso('aceptar o rechazar historias en la review', [PRODUCT_OWNER]),
    'proyecto.gestionar': definirPermiso('gestionar miembros, invitaciones o la configuración del proyecto', [SCRUM_MASTER], { incluyeCreador: true }),
    'tablero.configurar': definirPermiso('configurar las columnas del tablero', [SCRUM_MASTER]),
    'auditoria.ver': definirPermiso('consultar la auditoría del proyecto', [SCRUM_MASTER]),
});

/**
 * Obtiene el rol vigente del usuario activo dentro del proyecto, consultando siempre la base de datos.
 *
 * @param {{id: number}} usuario - Usuario autenticado (req.user).
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<string|null>} Rol del usuario en el proyecto, o null si no pertenece a él o su cuenta está inactiva.
 */
export async function obtenerRolProyecto(usuario, proyectoId, cliente = pool) {
    if (!usuario?.id) return null;
    const { rows } = await cliente.query(
        `SELECT m.rol FROM miembros_proyecto m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.proyecto_id = $1 AND m.usuario_id = $2 AND u.activo = TRUE`,
        [proyectoId, usuario.id],
    );
    return rows[0]?.rol ?? null;
}

/**
 * Indica si el usuario activo pertenece al equipo dueño del proyecto, tenga o no rol en el proyecto.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esMiembroEquipoDeProyecto(usuario, proyectoId, cliente = pool) {
    const { rows } = await cliente.query('SELECT equipo_id FROM proyectos WHERE id = $1', [proyectoId]);
    return rows.length > 0 && esMiembroEquipo(usuario, rows[0].equipo_id, cliente);
}

/**
 * Obtiene la definición de un permiso de la matriz.
 *
 * @param {string} clave - Clave del permiso, por ejemplo 'historia.gestionar'.
 * @returns {{descripcion: string, roles: readonly string[], incluyeCreador: boolean, incluyeEquipo: boolean}}
 * @throws {Error} Si la clave no existe en la matriz.
 */
function obtenerPermiso(clave) {
    const permiso = PERMISOS[clave];
    if (!permiso) throw new Error(`El permiso "${clave}" no existe en la matriz de permisos.`);
    return permiso;
}

/**
 * Evalúa un permiso para el usuario en un proyecto con el rol que tiene en ese momento.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {string} clave - Clave del permiso.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} cliente - Pool o cliente de una transacción.
 * @returns {Promise<{permitido: boolean, rol: string|null}>}
 */
async function evaluarPermiso(usuario, clave, proyectoId, cliente) {
    const permiso = obtenerPermiso(clave);
    const rol = await obtenerRolProyecto(usuario, proyectoId, cliente);
    if (rol && permiso.roles.includes(rol)) return { permitido: true, rol };
    if (permiso.incluyeCreador && (await puedeGestionarProyecto(usuario, proyectoId, cliente))) {
        return { permitido: true, rol };
    }
    if (permiso.incluyeEquipo && (await esMiembroEquipoDeProyecto(usuario, proyectoId, cliente))) {
        return { permitido: true, rol };
    }
    return { permitido: false, rol };
}

/**
 * Indica si el usuario tiene el permiso en el proyecto según su rol actual.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {string} clave - Clave del permiso, definida en PERMISOS.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function tienePermiso(usuario, clave, proyectoId, cliente = pool) {
    return (await evaluarPermiso(usuario, clave, proyectoId, cliente)).permitido;
}

/**
 * Lanza un error si el usuario no tiene el permiso en el proyecto.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {string} clave - Clave del permiso, definida en PERMISOS.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<string|null>} Rol del usuario en el proyecto (null si el permiso se concedió por ser creador
 * o integrante del equipo sin rol en el proyecto).
 * @throws {ErrorApp} 401 si la cuenta ya no está activa; 403 si la persona está vinculada al proyecto pero su rol
 * no permite la acción; 404 si el proyecto no existe o no tiene ningún vínculo con él, para no revelar que existe.
 */
export async function exigirPermiso(usuario, clave, proyectoId, cliente = pool) {
    const { permitido, rol } = await evaluarPermiso(usuario, clave, proyectoId, cliente);
    if (permitido) return rol;
    if (!rol && !(await esUsuarioActivo(usuario, cliente))) {
        throw new ErrorApp('Tu cuenta ya no está activa. Inicia sesión de nuevo.', 401);
    }
    const vinculado =
        rol !== null ||
        (await esMiembroEquipoDeProyecto(usuario, proyectoId, cliente)) ||
        (await puedeGestionarProyecto(usuario, proyectoId, cliente));
    if (!vinculado) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    throw new ErrorApp(`No tienes permiso para ${PERMISOS[clave].descripcion}.`, 403);
}

/**
 * @description Alias temporal para compatibilidad con módulos existentes.
 */
export async function permisosDeUsuario(usuario, proyectoId, cliente = pool) {
    return await obtenerRolProyecto(usuario, proyectoId, cliente);
}