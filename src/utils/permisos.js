// BASE (no modificar sin avisar al equipo) - HU-42: tabla de que rol puede hacer que accion

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
 * Roles de miembros_proyecto que pueden gestionar un proyecto. El esquema ya no tiene la columna
 * es_admin en miembros_proyecto, así que la gestión se deriva del rol. Para incluir también al
 * Product Owner basta con agregar 'product_owner' a esta lista.
 *
 * @type {string[]}
 */
const ROLES_GESTION_PROYECTO = ['scrum_master'];

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
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function esAdminGlobal(usuario, cliente = pool) {
    if (!usuario?.id) return false;
    const { rows } = await cliente.query('SELECT es_admin FROM usuarios WHERE id = $1 AND activo = TRUE', [usuario.id]);
    return rows[0]?.es_admin === true;
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
 * Un usuario ve un equipo si es administrador global o integrante de él.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeVerEquipo(usuario, equipoId, cliente = pool) {
    return (await esAdminGlobal(usuario, cliente)) || (await esMiembroEquipo(usuario, equipoId, cliente));
}

/**
 * Un usuario gestiona un equipo si es administrador global o administrador de ese equipo.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} equipoId - Identificador del equipo.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeGestionarEquipo(usuario, equipoId, cliente = pool) {
    /**
     * miembros_equipo ya no guarda administradores por equipo: solo gestiona el administrador global.
     * equipoId se conserva en la firma para no romper a quienes ya llaman a esta función.
     */
    return esAdminGlobal(usuario, cliente);
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
 * Indica si el usuario activo es administrador del proyecto.
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
        WHERE m.proyecto_id = $1 AND m.usuario_id = $2 AND m.rol = ANY($3::text[]) AND u.activo = TRUE`,
        [proyectoId, usuario.id, ROLES_GESTION_PROYECTO],
    );
    return rows.length > 0;
}

/**
 * Un usuario gestiona un proyecto si es administrador global, administrador del proyecto
 * o administrador del equipo al que pertenece el proyecto.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function puedeGestionarProyecto(usuario, proyectoId, cliente = pool) {
    if (await esAdminGlobal(usuario, cliente)) return true;
    if (await esAdminProyecto(usuario, proyectoId, cliente)) return true;
    /** Ya no existe el administrador de equipo, así que no hay otra vía de gestión del proyecto. */
    return false;
}