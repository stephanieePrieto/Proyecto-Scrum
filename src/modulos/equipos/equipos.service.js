// Responsable: Citlaly - HU-40: reglas, SQL y avisos por socket (equipos y miembros)

/**
 * @file equipos.service.js
 * @description Reglas de negocio de los equipos de trabajo: alta, edición y baja, integrantes,
 * administradores de equipo y salida de integrantes con reasignación de tareas y transferencia
 * de responsabilidades. Las operaciones que tocan varias tablas se ejecutan en una transacción.
 * @author Citlaly Morales Viveros
 */
import { pool, consulta as query } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import {
    esAdminGlobal,
    puedeVerEquipo,
    exigirGestionEquipo,
} from '../../utils/permisos.js';

const MIN_INTEGRANTES = 3;
const MAX_INTEGRANTES = 9;
const MAX_NOMBRE = 120;
const MAX_RESULTADOS_USUARIOS = 25;

/** Roles de Scrum que no se pueden dejar sin responsable ni pisar en silencio. */
const ROLES_CLAVE = ['product_owner', 'scrum_master'];

const ERROR_NOMBRE = { campos: { nombre: 'Ya existe un equipo con ese nombre.' } };
const CAMBIO_CONCURRENTE = { motivo: 'cambio_concurrente' };

/* Utilidades internas */

/**
 * Lanza un ErrorApp con detalles opcionales para el cliente.
 *
 * @param {number} estado - Código HTTP.
 * @param {string} mensaje - Mensaje para la persona usuaria.
 * @param {Object} [detalles] - Datos estructurados (campos con error, pendientes, etc.).
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
 * Normaliza el nombre del equipo: sin espacios en los extremos ni repetidos.
 *
 * @param {*} nombre - Nombre recibido.
 * @returns {string} Nombre limpio.
 */
function validarNombre(nombre) {
    const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
    if (!limpio) lanzar(400, 'Revisa los campos marcados.', { campos: { nombre: 'Escribe el nombre del equipo.' } });
    if (limpio.length > MAX_NOMBRE) {
        lanzar(400, 'Revisa los campos marcados.', { campos: { nombre: `El nombre no puede superar ${MAX_NOMBRE} caracteres.` } });
    }
    return limpio;
}

/**
 * Valida una lista de identificadores de usuario y elimina los repetidos.
 *
 * @param {*} lista - Lista recibida del cliente.
 * @returns {number[]}
 */
