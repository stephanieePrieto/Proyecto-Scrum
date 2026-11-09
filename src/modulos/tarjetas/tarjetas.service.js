// Responsable: Camila - HU-18, HU-23, HU-25: reglas, SQL y avisos por socket (mover, bloquear y control de version de tarjetas)
/**
 * @file tarjetas.service.js
 * @description Reglas de negocio, control de concurrencia optimista (HU-25),
 * fusión automática de campos distintos, bloqueo (HU-23) y avisos por Socket.io (HU-18, HU-59).
 * @author Camila Mariné Crespo Zurita
 */

import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { registrarAuditoria, diferencias, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';

const CAMPOS_EDITABLES = ['titulo', 'descripcion', 'responsable_id', 'horas_estimadas', 'etiquetas'];

/** Tiempo máximo (ms) que se conserva activo el estado "X está editando" sin latido. */
const TTL_EDICION_MS = 60 * 1000;

/**
 * Mapa en memoria de editores activos por tarjeta:
 * tareaId -> Map<usuarioId, { usuarioId: number, nombre: string, actualizadoEn: number }>
 * @type {Map<number, Map<number, {usuarioId: number, nombre: string, actualizadoEn: number}>>}
 */
const editoresPorTarjeta = new Map();

/**
 * Convierte un valor en entero positivo válido o lanza 400.
 * @param {*} valor
 * @param {string} [mensaje='Identificador de tarjeta no válido.']
 * @returns {number}
 */
function validarIdEntero(valor, mensaje = 'Identificador de tarjeta no válido.') {
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ErrorApp(mensaje, 400);
    }
    return id;
}

/**
 * Normaliza un valor de campo para comparaciones deterministas entre versiones.
 * @param {string} campo
 * @param {*} valor
 * @returns {string}
 */
function normalizarValorComparable(campo, valor) {
    if (campo === 'etiquetas') {
        const lista = Array.isArray(valor)
            ? valor.map((e) => String(e).trim()).filter(Boolean)
            : [];
        return JSON.stringify(lista);
    }
    if (campo === 'horas_estimadas') {
        if (valor === null || valor === undefined || valor === '') return '';
        const num = Number(valor);
        return Number.isFinite(num) ? String(Math.round(num * 10) / 10) : '';
    }
    if (campo === 'responsable_id') {
        if (valor === null || valor === undefined || valor === '') return '';
        const num = Number(valor);
        return Number.isInteger(num) && num > 0 ? String(num) : '';
    }
    return String(valor ?? '').trim();
}

/**
 * Limpia y valida los campos editables enviados por el cliente.
 * @param {Object} datos
 * @returns {Object} Objeto solo con los campos editables presentes y normalizados.
 */
function sanitizarCamposEditables(datos = {}) {
    const limpio = {};

    if (Object.prototype.hasOwnProperty.call(datos, 'titulo')) {
        const titulo = String(datos.titulo ?? '').trim();
        if (!titulo) {
            throw new ErrorApp('El título de la tarjeta no puede estar vacío.', 400);
        }
        if (titulo.length > 200) {
            throw new ErrorApp('El título de la tarjeta no puede superar 200 caracteres.', 400);
        }
        limpio.titulo = titulo;
    }

    if (Object.prototype.hasOwnProperty.call(datos, 'descripcion')) {
        limpio.descripcion = datos.descripcion === null || datos.descripcion === undefined
            ? ''
            : String(datos.descripcion).trim();
    }

    if (Object.prototype.hasOwnProperty.call(datos, 'responsable_id')) {
        if (datos.responsable_id === null || datos.responsable_id === '' || datos.responsable_id === undefined) {
            limpio.responsable_id = null;
        } else {
            const respId = Number(datos.responsable_id);
            if (!Number.isInteger(respId) || respId <= 0) {
                throw new ErrorApp('El responsable seleccionado no es válido.', 400);
            }
            limpio.responsable_id = respId;
        }
    }

    if (Object.prototype.hasOwnProperty.call(datos, 'horas_estimadas')) {
        if (datos.horas_estimadas === null || datos.horas_estimadas === '' || datos.horas_estimadas === undefined) {
            limpio.horas_estimadas = null;
        } else {
            const horas = Number(datos.horas_estimadas);
            if (!Number.isFinite(horas) || horas <= 0 || horas > 99999.9) {
                throw new ErrorApp('Las horas estimadas deben ser un número positivo válido.', 400);
            }
            limpio.horas_estimadas = Math.round(horas * 10) / 10;
        }
    }

    if (Object.prototype.hasOwnProperty.call(datos, 'etiquetas')) {
        const origen = Array.isArray(datos.etiquetas)
            ? datos.etiquetas
            : typeof datos.etiquetas === 'string'
                ? datos.etiquetas.split(',')
                : [];
        limpio.etiquetas = [...new Set(origen.map((e) => String(e).trim()).filter(Boolean))].slice(0, 10);
    }

    return limpio;
}

