// Responsable: Citlaly - HU-41, HU-43: reglas, SQL y avisos por socket (rol por proyecto y aislamiento de datos por equipo)

/**
 * @file miembros.service.js
 * @description Reglas de negocio de los roles por proyecto: consulta de la matriz de roles,
 * asignación, cambio y retiro del rol de Scrum Master, Product Owner o Developer. Cada rol rige
 * solo dentro del proyecto donde se asigna. Las operaciones se ejecutan en una transacción que
 * bloquea el proyecto, de modo que dos cambios simultáneos no puedan dejar dos Product Owners
 * ni quitar al último Scrum Master sin advertencia. Al confirmarse un cambio se registra en la
 * bitácora, se avisa por socket a quienes siguen el proyecto y se notifica a la persona afectada.
 * @author Citlaly Morales Viveros
 */
import { pool, consulta as query } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { puedeGestionarProyecto, puedeVerEquipo } from '../../utils/permisos.js';
import emisor from '../../sockets/emisor.js';

/** Roles válidos dentro de un proyecto, en el orden en que se muestran. */
export const ROLES = ['scrum_master', 'product_owner', 'developer'];

const ETIQUETA_ROL = {
    scrum_master: 'Scrum Master',
    product_owner: 'Product Owner',
    developer: 'Developer',
};

const AVISO_SIN_SCRUM_MASTER = 'El proyecto no tiene Scrum Master: no se podrán iniciar sprints hasta asignar uno.';

/* Utilidades internas */

/**
 * Lanza un ErrorApp con detalles opcionales para el cliente.
 *
 * @param {number} estado - Código HTTP.
 * @param {string} mensaje - Mensaje para la persona usuaria.
 * @param {Object} [detalles] - Datos estructurados (motivo, campos con error, etc.).
 * @throws {ErrorApp}
 */
function lanzar(estado, mensaje, detalles) {
    const error = new ErrorApp(mensaje, estado);
    if (detalles) error.detalles = detalles;
    throw error;
}

/**
 * Convierte un valor en entero positivo; devuelve null si no lo es.
 *
 * @param {*} valor - Valor recibido del cliente.
 * @returns {number|null}
 */
function aEntero(valor) {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/**
 * Ejecuta el trabajo dentro de una transacción: confirma si termina bien y revierte si falla.
 *
 * @param {(cliente: import('pg').PoolClient) => Promise<*>} trabajo - Función que recibe el cliente.
 * @returns {Promise<*>} Lo que devuelva el trabajo.
 */
async function enTransaccion(trabajo) {
    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');
        const resultado = await trabajo(cliente);
        await cliente.query('COMMIT');
        return resultado;
    } catch (error) {
        await cliente.query('ROLLBACK').catch(() => { });
        throw error;
    } finally {
        cliente.release();
    }
}

/**
 * Valida el identificador de un proyecto.
 *
 * @param {*} proyectoId - Valor recibido en la ruta.
 * @returns {number}
 */
function validarProyectoId(proyectoId) {
    const id = aEntero(proyectoId);
    if (!id) lanzar(400, 'El identificador del proyecto no es válido.');
    return id;
}

/**
 * Valida los identificadores de proyecto y de persona recibidos en la ruta.
 *
 * @param {*} proyectoId - Identificador del proyecto.
 * @param {*} usuarioId - Identificador de la persona.
 * @returns {{proyectoId: number, usuarioId: number}}
 */
function validarIds(proyectoId, usuarioId) {
    const proyecto = aEntero(proyectoId);
    const usuario = aEntero(usuarioId);
    if (!proyecto || !usuario) lanzar(400, 'Los identificadores enviados no son válidos.');
    return { proyectoId: proyecto, usuarioId: usuario };
}

/**
 * Comprueba que el rol enviado sea uno de los tres roles de Scrum.
 *
 * @param {*} rol - Rol recibido del cliente.
 * @returns {string}
 */
function validarRol(rol) {
    if (!ROLES.includes(rol)) {
        lanzar(400, 'Revisa los campos marcados.', { campos: { rol: 'Elige Scrum Master, Product Owner o Developer.' } });
    }
    return rol;
}

/**
 * Solo el administrador global puede asignar, cambiar o retirar roles de proyecto.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @param {number} proyectoId - Proyecto cuyos roles se gestionan.
 * @returns {Promise<void>}
 */
async function exigirGestionRoles(usuario, proyectoId) {
    if (!(await puedeGestionarProyecto(usuario, proyectoId))) {
        lanzar(403, 'Solo el Scrum Master del proyecto o quien creó el equipo puede gestionar sus roles.');
    }
}