function normalizarIds(lista) {
    if (!Array.isArray(lista)) lanzar(400, 'Revisa los campos marcados.', { campos: { miembros: 'La lista de integrantes no es válida.' } });
    const ids = [...new Set(lista.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        lanzar(400, 'Revisa los campos marcados.', { campos: { miembros: 'La lista de integrantes no es válida.' } });
    }
    return ids;
}

/**
 * Comprueba que todos los usuarios existan y estén activos.
 *
 * @param {number[]} ids - Identificadores de usuario.
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @returns {Promise<void>}
 */
async function validarUsuariosActivos(ids, cliente) {
    if (!ids.length) return;
    const { rows } = await cliente.query('SELECT id FROM usuarios WHERE id = ANY($1::int[]) AND activo = TRUE', [ids]);
    if (rows.length !== ids.length) {
        lanzar(400, 'Revisa los campos marcados.', { campos: { miembros: 'Algún usuario seleccionado no existe o está inactivo.' } });
    }
}

/**
 * Indica si ya existe un equipo con ese nombre sin distinguir mayúsculas.
 *
 * @param {string} nombre - Nombre ya normalizado.
 * @param {number|null} [ignorarId=null] - Equipo que se está editando.
 * @returns {Promise<boolean>}
 */
async function existeNombre(nombre, ignorarId = null) {
    const { rows } = await query(
        'SELECT 1 FROM equipos WHERE LOWER(BTRIM(nombre)) = LOWER($1) AND ($2::int IS NULL OR id <> $2) LIMIT 1',
        [nombre, ignorarId],
    );
    return rows.length > 0;
}

/**
 * Traduce la violación del índice de nombre único a un error 409 legible.
 *
 * @param {Error} error - Error original de la base de datos.
 * @throws {ErrorApp|Error}
 */
function traducirDuplicado(error) {
    if (error?.code === '23505') lanzar(409, 'Ya existe un equipo con ese nombre.', ERROR_NOMBRE);
    throw error;
}

/**
 * Genera la advertencia de tamaño cuando el equipo tiene menos de 3 o más de 9 integrantes.
 *
 * @param {number} total - Cantidad de integrantes.
 * @returns {{codigo: string, mensaje: string}[]}
 */
function advertenciasTamano(total) {
    const palabra = total === 1 ? 'integrante' : 'integrantes';
    if (total < MIN_INTEGRANTES) {
        return [{ codigo: 'pocos_integrantes', mensaje: `El equipo tiene ${total} ${palabra}; se recomienda un mínimo de ${MIN_INTEGRANTES}.` }];
    }
    if (total > MAX_INTEGRANTES) {
        return [{ codigo: 'muchos_integrantes', mensaje: `El equipo tiene ${total} ${palabra}; se recomienda un máximo de ${MAX_INTEGRANTES}.` }];
    }
    return [];
}

/**
 * Comprueba que el equipo exista, que el usuario lo vea y que pueda gestionarlo.
 * Si no lo ve responde 404 para no revelar equipos ajenos; si lo ve pero no lo gestiona, 403.
 *
 * @param {number} equipoId - Identificador del equipo.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<void>}
 */
async function exigirEquipoGestionable(equipoId, usuario) {
    const { rows } = await query('SELECT 1 FROM equipos WHERE id = $1', [equipoId]);
    if (!rows.length || !(await puedeVerEquipo(usuario, equipoId))) lanzar(404, 'Equipo no encontrado.');
    await exigirGestionEquipo(usuario, equipoId);
}

/* Consulta de equipos */

const COLUMNAS_EQUIPO = `e.id, e.nombre, e.creado_en,
    (SELECT COUNT(*)::int FROM miembros_equipo m WHERE m.equipo_id = e.id) AS total_miembros,
    (SELECT COUNT(*)::int FROM proyectos p WHERE p.equipo_id = e.id) AS total_proyectos,
    (SELECT COUNT(*)::int FROM proyectos p WHERE p.equipo_id = e.id AND p.archivado = FALSE) AS proyectos_activos,
    (SELECT COUNT(*)::int FROM invitaciones i WHERE i.equipo_id = e.id AND i.estado = 'pendiente') AS invitaciones_pendientes`;

/**
 * Carga equipos con sus integrantes, advertencias de tamaño y permiso de gestión del usuario.
 *
 * @param {string} filtro - Cláusula WHERE (o vacía).
 * @param {Array} params - Parámetros de la cláusula.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object[]>}
 */
async function cargarEquipos(filtro, params, usuario) {
    const { rows } = await query(`SELECT ${COLUMNAS_EQUIPO} FROM equipos e ${filtro} ORDER BY LOWER(e.nombre)`, params);
    if (!rows.length) return [];

    const { rows: miembros } = await query(
        `SELECT m.equipo_id, u.id, u.nombre, u.correo, u.activo
            FROM miembros_equipo m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.equipo_id = ANY($1::int[]) ORDER BY LOWER(u.nombre)`,
        [rows.map((equipo) => equipo.id)],
    );

    const global = await esAdminGlobal(usuario);
    return rows.map((equipo) => {
        const integrantes = miembros
            .filter((m) => m.equipo_id === equipo.id)
            .map(({ equipo_id: _equipo, ...resto }) => resto);
        return {
            ...equipo,
            miembros: integrantes,
            advertencias: advertenciasTamano(equipo.total_miembros),
            puede_gestionar: global,
        };
    });
}

/**
 * Lista los equipos visibles para el usuario: todos si es administrador global,
 * o solo aquellos de los que es integrante.
 *
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{equipos: Object[], puede_crear: boolean}>}
 */
export async function listar(usuario) {
    const global = await esAdminGlobal(usuario);
    const equipos = global
        ? await cargarEquipos('', [], usuario)
        : await cargarEquipos('WHERE e.id IN (SELECT equipo_id FROM miembros_equipo WHERE usuario_id = $1)', [usuario.id], usuario);
    return { equipos, puede_crear: global };
}

/**
 * Obtiene un equipo con sus integrantes.
 *
 * @param {number} id - Identificador del equipo.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>}
 */
export async function obtener(id, usuario) {
    if (!(await puedeVerEquipo(usuario, id))) lanzar(404, 'Equipo no encontrado.');
    const [equipo] = await cargarEquipos('WHERE e.id = $1', [id], usuario);
    if (!equipo) lanzar(404, 'Equipo no encontrado.');
    return equipo;
}

/**
 * Busca usuarios activos para agregarlos a un equipo. Si se indica un equipo, excluye a sus
 * integrantes y exige que el usuario pueda gestionarlo; si no, excluye al propio usuario.
 *
 * @param {{q?: string, equipoId?: number|null}} filtros - Texto a buscar y equipo opcional.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{id: number, nombre: string, correo: string}[]>}
 */
export async function usuariosDisponibles({ q = '', equipoId = null } = {}, usuario) {
    if (!(await esAdminGlobal(usuario))) lanzar(403, 'Solo un administrador puede buscar usuarios para los equipos.');
    if (equipoId) await exigirEquipoGestionable(equipoId, usuario);

    const texto = String(q ?? '').trim().replace(/[\\%_]/g, '\\$&');
    const { rows } = await query(
        `SELECT u.id, u.nombre, u.correo FROM usuarios u
        WHERE u.activo = TRUE
        AND ($1 = '' OR u.nombre ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
        AND ($2::int IS NULL OR NOT EXISTS (SELECT 1 FROM miembros_equipo m WHERE m.equipo_id = $2 AND m.usuario_id = u.id))
        AND ($2::int IS NOT NULL OR u.id <> $3)
        ORDER BY LOWER(u.nombre) LIMIT ${MAX_RESULTADOS_USUARIOS}`,
        [texto, equipoId, usuario.id],
    );
    return rows;
}

/* Alta, edición y baja */

/**
 * Crea un equipo. Quien lo crea queda como integrante y administrador del equipo;
 * los demás integrantes indicados se agregan como integrantes sin permisos de administración.
 * El equipo se guarda aunque su tamaño no sea el recomendado; la advertencia viaja en la respuesta.
 *
 * @param {{nombre: string, miembros?: number[]}} datos - Datos del equipo.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>} Equipo creado.
 */
export async function crear(datos = {}, usuario) {
    if (!(await esAdminGlobal(usuario))) lanzar(403, 'Solo un administrador puede crear equipos.');
    const nombre = validarNombre(datos.nombre);
    const ids = normalizarIds(datos.miembros ?? []);

    if (await existeNombre(nombre)) lanzar(409, 'Ya existe un equipo con ese nombre.', ERROR_NOMBRE);

    let equipoId;
    try {
        equipoId = await enTransaccion(async (cliente) => {
            await validarUsuariosActivos(ids, cliente);
            const { rows } = await cliente.query(
                'INSERT INTO equipos (nombre) VALUES ($1) RETURNING id',
                [nombre],
            );
            const nuevoId = rows[0].id;
            /** Quien crea el equipo queda siempre como integrante por defecto (sin permisos extra). */
            await cliente.query(
                'INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)',
                [nuevoId, usuario.id],
            );
            if (ids.length) {
                await cliente.query(
                    'INSERT INTO miembros_equipo (equipo_id, usuario_id) SELECT $1::int, UNNEST($2::int[]) ON CONFLICT DO NOTHING',
                    [nuevoId, ids],
                );
            }
            return nuevoId;
        });
    } catch (error) {
        traducirDuplicado(error);
    }
    return obtener(equipoId, usuario);
}

/**
 * Cambia el nombre de un equipo.
 *
 * @param {number} id - Identificador del equipo.
 * @param {{nombre: string}} datos - Datos nuevos.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>} Equipo actualizado.
 */
export async function actualizar(id, datos = {}, usuario) {
    await exigirEquipoGestionable(id, usuario);
    const nombre = validarNombre(datos.nombre);
    if (await existeNombre(nombre, id)) lanzar(409, 'Ya existe un equipo con ese nombre.', ERROR_NOMBRE);

    try {
        await query('UPDATE equipos SET nombre = $1 WHERE id = $2', [nombre, id]);
    } catch (error) {
        traducirDuplicado(error);
    }
    return obtener(id, usuario);
}

/**
 * Elimina un equipo que no tenga proyectos asociados, incluidos los archivados.
 * Al eliminarlo también desaparecen sus membresías e invitaciones pendientes.
 *
 * @param {number} id - Identificador del equipo.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{ok: boolean, eliminado: number}>}
 */
export async function eliminar(id, usuario) {
    await exigirEquipoGestionable(id, usuario);

    const { rows } = await query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE archivado = FALSE)::int AS activos
            FROM proyectos WHERE equipo_id = $1`,
        [id],
    );
    const { total, activos } = rows[0];
    const mensajeBloqueo = `No se puede eliminar el equipo porque tiene ${total} ${total === 1 ? 'proyecto asociado' : 'proyectos asociados'} (incluidos los archivados).`;
    if (total > 0) lanzar(409, mensajeBloqueo, { motivo: 'tiene_proyectos', total, activos });

    try {
        await query('DELETE FROM equipos WHERE id = $1', [id]);
    } catch (error) {
        if (error?.code === '23503') lanzar(409, 'No se puede eliminar el equipo porque tiene proyectos asociados.', { motivo: 'tiene_proyectos' });
        throw error;
    }
    return { ok: true, eliminado: id };
}

/* Integrantes */

/**
 * Agrega usuarios al equipo. Solo los incorpora al equipo: la participación y el rol de Scrum
 * en cada proyecto se asignan por separado.
 *
 * @param {number} equipoId - Identificador del equipo.
 * @param {{miembros: number[]}} datos - Usuarios a agregar.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>} Equipo actualizado.
 */
export async function agregarMiembros(equipoId, datos = {}, usuario) {
    await exigirEquipoGestionable(equipoId, usuario);
    const ids = normalizarIds(datos.miembros ?? []);
    if (!ids.length) lanzar(400, 'Revisa los campos marcados.', { campos: { miembros: 'Selecciona al menos un usuario.' } });

    await enTransaccion(async (cliente) => {
        await cliente.query('SELECT id FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
        await validarUsuariosActivos(ids, cliente);
        await cliente.query(
            'INSERT INTO miembros_equipo (equipo_id, usuario_id) SELECT $1::int, UNNEST($2::int[]) ON CONFLICT DO NOTHING',
            [equipoId, ids],
        );
    });
    return obtener(equipoId, usuario);
}

/* Salida de integrantes */

/**
 * Calcula lo que hay que resolver antes de quitar a un integrante del equipo: tareas abiertas,
 * responsabilidades de Scrum Master o Product Owner y condición de último administrador.
 * Solo se consideran los proyectos no archivados del equipo; los archivados quedan como historial.
 * Las tareas terminadas y las de sprints cerrados tampoco se tocan.
 *
 * @param {number} equipoId - Identificador del equipo.
 * @param {number} usuarioId - Integrante que saldría.
 * @param {import('pg').PoolClient|import('pg').Pool} cliente - Cliente o pool.
 * @param {boolean} [bloquear=false] - Bloquea las filas involucradas (uso dentro de la transacción).
 * @returns {Promise<Object>}
 */
async function calcularPendientes(equipoId, usuarioId, cliente, bloquear = false) {
    const candado = bloquear ? ' FOR UPDATE OF m' : '';
    const { rows: filas } = await cliente.query(
        `SELECT u.id, u.nombre FROM miembros_equipo m JOIN usuarios u ON u.id = m.usuario_id
            WHERE m.equipo_id = $1 AND m.usuario_id = $2${candado}`,
        [equipoId, usuarioId],
    );
    const integrante = filas[0];
    if (!integrante) lanzar(404, 'El usuario no es integrante de este equipo.');

    const { rows: tareas } = await cliente.query(
        `SELECT t.id, t.titulo, t.proyecto_id, p.nombre AS proyecto_nombre,
            t.sprint_id, s.nombre AS sprint_nombre, s.estado AS sprint_estado,
            c.nombre AS columna_nombre, t.bloqueada
            FROM tareas t
            JOIN proyectos p ON p.id = t.proyecto_id
            LEFT JOIN sprints s ON s.id = t.sprint_id
            LEFT JOIN columnas_tablero c ON c.id = t.columna_id
        WHERE p.equipo_id = $1 AND p.archivado = FALSE AND t.responsable_id = $2
            AND COALESCE(c.es_final, FALSE) = FALSE
            AND (t.sprint_id IS NULL OR s.estado IN ('activo', 'planificado'))
        ORDER BY LOWER(p.nombre), t.id${bloquear ? ' FOR UPDATE OF t' : ''}`,
        [equipoId, usuarioId],
    );

    const { rows: participaciones } = await cliente.query(
        `SELECT mp.proyecto_id, p.nombre AS proyecto_nombre, mp.rol,
            (SELECT COUNT(*)::int FROM miembros_proyecto o
                WHERE o.proyecto_id = mp.proyecto_id AND o.rol = 'scrum_master' AND o.usuario_id <> mp.usuario_id) AS otros_scrum_master
            FROM miembros_proyecto mp JOIN proyectos p ON p.id = mp.proyecto_id
        WHERE p.equipo_id = $1 AND p.archivado = FALSE AND mp.usuario_id = $2
        ORDER BY LOWER(p.nombre)`,
        [equipoId, usuarioId],
    );
    const proyectos = participaciones.map((fila) => ({ id: fila.proyecto_id, nombre: fila.proyecto_nombre, rol: fila.rol }));
    const roles = participaciones
        .filter((fila) => ROLES_CLAVE.includes(fila.rol))
        .map((fila) => ({
            proyecto_id: fila.proyecto_id,
            proyecto_nombre: fila.proyecto_nombre,
            rol: fila.rol,
            // Un Scrum Master puede salir sin reemplazo si el proyecto conserva otro; el Product Owner es único.
            requiere_reemplazo: fila.rol === 'product_owner' || fila.otros_scrum_master === 0,
        }));

    const { rows: restantes } = await cliente.query(
        `SELECT u.id, u.nombre, u.correo
            FROM miembros_equipo m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.equipo_id = $1 AND m.usuario_id <> $2 AND u.activo = TRUE
        ORDER BY LOWER(u.nombre)`,
        [equipoId, usuarioId],
    );
    const { rows: membresias } = restantes.length
        ? await cliente.query(
            `SELECT mp.usuario_id, mp.proyecto_id, mp.rol
                FROM miembros_proyecto mp JOIN proyectos p ON p.id = mp.proyecto_id
            WHERE p.equipo_id = $1 AND p.archivado = FALSE AND mp.usuario_id = ANY($2::int[])`,
            [equipoId, restantes.map((r) => r.id)],
        )
        : { rows: [] };
    const candidatos = restantes.map((r) => ({
        ...r,
        membresias: membresias
            .filter((m) => m.usuario_id === r.id)
            .map(({ proyecto_id: proyectoId, rol }) => ({ proyecto_id: proyectoId, rol })),
    }));

    return {
        integrante,
        tareas,
        proyectos,
        roles,
        candidatos,
        requiere_resolucion: tareas.length > 0 || roles.some((r) => r.requiere_reemplazo),
    };
}

/**
 * Vista previa de lo que hay que resolver antes de quitar a un integrante. No modifica datos.
 *
 * @param {number} equipoId - Identificador del equipo.
 * @param {number} usuarioId - Integrante que saldría.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<Object>}
 */
export async function pendientesDeQuitar(equipoId, usuarioId, usuario) {
    await exigirEquipoGestionable(equipoId, usuario);
    return calcularPendientes(equipoId, usuarioId, pool);
}

/**
 * Valida las decisiones enviadas por el cliente contra lo pendiente y arma el plan a ejecutar.
 * Solo se actúa sobre tareas y roles detectados en el servidor; lo demás que envíe el cliente se ignora.
 *
 * @param {Object} pendientes - Resultado de calcularPendientes.
 * @param {{reasignaciones?: Object[], transferencias?: Object[]}} datos - Decisiones del cliente.
 * @returns {{transferir: Object[], reasignar: Object[]}}
 * @throws {ErrorApp} 409 con el detalle de lo que falta o entra en conflicto.
 */
function planificar(pendientes, datos) {
    const reasignaciones = Array.isArray(datos.reasignaciones) ? datos.reasignaciones : [];
    const transferencias = Array.isArray(datos.transferencias) ? datos.transferencias : [];
    const candidatos = new Map(pendientes.candidatos.map((c) => [c.id, c]));

    const destinoPorTarea = new Map();
    for (const item of reasignaciones) {
        const tareaId = aEntero(item?.tarea_id);
        const destino = aEntero(item?.usuario_id);
        if (!tareaId || !destino) lanzar(400, 'Las reasignaciones enviadas no son válidas.');
        destinoPorTarea.set(tareaId, destino);
    }

    const reemplazoPorProyecto = new Map();
    for (const item of transferencias) {
        const proyectoId = aEntero(item?.proyecto_id);
        const destino = aEntero(item?.usuario_id);
        if (!proyectoId || !destino) lanzar(400, 'Las transferencias enviadas no son válidas.');
        reemplazoPorProyecto.set(proyectoId, { usuario_id: destino, confirmar: item.confirmar_cambio_rol === true });
    }

    const rolEnProyecto = (usuarioId, proyectoId) =>
        candidatos.get(usuarioId)?.membresias.find((m) => m.proyecto_id === proyectoId)?.rol ?? null;

    const rolesSinResolver = [];
    const tareasSinResolver = [];
    const conflictos = [];
    const transferir = [];
    const reasignar = [];

    for (const responsabilidad of pendientes.roles.filter((r) => r.requiere_reemplazo)) {
        const elegido = reemplazoPorProyecto.get(responsabilidad.proyecto_id);
        const candidato = elegido && candidatos.get(elegido.usuario_id);
        if (!candidato) {
            rolesSinResolver.push({
                proyecto_id: responsabilidad.proyecto_id,
                proyecto_nombre: responsabilidad.proyecto_nombre,
                rol: responsabilidad.rol,
            });
            continue;
        }

        const actual = rolEnProyecto(candidato.id, responsabilidad.proyecto_id);
        const base = {
            proyecto_id: responsabilidad.proyecto_id,
            proyecto_nombre: responsabilidad.proyecto_nombre,
            usuario_id: candidato.id,
            usuario_nombre: candidato.nombre,
            rol: responsabilidad.rol,
        };
        if (actual && actual !== 'developer' && actual !== responsabilidad.rol) {
            conflictos.push({ ...base, motivo: 'reemplazo_con_rol', rol_actual: actual });
        } else if (actual === 'developer' && !elegido.confirmar) {
            conflictos.push({ ...base, motivo: 'confirmar_cambio_rol', rol_actual: actual });
        } else {
            transferir.push({ ...base, existente: actual });
        }
    }

    for (const tarea of pendientes.tareas) {
        const destino = destinoPorTarea.get(tarea.id);
        const candidato = candidatos.get(destino);
        if (!candidato) {
            tareasSinResolver.push({ tarea_id: tarea.id, titulo: tarea.titulo, proyecto_id: tarea.proyecto_id });
            continue;
        }

        const promovido = transferir.find((t) => t.proyecto_id === tarea.proyecto_id && t.usuario_id === destino);
        const rolFinal = promovido ? promovido.rol : rolEnProyecto(destino, tarea.proyecto_id);
        if (ROLES_CLAVE.includes(rolFinal)) {
            conflictos.push({
                motivo: 'candidato_con_rol',
                tarea_id: tarea.id,
                titulo: tarea.titulo,
                proyecto_id: tarea.proyecto_id,
                proyecto_nombre: tarea.proyecto_nombre,
                usuario_id: candidato.id,
                usuario_nombre: candidato.nombre,
                rol_actual: rolFinal,
            });
            continue;
        }
        reasignar.push({ tarea, destino });
    }

    if (rolesSinResolver.length || tareasSinResolver.length || conflictos.length) {
        lanzar(409, 'Hay tareas o responsabilidades pendientes de resolver antes de quitar al integrante.', {
            motivo: 'pendientes_sin_resolver',
            tareas_sin_resolver: tareasSinResolver,
            roles_sin_resolver: rolesSinResolver,
            conflictos,
        });
    }
    return { transferir, reasignar };
}

/**
 * Asigna el rol vacante al reemplazo elegido sin pisar en silencio ningún otro rol:
 * si ya era integrante solo se cambia cuando conserva el rol que se validó.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @param {{proyecto_id: number, usuario_id: number, rol: string, existente: string|null}} traspaso - Traspaso validado.
 * @returns {Promise<void>}
 */
async function asignarRolReemplazo(cliente, { proyecto_id: proyectoId, usuario_id: usuarioId, rol, existente }) {
    const resultado = existente
        ? await cliente.query(
            'UPDATE miembros_proyecto SET rol = $3 WHERE proyecto_id = $1 AND usuario_id = $2 AND rol = $4',
            [proyectoId, usuarioId, rol, existente],
        )
        : await cliente.query(
            'INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [proyectoId, usuarioId, rol],
        );
    if (!resultado.rowCount) {
        lanzar(409, 'La participación del reemplazo cambió mientras se guardaba. Revisa los pendientes e inténtalo de nuevo.', CAMBIO_CONCURRENTE);
    }
}

/**
 * Reasigna una tarea al nuevo responsable. Si aún no participa en el proyecto lo incorpora como
 * developer; si ya participa conserva su rol. Deja constancia en el historial de la tarea.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción.
 * @param {{tarea: Object, destino: number}} reasignacion - Tarea y nuevo responsable.
 * @param {{id: number}} saliente - Integrante que deja la tarea.
 * @param {{id: number}} actor - Usuario que realiza la operación.
 * @returns {Promise<void>}
 */
async function reasignarTarea(cliente, { tarea, destino }, saliente, actor) {
    await cliente.query(
        `INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol) VALUES ($1, $2, 'developer')
            ON CONFLICT (proyecto_id, usuario_id) DO NOTHING`,
        [tarea.proyecto_id, destino],
    );
    const { rowCount } = await cliente.query(
        'UPDATE tareas SET responsable_id = $1, version = version + 1, actualizado_en = NOW() WHERE id = $2 AND responsable_id = $3',
        [destino, tarea.id, saliente.id],
    );
    if (!rowCount) {
        lanzar(409, 'Una de las tareas cambió mientras se guardaba. Revisa los pendientes e inténtalo de nuevo.', CAMBIO_CONCURRENTE);
    }
    await cliente.query(
        "INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle) VALUES ($1, $2, 'reasignada', $3)",
        [tarea.id, actor.id, JSON.stringify({ anterior: saliente.id, nuevo: destino, motivo: 'salida_del_equipo' })],
    );
}

/**
 * Avisa a los nuevos responsables. Se invoca solo después de confirmar la transacción y un fallo
 * al notificar nunca deshace ni interrumpe la reasignación ya guardada.
 *
 * @param {{tarea: Object, destino: number}[]} reasignadas - Tareas reasignadas.
 * @param {{nombre: string}} saliente - Integrante que salió del equipo.
 * @returns {Promise<void>}
 */
async function notificarReasignaciones(reasignadas, saliente) {
    if (!reasignadas.length) return;
    try {
        const { notificar, TIPOS } = await import('../notificaciones/notificaciones.service.js');
        await Promise.allSettled(reasignadas.map(({ tarea, destino }) => notificar({
            usuarioId: destino,
            tipo: TIPOS.ASIGNACION,
            titulo: `Tarea reasignada: ${tarea.titulo}`,
            mensaje: `Se te asignó la tarea «${tarea.titulo}» del proyecto «${tarea.proyecto_nombre}» porque ${saliente.nombre} salió del equipo.`,
            referenciaId: tarea.id,
        })));
    } catch (error) {
        console.error('[equipos] No se pudieron enviar las notificaciones de reasignación:', error?.message ?? error);
    }
}

/**
 * Quita a un integrante del equipo en una sola transacción. Antes de confirmar exige que estén
 * resueltas las tareas abiertas (reasignación), las responsabilidades de Product Owner o Scrum
 * Master (transferencia a un reemplazo explícito) y el caso del último administrador.
 * Retira además su participación en los proyectos no archivados de ese equipo; sus otros equipos
 * y proyectos no se modifican.
 *
 * @param {number} equipoId - Identificador del equipo.
 * @param {number} usuarioId - Integrante a quitar.
 * @param {{reasignaciones?: {tarea_id: number, usuario_id: number}[],
 *          transferencias?: {proyecto_id: number, usuario_id: number, confirmar_cambio_rol?: boolean}[],
 *          nuevo_admin_id?: number}} datos - Decisiones tomadas por quien administra.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<{ok: boolean, reasignadas: number, equipo: Object|null}>}
 */
export async function quitarMiembro(equipoId, usuarioId, datos = {}, usuario) {
    await exigirEquipoGestionable(equipoId, usuario);

    let resultado;
    try {
        resultado = await enTransaccion(async (cliente) => {
            await cliente.query('SELECT id FROM equipos WHERE id = $1 FOR UPDATE', [equipoId]);
            const pendientes = await calcularPendientes(equipoId, usuarioId, cliente, true);

            const plan = planificar(pendientes, datos);

            // Primero se libera su lugar en los proyectos: el Product Owner es único por proyecto.
            await cliente.query(
                `DELETE FROM miembros_proyecto mp USING proyectos p
                    WHERE mp.proyecto_id = p.id AND p.equipo_id = $1 AND p.archivado = FALSE AND mp.usuario_id = $2`,
                [equipoId, usuarioId],
            );
            for (const traspaso of plan.transferir) await asignarRolReemplazo(cliente, traspaso);
            for (const reasignacion of plan.reasignar) await reasignarTarea(cliente, reasignacion, pendientes.integrante, usuario);

            await cliente.query('DELETE FROM miembros_equipo WHERE equipo_id = $1 AND usuario_id = $2', [equipoId, usuarioId]);
            return { reasignadas: plan.reasignar, saliente: pendientes.integrante };
        });
    } catch (error) {
        if (error?.code === '23505') lanzar(409, 'Otro cambio simultáneo afectó a los proyectos del equipo. Revisa los pendientes e inténtalo de nuevo.', CAMBIO_CONCURRENTE);
        throw error;
    }

    await notificarReasignaciones(resultado.reasignadas, resultado.saliente);

    // Quien se quita a sí mismo puede dejar de ver el equipo; en ese caso no hay equipo que devolver.
    let equipo = null;
    try {
        equipo = await obtener(equipoId, usuario);
    } catch (error) {
        if (error?.statusCode !== 404) throw error;
    }
    return { ok: true, reasignadas: resultado.reasignadas.length, equipo };
}