/**
 * Obtiene y depura la lista de usuarios que están editando activamente una tarjeta.
 * @param {number} tareaId
 * @returns {Array<{usuarioId: number, nombre: string}>}
 */
function obtenerEditoresActivos(tareaId) {
    const mapa = editoresPorTarjeta.get(Number(tareaId));
    if (!mapa) return [];

    const ahora = Date.now();
    const activos = [];
    for (const [uid, info] of mapa.entries()) {
        if (ahora - info.actualizadoEn > TTL_EDICION_MS) {
            mapa.delete(uid);
        } else {
            activos.push({ usuarioId: info.usuarioId, nombre: info.nombre });
        }
    }
    if (mapa.size === 0) editoresPorTarjeta.delete(Number(tareaId));
    return activos;
}

/**
 * Retira a un usuario del registro de edición activa de una tarjeta.
 * @param {number} tareaId
 * @param {number} usuarioId
 * @returns {Array<{usuarioId: number, nombre: string}>}
 */
function retirarEditorActivo(tareaId, usuarioId) {
    const mapa = editoresPorTarjeta.get(Number(tareaId));
    if (mapa) {
        mapa.delete(Number(usuarioId));
        if (mapa.size === 0) editoresPorTarjeta.delete(Number(tareaId));
    }
    return obtenerEditoresActivos(tareaId);
}

/**
 * Consulta la información completa de una tarjeta para el tablero y modales de concurrencia.
 * @param {number} tareaId
 * @param {import('pg').Pool|import('pg').PoolClient} [db=pool]
 * @returns {Promise<Object|null>}
 */
async function consultarTarjetaCompleta(tareaId, db = pool) {
    const { rows } = await db.query(
        `SELECT t.id, t.historia_id, t.proyecto_id, t.sprint_id, t.columna_id,
                t.titulo, COALESCE(t.descripcion, '') AS descripcion,
                t.responsable_id,
                t.horas_estimadas::float8 AS horas_estimadas,
                COALESCE(t.etiquetas, '{}') AS etiquetas,
                t.orden, t.bloqueada, t.motivo_bloqueo, t.version,
                t.creado_en, t.actualizado_en,
                u.nombre AS responsable,
                (u.id IS NOT NULL AND u.activo = FALSE) AS responsable_inactivo,
                h.titulo AS historia_padre,
                h.puntos,
                h.epica_id,
                e.nombre AS epica_nombre,
                c.nombre AS columna_nombre,
                c.es_final AS columna_es_final,
                COALESCE((SELECT SUM(r.horas)::float8 FROM registros_horas r WHERE r.tarea_id = t.id), 0) AS horas_reales,
                (SELECT i.id FROM impedimentos i WHERE i.tarea_id = t.id AND i.estado = 'abierto' ORDER BY i.id DESC LIMIT 1) AS id_impedimento
         FROM tareas t
         JOIN historias h ON h.id = t.historia_id
         LEFT JOIN epicas e ON e.id = h.epica_id
         LEFT JOIN usuarios u ON u.id = t.responsable_id
         LEFT JOIN columnas_tablero c ON c.id = t.columna_id
         WHERE t.id = $1`,
        [tareaId]
    );

    if (!rows.length) return null;
    return {
        ...rows[0],
        editores: obtenerEditoresActivos(tareaId)
    };
}