/**
 * Carga los datos básicos del proyecto. Con bloqueo, el resto de cambios de rol del mismo
 * proyecto esperan a que termine la transacción actual.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @param {boolean} [bloquear=false] - Bloquea la fila del proyecto.
 * @returns {Promise<{id: number, nombre: string, equipo_id: number, archivado: boolean}>}
 */
async function cargarProyecto(proyectoId, cliente = pool, bloquear = false) {
    const { rows } = await cliente.query(
        `SELECT id, nombre, equipo_id, archivado FROM proyectos WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
        [proyectoId],
    );
    if (!rows.length) lanzar(404, 'Proyecto no encontrado.');
    return rows[0];
}

/**
 * Comprueba que la persona esté activa y pertenezca al equipo dueño del proyecto.
 *
 * @param {{equipo_id: number}} proyecto - Proyecto en el que se asignaría el rol.
 * @param {number} usuarioId - Persona a la que se asignaría el rol.
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @returns {Promise<{id: number, nombre: string}>}
 */
async function exigirPersonaDelEquipo(proyecto, usuarioId, cliente) {
    const { rows } = await cliente.query(
        `SELECT u.id, u.nombre FROM miembros_equipo m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.equipo_id = $1 AND m.usuario_id = $2 AND u.activo = TRUE`,
        [proyecto.equipo_id, usuarioId],
    );
    if (!rows.length) {
        lanzar(400, 'La persona no pertenece al equipo de este proyecto.', { motivo: 'no_es_del_equipo' });
    }
    return rows[0];
}

/**
 * Rol que tiene una persona en el proyecto, o null si no participa.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number} usuarioId - Identificador de la persona.
 * @param {import('pg').Pool|import('pg').PoolClient} cliente - Pool o cliente de una transacción.
 * @param {boolean} [bloquear=false] - Bloquea la fila de la participación.
 * @returns {Promise<string|null>}
 */
async function rolActual(proyectoId, usuarioId, cliente, bloquear = false) {
    const { rows } = await cliente.query(
        `SELECT rol FROM miembros_proyecto WHERE proyecto_id = $1 AND usuario_id = $2${bloquear ? ' FOR UPDATE' : ''}`,
        [proyectoId, usuarioId],
    );
    return rows[0]?.rol ?? null;
}

/**
 * Cuenta los Scrum Masters activos del proyecto, sin contar a una persona indicada.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number|null} excluirUsuarioId - Persona que no se cuenta (la que cambia de rol).
 * @param {import('pg').Pool|import('pg').PoolClient} cliente - Pool o cliente de una transacción.
 * @returns {Promise<number>}
 */
async function contarScrumMasters(proyectoId, excluirUsuarioId, cliente) {
    const { rows } = await cliente.query(
        `SELECT COUNT(*)::int AS total FROM miembros_proyecto m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.proyecto_id = $1 AND m.rol = 'scrum_master' AND u.activo = TRUE
        AND ($2::int IS NULL OR m.usuario_id <> $2)`,
        [proyectoId, excluirUsuarioId],
    );
    return rows[0].total;
}

/**
 * Impide que el proyecto tenga dos Product Owners: si ya existe otra persona con ese rol, responde 409.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number} usuarioId - Persona que recibiría el rol.
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @returns {Promise<void>}
 */
async function exigirSinOtroProductOwner(proyectoId, usuarioId, cliente) {
    const { rows } = await cliente.query(
        `SELECT u.id, u.nombre FROM miembros_proyecto m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.proyecto_id = $1 AND m.rol = 'product_owner' AND m.usuario_id <> $2`,
        [proyectoId, usuarioId],
    );
    if (rows.length) {
        lanzar(
            409,
            `El proyecto ya tiene un Product Owner (${rows[0].nombre}). Cambia o retira ese rol antes de asignar otro.`,
            { motivo: 'product_owner_duplicado', product_owner: rows[0] },
        );
    }
}

/**
 * Valida que se pueda dejar el rol de Scrum Master. Si la persona es el único Scrum Master, exige
 * confirmación explícita porque el proyecto no podrá iniciar sprints hasta asignar otro.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number} usuarioId - Scrum Master que dejaría el rol.
 * @param {boolean} confirmar - Indica si la persona que administra ya aceptó la advertencia.
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @returns {Promise<boolean>} true si el proyecto quedará sin Scrum Master.
 */
async function validarSalidaScrumMaster(proyectoId, usuarioId, confirmar, cliente) {
    if ((await contarScrumMasters(proyectoId, usuarioId, cliente)) > 0) return false;
    if (!confirmar) {
        lanzar(
            409,
            'El proyecto se quedará sin Scrum Master y no se podrán iniciar sprints hasta asignar uno. ¿Deseas continuar?',
            { motivo: 'requiere_confirmacion', advertencia: 'sin_scrum_master' },
        );
    }
    return true;
}

/* Validación reutilizable para el ciclo de sprints */

/**
 * Indica si el proyecto tiene al menos un Scrum Master activo.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<boolean>}
 */
export async function proyectoTieneScrumMaster(proyectoId, cliente = pool) {
    return (await contarScrumMasters(proyectoId, null, cliente)) > 0;
}

/**
 * Lanza un error 409 si el proyecto no tiene Scrum Master. Pensada para que el servicio que
 * inicia sprints la invoque antes de cambiar el estado del sprint.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {import('pg').Pool|import('pg').PoolClient} [cliente=pool] - Pool o cliente de una transacción.
 * @returns {Promise<void>}
 */
export async function exigirScrumMaster(proyectoId, cliente = pool) {
    if (!(await proyectoTieneScrumMaster(proyectoId, cliente))) {
        lanzar(409, 'No se puede iniciar el sprint porque el proyecto no tiene un Scrum Master asignado.', { motivo: 'sin_scrum_master' });
    }
}

/* Consulta de la matriz de roles */

/**
 * Arma la matriz de roles del proyecto: integrantes agrupados por rol, personas del equipo que
 * todavía no participan y el estado de los roles clave.
 *
 * @param {{id: number, nombre: string, equipo_id: number, archivado: boolean}} proyecto - Proyecto consultado.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>}
 */
async function armarMatriz(proyecto, usuario) {
    const { rows: miembros } = await query(
        `SELECT u.id AS usuario_id, u.nombre, u.correo, u.activo, mp.rol
            FROM miembros_proyecto mp JOIN usuarios u ON u.id = mp.usuario_id
        WHERE mp.proyecto_id = $1
        ORDER BY CASE mp.rol WHEN 'scrum_master' THEN 1 WHEN 'product_owner' THEN 2 ELSE 3 END, LOWER(u.nombre)`,
        [proyecto.id],
    );
    const puedeGestionar = await puedeGestionarProyecto(usuario, proyecto.id);
    const candidatos = puedeGestionar
        ? (await query(
            `SELECT u.id, u.nombre, u.correo FROM miembros_equipo me JOIN usuarios u ON u.id = me.usuario_id
            WHERE me.equipo_id = $1 AND u.activo = TRUE
            AND NOT EXISTS (SELECT 1 FROM miembros_proyecto mp WHERE mp.proyecto_id = $2 AND mp.usuario_id = u.id)
            ORDER BY LOWER(u.nombre)`,
            [proyecto.equipo_id, proyecto.id],
        )).rows
        : [];

    const matriz = Object.fromEntries(ROLES.map((rol) => [rol, miembros.filter((m) => m.rol === rol)]));
    return {
        proyecto: { id: proyecto.id, nombre: proyecto.nombre, equipo_id: proyecto.equipo_id, archivado: proyecto.archivado },
        miembros,
        matriz,
        candidatos,
        etiquetas: ETIQUETA_ROL,
        sin_scrum_master: !matriz.scrum_master.some((m) => m.activo),
        sin_product_owner: matriz.product_owner.length === 0,
        puede_gestionar: puedeGestionar,
    };
}

/**
 * Devuelve la matriz de roles de un proyecto. Quien no ve el equipo del proyecto recibe 404
 * para no revelar proyectos ajenos.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>}
 */
export async function listar(proyectoId, usuario) {
    const id = validarProyectoId(proyectoId);
    const proyecto = await cargarProyecto(id);
    if (!(await puedeVerEquipo(usuario, proyecto.equipo_id))) lanzar(404, 'Proyecto no encontrado.');
    return armarMatriz(proyecto, usuario);
}

/* Bitácora, tiempo real y notificaciones */

/**
 * Registra el cambio de rol en la bitácora dentro de la misma transacción del cambio, de modo
 * que no pueda existir un cambio sin su registro.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @param {{id: number}} actor - Quien realiza el cambio.
 * @param {{proyecto: Object, usuarioId: number, rolAnterior: string|null, rolNuevo: string|null}} cambio - Cambio realizado.
 * @returns {Promise<void>}
 */
async function registrarCambioRol(cliente, actor, { proyecto, usuarioId, rolAnterior, rolNuevo }) {
    const accion = !rolAnterior ? 'rol_proyecto_asignado' : !rolNuevo ? 'rol_proyecto_retirado' : 'rol_proyecto_modificado';
    await cliente.query(
        'INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle) VALUES ($1, $2, $3, $4, $5, $6)',
        [actor.id, proyecto.id, accion, 'proyecto', proyecto.id, JSON.stringify({ usuario_id: usuarioId, rol_anterior: rolAnterior, rol_nuevo: rolNuevo })],
    );
}

/**
 * Avisa por socket del cambio de rol. Va a la sala del proyecto y, si el servidor de sockets lo
 * ofrece, también a la sala personal de la persona afectada; cuando le retiran el rol se le saca
 * de la sala del proyecto. Un fallo aquí nunca deshace el cambio ya guardado.
 *
 * @param {{proyecto: Object, usuarioId: number, rolAnterior: string|null, rolNuevo: string|null, sinScrumMaster: boolean}} cambio - Cambio confirmado.
 * @returns {void}
 */
function propagarCambioRol({ proyecto, usuarioId, rolAnterior, rolNuevo, sinScrumMaster }) {
    const datos = {
        proyecto_id: proyecto.id,
        usuario_id: usuarioId,
        rol_anterior: rolAnterior,
        rol_nuevo: rolNuevo,
        sin_scrum_master: sinScrumMaster,
        cambiado_en: new Date().toISOString(),
    };
    try {
        emisor.emitirAProyecto(proyecto.id, 'rol_cambiado', datos);
        emisor.emitirAUsuario?.(usuarioId, 'rol_cambiado', datos);
        if (!rolNuevo) emisor.retirarDeProyecto?.(usuarioId, proyecto.id);
    } catch (error) {
        console.error('[miembros] No se pudo propagar el cambio de rol por socket:', error?.message ?? error);
    }
}

/**
 * Notifica a la persona afectada. Se invoca solo después de confirmar la transacción y un fallo
 * al notificar nunca interrumpe el cambio ya guardado.
 *
 * @param {{proyecto: Object, usuarioId: number, rolAnterior: string|null, rolNuevo: string|null}} cambio - Cambio confirmado.
 * @param {{id: number}} actor - Quien realizó el cambio.
 * @returns {Promise<void>}
 */
async function notificarCambioRol({ proyecto, usuarioId, rolAnterior, rolNuevo }, actor) {
    if (usuarioId === actor.id) return;
    let mensaje;
    if (!rolNuevo) mensaje = `Tu rol en el proyecto «${proyecto.nombre}» fue retirado.`;
    else if (!rolAnterior) mensaje = `Ahora eres ${ETIQUETA_ROL[rolNuevo]} en el proyecto «${proyecto.nombre}».`;
    else mensaje = `Tu rol en el proyecto «${proyecto.nombre}» cambió de ${ETIQUETA_ROL[rolAnterior]} a ${ETIQUETA_ROL[rolNuevo]}.`;

    try {
        const { notificar, TIPOS } = await import('../notificaciones/notificaciones.service.js');
        await notificar({
            usuarioId,
            tipo: TIPOS.ASIGNACION,
            titulo: 'Cambio de rol en el proyecto',
            mensaje,
            referenciaId: proyecto.id,
        });
    } catch (error) {
        console.error('[miembros] No se pudo enviar la notificación del cambio de rol:', error?.message ?? error);
    }
}

/**
 * Efectos posteriores a un cambio confirmado: aviso por socket y notificación.
 *
 * @param {Object} cambio - Cambio confirmado.
 * @param {{id: number}} actor - Quien realizó el cambio.
 * @returns {Promise<void>}
 */
async function publicarCambioRol(cambio, actor) {
    propagarCambioRol(cambio);
    await notificarCambioRol(cambio, actor);
}

/**
 * Advertencias que acompañan la respuesta cuando el proyecto queda sin Scrum Master.
 *
 * @param {boolean} sinScrumMaster - Indica si el proyecto quedó sin Scrum Master.
 * @returns {{codigo: string, mensaje: string}[]}
 */
function advertenciasDe(sinScrumMaster) {
    return sinScrumMaster ? [{ codigo: 'sin_scrum_master', mensaje: AVISO_SIN_SCRUM_MASTER }] : [];
}

/* Asignación, cambio y retiro de rol */

/**
 * Asigna o cambia el rol de una persona en un proyecto. Solo aplica en ese proyecto; sus roles
 * en otros proyectos no se tocan. Si la persona es el único Scrum Master y pasa a otro rol, se
 * exige confirmación; si el rol pedido es Product Owner y ya hay otra persona con él, responde 409.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number} usuarioId - Persona que recibe el rol.
 * @param {{rol: string, confirmar?: boolean}} datos - Rol nuevo y confirmación de la advertencia.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{ok: boolean, cambio: boolean, rol_anterior: string|null, rol_nuevo: string, advertencias: Object[], roles: Object}>}
 */
export async function asignarRol(proyectoId, usuarioId, datos = {}, usuario) {
    const ids = validarIds(proyectoId, usuarioId);
    await exigirGestionRoles(usuario, ids.proyectoId);
    const rolNuevo = validarRol(datos?.rol);
    const confirmar = datos?.confirmar === true;

    let cambio;
    try {
        cambio = await enTransaccion(async (cliente) => {
            const proyecto = await cargarProyecto(ids.proyectoId, cliente, true);
            if (proyecto.archivado) lanzar(409, 'El proyecto está archivado y no admite cambios de rol.');
            await exigirPersonaDelEquipo(proyecto, ids.usuarioId, cliente);

            const rolAnterior = await rolActual(ids.proyectoId, ids.usuarioId, cliente, true);
            if (rolAnterior === rolNuevo) return { proyecto, usuarioId: ids.usuarioId, rolAnterior, rolNuevo, hayCambio: false };

            if (rolNuevo === 'product_owner') await exigirSinOtroProductOwner(ids.proyectoId, ids.usuarioId, cliente);
            const sinScrumMaster = rolAnterior === 'scrum_master'
                ? await validarSalidaScrumMaster(ids.proyectoId, ids.usuarioId, confirmar, cliente)
                : false;

            await cliente.query(
                `INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol) VALUES ($1, $2, $3)
                    ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol`,
                [ids.proyectoId, ids.usuarioId, rolNuevo],
            );
            const resultado = { proyecto, usuarioId: ids.usuarioId, rolAnterior, rolNuevo, sinScrumMaster, hayCambio: true };
            await registrarCambioRol(cliente, usuario, resultado);
            return resultado;
        });
    } catch (error) {
        if (error?.code === '23505' && error?.constraint === 'ux_un_product_owner_por_proyecto') {
            lanzar(409, 'El proyecto ya tiene un Product Owner. Cambia o retira ese rol antes de asignar otro.', { motivo: 'product_owner_duplicado' });
        }
        throw error;
    }

    if (cambio.hayCambio) await publicarCambioRol(cambio, usuario);
    return {
        ok: true,
        cambio: cambio.hayCambio,
        rol_anterior: cambio.rolAnterior,
        rol_nuevo: cambio.rolNuevo,
        advertencias: advertenciasDe(cambio.sinScrumMaster),
        roles: await listar(ids.proyectoId, usuario),
    };
}

/**
 * Retira a una persona su rol en un proyecto, es decir, su participación en él. Si es el único
 * Scrum Master exige confirmación, porque el proyecto no podrá iniciar sprints hasta asignar otro.
 *
 * @param {number} proyectoId - Identificador del proyecto.
 * @param {number} usuarioId - Persona a la que se retira el rol.
 * @param {{confirmar?: boolean}} datos - Confirmación de la advertencia.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{ok: boolean, cambio: boolean, rol_anterior: string, rol_nuevo: null, advertencias: Object[], roles: Object}>}
 */
export async function quitarRol(proyectoId, usuarioId, datos = {}, usuario) {
    const ids = validarIds(proyectoId, usuarioId);
    await exigirGestionRoles(usuario, ids.proyectoId);
    const confirmar = datos?.confirmar === true;

    const cambio = await enTransaccion(async (cliente) => {
        const proyecto = await cargarProyecto(ids.proyectoId, cliente, true);
        if (proyecto.archivado) lanzar(409, 'El proyecto está archivado y no admite cambios de rol.');

        const rolAnterior = await rolActual(ids.proyectoId, ids.usuarioId, cliente, true);
        if (!rolAnterior) lanzar(404, 'La persona no participa en este proyecto.');

        const sinScrumMaster = rolAnterior === 'scrum_master'
            ? await validarSalidaScrumMaster(ids.proyectoId, ids.usuarioId, confirmar, cliente)
            : false;

        await cliente.query('DELETE FROM miembros_proyecto WHERE proyecto_id = $1 AND usuario_id = $2', [ids.proyectoId, ids.usuarioId]);
        const resultado = { proyecto, usuarioId: ids.usuarioId, rolAnterior, rolNuevo: null, sinScrumMaster };
        await registrarCambioRol(cliente, usuario, resultado);
        return resultado;
    });

    await publicarCambioRol(cambio, usuario);
    return {
        ok: true,
        cambio: true,
        rol_anterior: cambio.rolAnterior,
        rol_nuevo: null,
        advertencias: advertenciasDe(cambio.sinScrumMaster),
        roles: await listar(ids.proyectoId, usuario),
    };
}