/**
 * Obtiene el nombre del usuario autenticado.
 * @param {{id: number, nombre?: string}} usuario
 * @param {import('pg').Pool|import('pg').PoolClient} [db=pool]
 * @returns {Promise<string>}
 */
async function obtenerNombreUsuario(usuario, db = pool) {
    if (usuario?.nombre) return usuario.nombre;
    if (!usuario?.id) return 'Un compañero';
    const { rows } = await db.query('SELECT nombre FROM usuarios WHERE id = $1', [usuario.id]);
    return rows[0]?.nombre || `Usuario #${usuario.id}`;
}

/**
 * Obtiene una tarjeta por su ID verificando permisos de lectura en el proyecto.
 * @param {number|string} tareaId
 * @param {{id: number}} usuario
 * @returns {Promise<Object>}
 */
export async function obtenerTarjetaPorId(tareaId, usuario) {
    const id = validarIdEntero(tareaId);
    const tarea = await consultarTarjetaCompleta(id);
    if (!tarea) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    await exigirPermiso(usuario, 'proyecto.ver', tarea.proyecto_id);
    return tarea;
}

/**
 *  Notifica en tiempo real que un usuario comenzó o dejó de editar una tarjeta ("X está editando").
 * @param {number|string} tareaId
 * @param {boolean} editando
 * @param {{id: number, nombre?: string}} usuario
 * @returns {Promise<{tareaId: number, editores: Array<{usuarioId: number, nombre: string}>}>}
 */
export async function notificarEstadoEdicion(tareaId, editando, usuario) {
    const id = validarIdEntero(tareaId);
    const { rows } = await consulta('SELECT id, proyecto_id FROM tareas WHERE id = $1', [id]);
    if (!rows.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    const proyectoId = rows[0].proyecto_id;
    await exigirPermiso(usuario, 'tarea.gestionar', proyectoId);

    const nombre = await obtenerNombreUsuario(usuario);
    if (editando) {
        if (!editoresPorTarjeta.has(id)) {
            editoresPorTarjeta.set(id, new Map());
        }
        editoresPorTarjeta.get(id).set(Number(usuario.id), {
            usuarioId: Number(usuario.id),
            nombre,
            actualizadoEn: Date.now()
        });
    } else {
        retirarEditorActivo(id, usuario.id);
    }

    const editores = obtenerEditoresActivos(id);

    emitirAProyecto(proyectoId, 'tarjeta:editando', {
        proyectoId,
        tareaId: id,
        usuarioId: Number(usuario.id),
        usuarioNombre: nombre,
        editando: Boolean(editando),
        editores
    });

    return { tareaId: id, editores };
}

/**
 * Actualiza una tarjeta con control de versión optimista.
 * - Si la versión coincide (o se envía `forzar: true` tras resolver el modal), guarda e incrementa versión.
 * - Si la versión cambió en el servidor pero se editaron campos distintos, fusiona automáticamente.
 * - Si ambos usuarios editaron el mismo campo con valores distintos, lanza 409 Conflict con los detalles
 *   para mostrar el modal interactivo ("Conservar mía", "Aceptar la suya", "Fusionar").
 *
 * @param {number|string} tareaId
 * @param {Object} datos
 * @param {{id: number, nombre?: string}} usuario
 * @returns {Promise<{tarea: Object, fusionadoAutomaticamente: boolean, camposFusionados: string[]}>}
 */
export async function actualizarTarjetaConVersion(tareaId, datos = {}, usuario) {
    const id = validarIdEntero(tareaId);
    const { rows: ubicacion } = await consulta('SELECT proyecto_id FROM tareas WHERE id = $1', [id]);
    if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    const proyectoId = ubicacion[0].proyecto_id;
    await exigirPermiso(usuario, 'tarea.gestionar', proyectoId);

    const camposRecibidos = sanitizarCamposEditables(datos);
    if (Object.keys(camposRecibidos).length === 0) {
        throw new ErrorApp('No se enviaron campos válidos para actualizar la tarjeta.', 400);
    }

    const versionCliente = datos.version !== undefined && datos.version !== null
        ? Number(datos.version)
        : null;
    const forzarResolucion = Boolean(datos.forzar);

    if (versionCliente !== null && (!Number.isInteger(versionCliente) || versionCliente <= 0)) {
        throw new ErrorApp('El número de versión proporcionado no es válido.', 400);
    }

    const cliente = await pool.connect();
    let resultadoTransaccion;

    try {
        await cliente.query('BEGIN');

        const { rows: actuales } = await cliente.query(
            `SELECT id, proyecto_id, sprint_id, titulo, COALESCE(descripcion, '') AS descripcion,
                    responsable_id, horas_estimadas::float8 AS horas_estimadas,
                    COALESCE(etiquetas, '{}') AS etiquetas, version
             FROM tareas
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );

        if (!actuales.length) {
            throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
        }

        const actual = actuales[0];

        // Verificar que el sprint no esté cerrado
        if (actual.sprint_id) {
            const { rows: spRows } = await cliente.query(
                'SELECT estado FROM sprints WHERE id = $1',
                [actual.sprint_id]
            );
            if (spRows[0]?.estado === 'cerrado') {
                throw new ErrorApp('No se pueden editar tarjetas de un sprint cerrado.', 409);
            }
        }

        // Validar que el responsable pertenezca al proyecto si se asignó uno
        if (camposRecibidos.responsable_id) {
            const { rows: respValido } = await cliente.query(
                `SELECT 1
                 FROM miembros_proyecto mp
                 JOIN usuarios u ON u.id = mp.usuario_id
                 WHERE mp.proyecto_id = $1 AND mp.usuario_id = $2 AND u.activo = TRUE`,
                [actual.proyecto_id, camposRecibidos.responsable_id]
            );
            if (!respValido.length) {
                throw new ErrorApp('El responsable debe ser un integrante activo del proyecto.', 400);
            }
        }

        let fusionadoAutomaticamente = false;
        let camposFusionados = [];
        let estadoFinal = {
            titulo: actual.titulo,
            descripcion: actual.descripcion,
            responsable_id: actual.responsable_id,
            horas_estimadas: actual.horas_estimadas,
            etiquetas: actual.etiquetas
        };

        const hayDesfaseVersion = versionCliente !== null && versionCliente !== Number(actual.version) && !forzarResolucion;

        if (!hayDesfaseVersion) {
            // Actualización directa (versión coincide o resolución manual confirmada por el usuario)
            estadoFinal = {
                ...estadoFinal,
                ...camposRecibidos
            };
        } else {
            // La versión en la base de datos cambió: evaluar fusión automática vs conflicto 409
            const baseCliente = datos.base && typeof datos.base === 'object' ? datos.base : null;

            // Intentar recuperar qué campos cambiaron en el servidor desde el último historial si no hay base
            let camposCambiadosServidor = [];
            let camposCambiadosCliente = [];

            if (baseCliente) {
                for (const campo of CAMPOS_EDITABLES) {
                    if (Object.prototype.hasOwnProperty.call(baseCliente, campo)) {
                        const baseNorm = normalizarValorComparable(campo, baseCliente[campo]);
                        const srvNorm = normalizarValorComparable(campo, actual[campo]);
                        if (srvNorm !== baseNorm) {
                            camposCambiadosServidor.push(campo);
                        }
                        if (Object.prototype.hasOwnProperty.call(camposRecibidos, campo)) {
                            const cliNorm = normalizarValorComparable(campo, camposRecibidos[campo]);
                            if (cliNorm !== baseNorm) {
                                camposCambiadosCliente.push(campo);
                            }
                        }
                    }
                }
            } else {
                // Si no se envió objeto base, consultamos el último cambio en historial_tareas
                const { rows: histRows } = await cliente.query(
                    `SELECT detalle
                     FROM historial_tareas
                     WHERE tarea_id = $1 AND accion IN ('tarjeta_editada', 'tarjeta_fusionada')
                     ORDER BY creado_en DESC, id DESC
                     LIMIT 1`,
                    [id]
                );
                const ultimoDetalle = histRows[0]?.detalle;
                if (ultimoDetalle?.despues && typeof ultimoDetalle.despues === 'object') {
                    camposCambiadosServidor = Object.keys(ultimoDetalle.despues).filter((c) => CAMPOS_EDITABLES.includes(c));
                }

                camposCambiadosCliente = Object.keys(camposRecibidos).filter(
                    (campo) => normalizarValorComparable(campo, camposRecibidos[campo]) !== normalizarValorComparable(campo, actual[campo])
                );
            }

            // Determinar colisiones en el mismo campo con valores distintos
            const camposEnConflicto = camposCambiadosCliente.filter((campo) => {
                const tocadoEnServidor = camposCambiadosServidor.length > 0
                    ? camposCambiadosServidor.includes(campo)
                    : true;
                const difiereDeServidor = normalizarValorComparable(campo, camposRecibidos[campo]) !== normalizarValorComparable(campo, actual[campo]);
                return tocadoEnServidor && difiereDeServidor;
            });

            const puedeFusionarAutomatico =
                (baseCliente !== null || camposCambiadosServidor.length > 0) &&
                camposCambiadosCliente.length > 0 &&
                camposEnConflicto.length === 0;

            if (!puedeFusionarAutomatico) {
                const tarjetaServidor = await consultarTarjetaCompleta(id, cliente);
                const errorConflicto = new ErrorApp(
                    'Esta tarjeta cambió mientras la editabas. Revisa las diferencias para decidir cómo continuar.',
                    409
                );
                errorConflicto.detalles = {
                    codigo: 'conflicto_version',
                    tareaId: id,
                    versionCliente,
                    versionServidor: actual.version,
                    actual: tarjetaServidor,
                    propuestaCliente: {
                        ...estadoFinal,
                        ...camposRecibidos
                    },
                    base: baseCliente,
                    camposEnConflicto: camposEnConflicto.length ? camposEnConflicto : camposCambiadosCliente,
                    camposModificadosCliente: camposCambiadosCliente,
                    camposModificadosServidor: camposCambiadosServidor
                };
                throw errorConflicto;
            }

            // Fusión automática: conservar cambios del servidor y aplicar encima solo los campos distintos del cliente
            fusionadoAutomaticamente = true;
            camposFusionados = camposCambiadosCliente;
            for (const campo of camposCambiadosCliente) {
                estadoFinal[campo] = camposRecibidos[campo];
            }
        }

        const antesComparable = {
            titulo: actual.titulo,
            descripcion: actual.descripcion,
            responsable_id: actual.responsable_id,
            horas_estimadas: actual.horas_estimadas,
            etiquetas: actual.etiquetas
        };

        const cambiosDetectados = diferencias(antesComparable, estadoFinal);

        await cliente.query(
            `UPDATE tareas
             SET titulo = $1,
                 descripcion = $2,
                 responsable_id = $3,
                 horas_estimadas = $4,
                 etiquetas = $5,
                 version = version + 1,
                 actualizado_en = NOW()
             WHERE id = $6`,
            [
                estadoFinal.titulo,
                estadoFinal.descripcion,
                estadoFinal.responsable_id,
                estadoFinal.horas_estimadas,
                estadoFinal.etiquetas,
                id
            ]
        );

        if (cambiosDetectados) {
            await cliente.query(
                `INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle)
                 VALUES ($1, $2, $3, $4)`,
                [
                    id,
                    usuario.id,
                    fusionadoAutomaticamente ? 'tarjeta_fusionada' : 'tarjeta_editada',
                    JSON.stringify({
                        ...cambiosDetectados,
                        fusionadoAutomaticamente
                    })
                ]
            );

            await registrarAuditoria(cliente, {
                usuarioId: usuario.id,
                proyectoId: actual.proyecto_id,
                accion: ACCIONES.TAREA_MODIFICADA,
                objeto: OBJETOS.TAREA,
                objetoId: id,
                ...cambiosDetectados,
                contexto: fusionadoAutomaticamente ? { fusionado_automaticamente: true } : undefined
            });
        }

        retirarEditorActivo(id, usuario.id);
        const tareaActualizada = await consultarTarjetaCompleta(id, cliente);

        await cliente.query('COMMIT');

        resultadoTransaccion = {
            tarea: tareaActualizada,
            fusionadoAutomaticamente,
            camposFusionados
        };
    } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }

    const nombreUsuario = await obtenerNombreUsuario(usuario);

    // Emitir evento en tiempo real con la nueva versión para convergencia de estado
    emitirAProyecto(proyectoId, 'tarjeta:actualizada', {
        proyectoId,
        tareaId: id,
        version: resultadoTransaccion.tarea.version,
        usuarioId: Number(usuario.id),
        usuarioNombre: nombreUsuario,
        fusionadoAutomaticamente: resultadoTransaccion.fusionadoAutomaticamente,
        tarea: resultadoTransaccion.tarea
    });

    emitirAProyecto(proyectoId, 'tarjeta:editando', {
        proyectoId,
        tareaId: id,
        usuarioId: Number(usuario.id),
        usuarioNombre: nombreUsuario,
        editando: false,
        editores: resultadoTransaccion.tarea.editores
    });

    return resultadoTransaccion;
}

/**
 * Marca o desmarca una tarjeta como bloqueada y gestiona su vinculación con impedimentos.
 * @param {number|string} tareaId
 * @param {{bloqueada?: boolean, motivo?: string, motivo_bloqueo?: string, severidad?: string}} datos
 * @param {{id: number, nombre?: string}} usuario
 * @returns {Promise<Object>} Tarjeta actualizada.
 */
export async function cambiarBloqueoTarjeta(tareaId, datos = {}, usuario) {
    const id = validarIdEntero(tareaId);
    const { rows: ubicacion } = await consulta('SELECT proyecto_id FROM tareas WHERE id = $1', [id]);
    if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    const proyectoId = ubicacion[0].proyecto_id;
    await exigirPermiso(usuario, 'tarea.gestionar', proyectoId);

    const bloquear = datos.bloqueada !== undefined ? Boolean(datos.bloqueada) : true;
    const motivo = String(datos.motivo ?? datos.motivo_bloqueo ?? '').trim();

    if (bloquear && !motivo) {
        throw new ErrorApp('Debes indicar el motivo para bloquear la tarjeta.', 400);
    }

    const severidad = ['baja', 'media', 'alta'].includes(datos.severidad) ? datos.severidad : 'media';

    const cliente = await pool.connect();
    let tareaActualizada;

    try {
        await cliente.query('BEGIN');

        const { rows: actuales } = await cliente.query(
            `SELECT id, proyecto_id, sprint_id, titulo, bloqueada, motivo_bloqueo, responsable_id
             FROM tareas
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );
        if (!actuales.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
        const actual = actuales[0];

        await cliente.query(
            `UPDATE tareas
             SET bloqueada = $1,
                 motivo_bloqueo = $2,
                 version = version + 1,
                 actualizado_en = NOW()
             WHERE id = $3`,
            [bloquear, bloquear ? motivo : null, id]
        );

        if (bloquear) {
            // Crear impedimento vinculado si no tiene uno abierto
            const { rows: impExistente } = await cliente.query(
                `SELECT id FROM impedimentos WHERE tarea_id = $1 AND estado = 'abierto' LIMIT 1`,
                [id]
            );

            if (!impExistente.length) {
                const { rows: smRows } = await cliente.query(
                    `SELECT usuario_id FROM miembros_proyecto
                     WHERE proyecto_id = $1 AND rol = 'scrum_master'
                     LIMIT 1`,
                    [actual.proyecto_id]
                );
                const responsableImp = smRows[0]?.usuario_id || actual.responsable_id || usuario.id;

                const { rows: nuevoImp } = await cliente.query(
                    `INSERT INTO impedimentos (proyecto_id, sprint_id, tarea_id, titulo, severidad, responsable_id, estado, creado_por)
                     VALUES ($1, $2, $3, $4, $5, $6, 'abierto', $7)
                     RETURNING id`,
                    [actual.proyecto_id, actual.sprint_id, id, motivo, severidad, responsableImp, usuario.id]
                );

                await registrarAuditoria(cliente, {
                    usuarioId: usuario.id,
                    proyectoId: actual.proyecto_id,
                    accion: ACCIONES.IMPEDIMENTO_CREADO,
                    objeto: OBJETOS.IMPEDIMENTO,
                    objetoId: nuevoImp[0].id,
                    despues: { titulo: motivo, severidad, tarea_id: id, responsable_id: responsableImp }
                });
            }
        }

        await cliente.query(
            `INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle)
             VALUES ($1, $2, $3, $4)`,
            [
                id,
                usuario.id,
                bloquear ? 'tarjeta_bloqueada' : 'tarjeta_desbloqueada',
                JSON.stringify({ bloqueada: bloquear, motivo: bloquear ? motivo : null })
            ]
        );

        await registrarAuditoria(cliente, {
            usuarioId: usuario.id,
            proyectoId: actual.proyecto_id,
            accion: ACCIONES.TAREA_MODIFICADA,
            objeto: OBJETOS.TAREA,
            objetoId: id,
            antes: { bloqueada: actual.bloqueada, motivo_bloqueo: actual.motivo_bloqueo },
            despues: { bloqueada: bloquear, motivo_bloqueo: bloquear ? motivo : null }
        });

        tareaActualizada = await consultarTarjetaCompleta(id, cliente);
        await cliente.query('COMMIT');
    } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }

    const nombreUsuario = await obtenerNombreUsuario(usuario);

    emitirAProyecto(proyectoId, 'tarjeta:bloqueo_cambiado', {
        proyectoId,
        tareaId: id,
        bloqueada: tareaActualizada.bloqueada,
        motivoBloqueo: tareaActualizada.motivo_bloqueo,
        version: tareaActualizada.version,
        usuarioId: Number(usuario.id),
        usuarioNombre: nombreUsuario,
        tarea: tareaActualizada
    });

    emitirAProyecto(proyectoId, 'tarjeta:actualizada', {
        proyectoId,
        tareaId: id,
        version: tareaActualizada.version,
        usuarioId: Number(usuario.id),
        usuarioNombre: nombreUsuario,
        tarea: tareaActualizada
    });

    return tareaActualizada;
}

/**
 * Mueve una tarjeta de columna incrementando su versión
 * y emitiendo el estado convergente a todos los clientes del proyecto.
 * @param {number|string} tareaId
 * @param {{nuevaColumnaId?: number|string, columna_id?: number|string, nuevoOrden?: number}} datos
 * @param {{id: number, nombre?: string}} usuario
 * @returns {Promise<Object>} Tarjeta actualizada.
 */
export async function moverTarjetaConVersion(tareaId, datos = {}, usuario) {
    const id = validarIdEntero(tareaId);
    const nuevaColumnaId = validarIdEntero(
        datos.nuevaColumnaId ?? datos.columna_id,
        'Selecciona una columna destino válida.'
    );
    const ordenSolicitado = Number.isInteger(Number(datos.nuevoOrden)) && datos.nuevoOrden !== null && datos.nuevoOrden !== ''
        ? Number(datos.nuevoOrden)
        : null;

    const { rows: ubicacion } = await consulta('SELECT proyecto_id FROM tareas WHERE id = $1', [id]);
    if (!ubicacion.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);

    const proyectoId = ubicacion[0].proyecto_id;
    await exigirPermiso(usuario, 'tarea.gestionar', proyectoId);

    const cliente = await pool.connect();
    let tareaActualizada;
    let columnaOrigenNombre = null;
    let columnaDestinoNombre = null;

    try {
        await cliente.query('BEGIN');

        const { rows: tareas } = await cliente.query(
            `SELECT t.id, t.proyecto_id, t.columna_id, t.orden, t.bloqueada, t.version,
                    c.nombre AS columna_origen_nombre
             FROM tareas t
             LEFT JOIN columnas_tablero c ON c.id = t.columna_id
             WHERE t.id = $1
             FOR UPDATE OF t`,
            [id]
        );
        if (!tareas.length) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
        const tareaActual = tareas[0];
        columnaOrigenNombre = tareaActual.columna_origen_nombre;

        const { rows: colsDestino } = await cliente.query(
            `SELECT id, nombre, limite_wip, wip_duro, es_final
             FROM columnas_tablero
             WHERE id = $1 AND proyecto_id = $2`,
            [nuevaColumnaId, proyectoId]
        );
        if (!colsDestino.length) {
            throw new ErrorApp('La columna destino no pertenece a este proyecto.', 400);
        }
        const colDestino = colsDestino[0];
        columnaDestinoNombre = colDestino.nombre;

        //Impedir mover una tarjeta bloqueada a la columna final ("Hecho")
        if (tareaActual.bloqueada && colDestino.es_final) {
            throw new ErrorApp('No puedes mover una tarjeta bloqueada a la columna Hecho.', 409);
        }

        //Si la columna tiene límite WIP duro y es distinta de la columna actual, validar cupo
        if (colDestino.limite_wip && colDestino.wip_duro && Number(tareaActual.columna_id) !== nuevaColumnaId) {
            const { rows: conteo } = await cliente.query(
                `SELECT COUNT(*)::int AS total
                 FROM tareas
                 WHERE proyecto_id = $1 AND columna_id = $2 AND id <> $3`,
                [proyectoId, nuevaColumnaId, id]
            );
            if (conteo[0].total >= colDestino.limite_wip) {
                throw new ErrorApp(
                    `La columna «${colDestino.nombre}» alcanzó su límite WIP duro (${colDestino.limite_wip}).`,
                    409
                );
            }
        }

        await cliente.query(
            `UPDATE tareas
             SET columna_id = $1,
                 orden = COALESCE($2::int, (SELECT COALESCE(MAX(t2.orden), 0) + 1 FROM tareas t2 WHERE t2.columna_id = $1 AND t2.proyecto_id = $4)),
                 version = version + 1,
                 actualizado_en = NOW()
             WHERE id = $3 AND proyecto_id = $4`,
            [nuevaColumnaId, ordenSolicitado, id, proyectoId]
        );

        await cliente.query(
            `INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle)
             VALUES ($1, $2, 'tarjeta_movida', $3)`,
            [
                id,
                usuario.id,
                JSON.stringify({
                    columna_origen: columnaOrigenNombre,
                    columna_destino: columnaDestinoNombre,
                    columna_id_anterior: tareaActual.columna_id,
                    columna_id_nueva: nuevaColumnaId
                })
            ]
        );

        await registrarAuditoria(cliente, {
            usuarioId: usuario.id,
            proyectoId,
            accion: ACCIONES.TAREA_MOVIDA,
            objeto: OBJETOS.TAREA,
            objetoId: id,
            antes: { columna_id: tareaActual.columna_id },
            despues: { columna_id: nuevaColumnaId },
            contexto: {
                columna_origen: columnaOrigenNombre,
                columna_destino: columnaDestinoNombre
            }
        });

        tareaActualizada = await consultarTarjetaCompleta(id, cliente);
        await cliente.query('COMMIT');
    } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }

    const usuarioNombre = await obtenerNombreUsuario(usuario);
    const payloadMovimiento = {
        proyectoId,
        tareaId: id,
        columnaId: nuevaColumnaId,
        nuevaColumnaId,
        orden: tareaActualizada.orden,
        version: tareaActualizada.version,
        usuarioId: Number(usuario.id),
        usuarioNombre,
        tarea: tareaActualizada
    };

    emitirAProyecto(proyectoId, 'tablero:tarjeta_movida', payloadMovimiento);
    emitirAProyecto(proyectoId, 'tablero:tarjeta-movida', payloadMovimiento);
    emitirAProyecto(proyectoId, 'tarjeta:actualizada', payloadMovimiento);

    return tareaActualizada;
}