/**
 * @file invitaciones.service.js
 * @description Lógica de negocio de las invitaciones a equipos, reglas, SQL y avisos por socket (invitar por correo y alta directa).
 * @author Citlaly Morales Viveros
 */

import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enviarCorreo } from '../../utils/correo.js';
import { esAdminEquipo, esMiembroEquipo, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { esCorreoValido } from '../../utils/validar.js';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { registrarAuditoria, enTransaccion, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';

/**
 * Registra en la bitácora que una persona recibió un rol en un proyecto. Consulta el rol que tenía antes
 * para distinguir una asignación nueva de un cambio; si el rol es el mismo no registra nada.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción. Debe llamarse antes de guardar el rol.
 * @param {number} actorId - Quien realiza la acción.
 * @param {number} proyectoId - Proyecto en el que se asigna el rol.
 * @param {number} usuarioId - Persona que recibe el rol.
 * @param {string} rol - Rol asignado.
 * @returns {Promise<void>}
 */
async function auditarRolAsignado(cliente, actorId, proyectoId, usuarioId, rol) {
    const { rows } = await cliente.query(
        'SELECT rol FROM miembros_proyecto WHERE proyecto_id = $1 AND usuario_id = $2',
        [proyectoId, usuarioId]
    );
    const rolAnterior = rows[0]?.rol ?? null;
    if (rolAnterior === rol) return;
    await registrarAuditoria(cliente, {
        usuarioId: actorId,
        proyectoId,
        accion: rolAnterior ? ACCIONES.ROL_PROYECTO_MODIFICADO : ACCIONES.ROL_PROYECTO_ASIGNADO,
        objeto: OBJETOS.PROYECTO,
        objetoId: proyectoId,
        contexto: { usuario_id: usuarioId, rol_anterior: rolAnterior, rol_nuevo: rol },
    });
}

/**
 * Registra en la bitácora la aceptación de una invitación ligada a un proyecto y, si trae rol, la asignación
 * de ese rol. Las invitaciones que solo corresponden a un equipo no se registran.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción. Debe llamarse antes de guardar el rol.
 * @param {{id: number, correo: string, proyecto_id: number|null, rol: string|null}} inv - Invitación aceptada.
 * @param {number} usuarioId - Persona que acepta la invitación.
 * @returns {Promise<void>}
 */
async function auditarAceptacion(cliente, inv, usuarioId) {
    if (!inv.proyecto_id) return;
    await registrarAuditoria(cliente, {
        usuarioId,
        proyectoId: inv.proyecto_id,
        accion: ACCIONES.INVITACION_ACEPTADA,
        objeto: OBJETOS.INVITACION,
        objetoId: inv.id,
        antes: { estado: 'pendiente' },
        despues: { estado: 'aceptada' },
        contexto: { correo: inv.correo, rol: inv.rol },
    });
    if (inv.rol) await auditarRolAsignado(cliente, usuarioId, inv.proyecto_id, usuarioId, inv.rol);
}

const EXPIRACION_INVITACION_HORAS = 72;
const ROLES_PERMITIDOS = ['scrum_master', 'product_owner', 'developer'];

/** Roles que solo puede ocupar una persona por proyecto, con el nombre que se muestra en los mensajes. */
const ROLES_UNICOS = { scrum_master: 'Scrum Master', product_owner: 'Product Owner' };

/** Índices únicos de miembros_proyecto que protegen cada rol de ocupación única. */
const INDICE_ROL_UNICO = {
    ux_un_scrum_master_por_proyecto: 'scrum_master',
    ux_un_product_owner_por_proyecto: 'product_owner'
};

/**
 * Construye el error 409 que se responde cuando otra persona ya ocupa el rol en el proyecto.
 *
 * @param {string} rol - Rol de ocupación única (scrum_master o product_owner).
 * @param {boolean} [deInvitacion=false] - true si el rol se asigna al aceptar una invitación.
 * @returns {ErrorApp}
 */
function errorRolOcupado(rol, deInvitacion = false) {
    const indicacion = deInvitacion
        ? 'Pide que liberen ese rol y vuelve a aceptar la invitación.'
        : 'Libera ese rol e inténtalo de nuevo.';
    return new ErrorApp(`El proyecto ya tiene un ${ROLES_UNICOS[rol]}. ${indicacion}`, 409);
}

/**
 * Comprueba que el rol de ocupación única no lo tenga otra persona en el proyecto.
 * Los roles que admiten varias personas (developer) no se consultan.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción en curso.
 * @param {number} proyectoId - Proyecto al que se asigna el rol.
 * @param {number|null} usuarioId - Persona que recibirá el rol; null si la cuenta aún no existe.
 * @param {string} rol - Rol que se quiere asignar.
 * @param {boolean} [deInvitacion=false] - true si el rol se asigna al aceptar una invitación.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 409 si el rol ya está ocupado por otra persona.
 */
async function exigirRolLibre(cliente, proyectoId, usuarioId, rol, deInvitacion = false) {
    if (!ROLES_UNICOS[rol]) return;
    const { rows } = await cliente.query(`
        SELECT 1 FROM miembros_proyecto
        WHERE proyecto_id = $1 AND rol = $2 AND usuario_id IS DISTINCT FROM $3::int
    `, [proyectoId, rol, usuarioId]);
    if (rows.length > 0) throw errorRolOcupado(rol, deInvitacion);
}

/**
 * Convierte la violación del índice único de un rol en el mismo 409 de la consulta previa.
 * Cubre el caso de dos personas que toman el rol al mismo tiempo. Cualquier otro error se devuelve igual.
 *
 * @param {Error} error - Error capturado al guardar.
 * @param {boolean} [deInvitacion=false] - true si el rol se asigna al aceptar una invitación.
 * @returns {Error}
 */
function traducirErrorRol(error, deInvitacion = false) {
    const rol = error?.code === '23505' ? INDICE_ROL_UNICO[error.constraint] : undefined;
    return rol ? errorRolOcupado(rol, deInvitacion) : error;
}

/**
 * Exige que la persona administre el equipo de una invitación. Quien no tiene ningún vínculo con
 * el equipo recibe el mismo 404 que si la invitación no existiera.
 *
 * @param {Object|undefined} invitacion - Fila de la invitación (con equipo_id), o undefined si no existe.
 * @param {{id: number}} usuario - Usuario autenticado.
 * @returns {Promise<void>}
 * @throws {ErrorApp} 404 si no existe o la persona no tiene vínculo con el equipo; 403 si es del equipo pero no lo administra.
 */
async function exigirAdminDeInvitacion(invitacion, usuario) {
    if (!invitacion) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    if (await esAdminEquipo(usuario, invitacion.equipo_id)) return;
    if (!(await esMiembroEquipo(usuario, invitacion.equipo_id))) throw new ErrorApp(MENSAJE_NO_ENCONTRADO, 404);
    throw new ErrorApp('No tienes permisos para gestionar esta invitación.', 403);
}

/**
 * Genera un token seguro y su hash (reutiliza patrón de usuarios.service.js).
 */
function generarToken() {
    const tokenPlano = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    return { tokenPlano, tokenHash };
}

/**
 * Avisa por correo a una persona con cuenta que fue agregada a un equipo. Un fallo en el envío
 * solo se registra en consola y nunca revierte la membresía ya guardada.
 *
 * @param {{nombre: string|null, correo: string}} destinatario - Persona agregada.
 * @param {string|null} nombreProyecto - Proyecto al que se le asignó, si hubo uno.
 * @param {string|undefined} rol - Rol asignado en el proyecto, si hubo uno.
 * @returns {Promise<boolean>} true si el correo se envió.
 */
async function avisarAgregadoAEquipo(destinatario, nombreProyecto, rol) {
    const saludo = destinatario.nombre ? `Hola ${destinatario.nombre},` : 'Hola,';
    const detalleProyecto = nombreProyecto && rol
        ? `\n\nTu rol en el proyecto «${nombreProyecto}» es: ${rol}.`
        : '';
    try {
        await enviarCorreo({
            para: destinatario.correo,
            asunto: 'Fuiste agregado a un equipo en ScrumFlow',
            texto: `${saludo}\n\nUna persona administradora te agregó a un equipo en ScrumFlow.${detalleProyecto}\n\nPuedes iniciar sesión en: ${env.APP_URL}/pages/login.html`
        });
        return true;
    } catch (error) {
        console.error('[invitaciones] No se pudo enviar el correo de aviso:', error?.message ?? error);
        return false;
    }
}

/**
 * Crea una invitación para un correo.
 * @param {Object} datos - {correo, equipo_id, proyecto_id (opcional), rol (opcional)}
 * @param {Object} usuario - Usuario autenticado (req.user)
 * @returns {Promise<Object>} Invitación creada
 */
export async function crearInvitacion(datos, usuario) {
    // Se aplican valores por defecto (null) para evitar que node-postgres arroje error al recibir variables undefined
    const { correo, equipo_id, proyecto_id = null, rol = null } = datos;
    const correoLimpio = correo.trim().toLowerCase();

    if (!(await esAdminEquipo(usuario, equipo_id))) {
        throw new ErrorApp('No tienes permisos para invitar a este equipo.', 403);
    }

    if (!esCorreoValido(correoLimpio)) {
        throw new ErrorApp('El formato del correo es inválido.', 400);
    }

    if (rol && !ROLES_PERMITIDOS.includes(rol)) {
        throw new ErrorApp('Rol no válido.', 400);
    }

    if (proyecto_id) {
        const { rows } = await consulta('SELECT 1 FROM proyectos WHERE id = $1 AND equipo_id = $2', [proyecto_id, equipo_id]);
        if (!rows.length) throw new ErrorApp('El proyecto no pertenece a este equipo.', 400);
    }

    const { rows: eqRows } = await consulta('SELECT nombre FROM equipos WHERE id = $1', [equipo_id]);
    const equipoNombre = eqRows[0]?.nombre || 'un equipo';

    const { rows: usuarioExistente } = await consulta('SELECT id, nombre FROM usuarios WHERE correo = $1', [correoLimpio]);
    if (usuarioExistente.length > 0) {
        throw new ErrorApp('El correo ya está registrado.', 409, {
            usuario: usuarioExistente[0],
            pregunta: '¿Deseas agregar a este usuario al equipo?'
        });
    }

    const { tokenPlano, tokenHash } = generarToken();
    const expiraEn = new Date(Date.now() + EXPIRACION_INVITACION_HORAS * 60 * 60 * 1000);

    const rows = await enTransaccion(async (cliente) => {
        const { rows: creadas } = await cliente.query(`
        INSERT INTO invitaciones (correo, equipo_id, proyecto_id, rol, token_hash, expira_en, invitado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, correo, equipo_id, proyecto_id, rol, estado, expira_en, creado_en
    `, [correoLimpio, equipo_id, proyecto_id, rol, tokenHash, expiraEn, usuario.id]);

        if (proyecto_id) {
            await registrarAuditoria(cliente, {
                usuarioId: usuario.id,
                proyectoId: proyecto_id,
                accion: ACCIONES.INVITACION_CREADA,
                objeto: OBJETOS.INVITACION,
                objetoId: creadas[0].id,
                despues: { correo: correoLimpio, rol },
            });
        }
        return creadas;
    });

    const invitacionId = rows[0].id;
    const enlace = `${env.APP_URL}/pages/aceptar-invitacion.html?token=${tokenPlano}`;

    try {
        await enviarCorreo({
            para: correoLimpio,
            asunto: `Invitación a ScrumFlow - Equipo ${equipoNombre}`,
            texto: `Has sido invitado a unirte al equipo "${equipoNombre}" en ScrumFlow.\n\nPara aceptar, haz clic en: ${enlace}\n\nEste enlace expirará en ${EXPIRACION_INVITACION_HORAS} horas.`
        });
    } catch (error) {
        await consulta(`UPDATE invitaciones SET estado = 'fallida' WHERE id = $1`, [invitacionId]);
        throw new ErrorApp('El correo rebotó o falló la entrega. La invitación se marcó como fallida.', 500);
    }

    return rows[0];
}

/**
 * Da de alta a un usuario directamente en un equipo y le envía un enlace para definir su contraseña.
 * @param {Object} datos - {nombre, correo, equipo_id, proyecto_id (opcional), rol (opcional)}
 * @param {Object} usuario - Usuario autenticado
 * @returns {Promise<Object>}
 */
export async function altaDirecta(datos, usuario) {
    const { nombre, correo, equipo_id, proyecto_id = null, rol = null } = datos;
    const correoLimpio = correo.trim().toLowerCase();

    if (!(await esAdminEquipo(usuario, equipo_id))) {
        throw new ErrorApp('No tienes permisos para dar de alta en este equipo.', 403);
    }

    if (!esCorreoValido(correoLimpio)) {
        throw new ErrorApp('El formato del correo es inválido.', 400);
    }

    if (rol && !ROLES_PERMITIDOS.includes(rol)) {
        throw new ErrorApp('Rol no válido.', 400);
    }

    if (proyecto_id) {
        const { rows } = await consulta('SELECT 1 FROM proyectos WHERE id = $1 AND equipo_id = $2', [proyecto_id, equipo_id]);
        if (!rows.length) throw new ErrorApp('El proyecto no pertenece a este equipo.', 400);
    }

    const { rows: usuarioExistente } = await consulta('SELECT id, nombre FROM usuarios WHERE correo = $1', [correoLimpio]);
    if (usuarioExistente.length > 0) {
        throw new ErrorApp('El correo ya está registrado.', 409, {
            usuario: usuarioExistente[0],
            pregunta: '¿Deseas agregar a este usuario al equipo?'
        });
    }

    return pool.connect().then(async (cliente) => {
        try {
            await cliente.query('BEGIN');

            if (proyecto_id && rol) await exigirRolLibre(cliente, proyecto_id, null, rol);

            const { rows: nuevoUsuario } = await cliente.query(`
                INSERT INTO usuarios (nombre, correo, activo)
                VALUES ($1, $2, TRUE) RETURNING id
            `, [nombre.trim(), correoLimpio]);
            const usuarioId = nuevoUsuario[0].id;

            await cliente.query(`
                INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)
            `, [equipo_id, usuarioId]);

            if (proyecto_id && rol) {
                await auditarRolAsignado(cliente, usuario.id, proyecto_id, usuarioId, rol);
                await cliente.query(`
                    INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                    VALUES ($1, $2, $3)
                `, [proyecto_id, usuarioId, rol]);
            }

            const { tokenPlano, tokenHash } = generarToken();
            const expiraEn = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await cliente.query(`
                INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en)
                VALUES ($1, $2, $3)
            `, [usuarioId, tokenHash, expiraEn]);

            await cliente.query('COMMIT');

            const enlacePassword = `${env.APP_URL}/pages/definir-password.html?token=${tokenPlano}`;
            try {
                await enviarCorreo({
                    para: correoLimpio,
                    asunto: 'Bienvenido a ScrumFlow',
                    texto: `Hola ${nombre.trim()},\n\nHas sido dado de alta en un equipo en ScrumFlow.\n\nPara activar tu cuenta y definir tu contraseña, haz clic en: ${enlacePassword}\n\nEste enlace expirará en 24 horas.`
                });
            } catch (error) {
                console.error('[invitaciones] Error enviando correo de alta directa:', error?.message ?? error);
            }

            return { mensaje: 'Cuenta creada y agregada al equipo correctamente.' };
        } catch (error) {
            await cliente.query('ROLLBACK');
            throw traducirErrorRol(error);
        } finally {
            cliente.release();
        }
    });
}

/**
 * Acepta una invitación usando el token.
 * Todo ocurre en una sola transacción: la invitación se bloquea y se valida (token, estado y
 * expiración) y solo queda aceptada si la persona entra al equipo y, cuando la invitación trae
 * proyecto y rol, también al proyecto. Si algo falla se revierte todo y la invitación sigue pendiente.
 *
 * @param {string} tokenPlano - Token recibido en el enlace.
 * @param {{id: number}|null} [usuario=null] - Sesión de quien acepta, si la hay; su correo debe ser el de la invitación.
 * @returns {Promise<{mensaje: string}>}
 * @throws {ErrorApp} 400 si la invitación no es válida o expiró; 403 si es de otra cuenta o la cuenta está inactiva;
 * 409 si el rol de Scrum Master o Product Owner ya lo ocupa otra persona en el proyecto.
 */
export async function aceptarInvitacion(tokenPlano, usuario = null) {
    if (typeof tokenPlano !== 'string' || !tokenPlano) throw new ErrorApp('Invitación inválida o expirada.', 400);
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');

    const cliente = await pool.connect();
    try {
        await cliente.query('BEGIN');

        const { rows: invitacion } = await cliente.query(`
            SELECT * FROM invitaciones
            WHERE token_hash = $1 AND estado = 'pendiente' AND expira_en > NOW()
            FOR UPDATE
        `, [tokenHash]);

        if (!invitacion.length) throw new ErrorApp('Invitación inválida o expirada.', 400);

        const inv = invitacion[0];

        if (usuario?.id) {
            const { rows: sesion } = await cliente.query(
                'SELECT correo FROM usuarios WHERE id = $1 AND activo = TRUE',
                [usuario.id]
            );
            if (!sesion.length || sesion[0].correo.toLowerCase() !== inv.correo.toLowerCase()) {
                throw new ErrorApp('Esta invitación no corresponde a tu cuenta.', 403);
            }
        }

        const { rows: usuarioExistente } = await cliente.query(
            'SELECT id, activo FROM usuarios WHERE correo = $1',
            [inv.correo]
        );
        if (usuarioExistente.length > 0 && !usuarioExistente[0].activo) {
            throw new ErrorApp('La cuenta asociada a esta invitación no está activa.', 403);
        }

        if (inv.proyecto_id && inv.rol) {
            await exigirRolLibre(cliente, inv.proyecto_id, usuarioExistente[0]?.id ?? null, inv.rol, true);
        }

        await cliente.query('UPDATE invitaciones SET estado = $1 WHERE id = $2', ['aceptada', inv.id]);

        if (usuarioExistente.length > 0) {
            const usuarioId = usuarioExistente[0].id;
            await auditarAceptacion(cliente, inv, usuarioId);
            await cliente.query(`
                INSERT INTO miembros_equipo (equipo_id, usuario_id)
                VALUES ($1, $2) ON CONFLICT DO NOTHING
            `, [inv.equipo_id, usuarioId]);

            if (inv.proyecto_id && inv.rol) {
                await cliente.query(`
                    INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol
                `, [inv.proyecto_id, usuarioId, inv.rol]);
            }
        } else {
            // Previene que inserciones fallen si el campo nombre es requerido por la base de datos
            const nombreProvisional = inv.correo.split('@')[0];
            const { rows: nuevoUsuario } = await cliente.query(`
                INSERT INTO usuarios (nombre, correo, activo)
                VALUES ($1, $2, TRUE) RETURNING id
            `, [nombreProvisional, inv.correo]);
            const usuarioId = nuevoUsuario[0].id;
            await auditarAceptacion(cliente, inv, usuarioId);

            await cliente.query(`
                INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)
            `, [inv.equipo_id, usuarioId]);

            if (inv.proyecto_id && inv.rol) {
                await cliente.query(`
                    INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                    VALUES ($1, $2, $3)
                `, [inv.proyecto_id, usuarioId, inv.rol]);
            }

            const { tokenPlano: tokenPassword, tokenHash: tokenHashPassword } = generarToken();
            const expiraEnPassword = new Date(Date.now() + 24 * 60 * 60 * 1000);

            await cliente.query(`
                INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en)
                VALUES ($1, $2, $3)
            `, [usuarioId, tokenHashPassword, expiraEnPassword]);

            const enlacePassword = `${env.APP_URL}/pages/definir-password.html?token=${tokenPassword}`;
            await enviarCorreo({
                para: inv.correo,
                asunto: 'Define tu contraseña en ScrumFlow',
                texto: `Bienvenido a ScrumFlow.\n\nPara definir tu contraseña, haz clic en: ${enlacePassword}\n\nEste enlace expirará en 24 horas.`
            });
        }

        await cliente.query('COMMIT');
        return { mensaje: 'Invitación aceptada. Revisa tu correo si eres nuevo usuario.' };
    } catch (error) {
        await cliente.query('ROLLBACK');
        throw traducirErrorRol(error, true);
    } finally {
        cliente.release();
    }
}

/**
 * Reenvía una invitación (genera nuevo token).
 */
export async function reenviarInvitacion(invitacionId, usuario) {
    const { rows: invitacion } = await consulta(`
        SELECT i.*, e.id AS equipo_id FROM invitaciones i
        JOIN equipos e ON e.id = i.equipo_id
        WHERE i.id = $1
    `, [invitacionId]);

    await exigirAdminDeInvitacion(invitacion[0], usuario);

    if (invitacion[0].estado === 'aceptada') throw new ErrorApp('La invitación ya fue aceptada.', 409);

    const { tokenPlano, tokenHash } = generarToken();
    const expiraEn = new Date(Date.now() + EXPIRACION_INVITACION_HORAS * 60 * 60 * 1000);

    await enTransaccion(async (cliente) => {
        await cliente.query(`
        UPDATE invitaciones
        SET token_hash = $1, expira_en = $2, estado = 'pendiente'
        WHERE id = $3
    `, [tokenHash, expiraEn, invitacionId]);

        if (invitacion[0].proyecto_id) {
            await registrarAuditoria(cliente, {
                usuarioId: usuario.id,
                proyectoId: invitacion[0].proyecto_id,
                accion: ACCIONES.INVITACION_REENVIADA,
                objeto: OBJETOS.INVITACION,
                objetoId: invitacion[0].id,
                antes: { estado: invitacion[0].estado },
                despues: { estado: 'pendiente' },
                contexto: { correo: invitacion[0].correo },
            });
        }
    });

    const enlace = `${env.APP_URL}/pages/aceptar-invitacion.html?token=${tokenPlano}`;
    await enviarCorreo({
        para: invitacion[0].correo,
        asunto: 'Invitación a ScrumFlow (reenvío)',
        texto: `Te reenviamos la invitación para unirte a ScrumFlow.\n\nPara aceptar, haz clic en: ${enlace}\n\nEste enlace expirará en ${EXPIRACION_INVITACION_HORAS} horas.`
    });

    return { mensaje: 'Invitación reenviada.' };
}

/**
 * Cancela una invitación.
 */
export async function cancelarInvitacion(invitacionId, usuario) {
    const { rows: invitacion } = await consulta(`
        SELECT i.*, e.id AS equipo_id FROM invitaciones i
        JOIN equipos e ON e.id = i.equipo_id
        WHERE i.id = $1
    `, [invitacionId]);

    await exigirAdminDeInvitacion(invitacion[0], usuario);

    if (invitacion[0].estado === 'aceptada') throw new ErrorApp('La invitación ya fue aceptada.', 409);

    await enTransaccion(async (cliente) => {
        await cliente.query('UPDATE invitaciones SET estado = $1 WHERE id = $2', ['fallida', invitacionId]);

        if (invitacion[0].proyecto_id) {
            await registrarAuditoria(cliente, {
                usuarioId: usuario.id,
                proyectoId: invitacion[0].proyecto_id,
                accion: ACCIONES.INVITACION_CANCELADA,
                objeto: OBJETOS.INVITACION,
                objetoId: invitacion[0].id,
                antes: { estado: invitacion[0].estado },
                despues: { estado: 'cancelada' },
                contexto: { correo: invitacion[0].correo },
            });
        }
    });
    return { mensaje: 'Invitación cancelada.' };
}

/**
 * Lista invitaciones pendientes de un equipo.
 */
export async function listarInvitaciones(equipoId, usuario) {
    if (!(await esAdminEquipo(usuario, equipoId))) {
        throw new ErrorApp('No tienes permisos para ver las invitaciones de este equipo.', 403);
    }

    const { rows } = await consulta(`
        SELECT id, correo, proyecto_id, rol, estado, expira_en, creado_en
        FROM invitaciones
        WHERE equipo_id = $1
        ORDER BY creado_en DESC
    `, [equipoId]);

    return rows;
}

/**
 * Agrega un usuario existente a un equipo (para correo ya registrado) y le avisa por correo.
 */
export async function agregarUsuarioExistente(datos, usuario) {
    const { usuario_id, equipo_id, proyecto_id = null, rol = null } = datos;

    if (!(await esAdminEquipo(usuario, equipo_id))) {
        throw new ErrorApp('No tienes permisos para agregar usuarios a este equipo.', 403);
    }

    if (rol && !ROLES_PERMITIDOS.includes(rol)) {
        throw new ErrorApp('Rol no válido.', 400);
    }

    let nombreProyecto = null;
    if (proyecto_id) {
        const { rows } = await consulta('SELECT nombre FROM proyectos WHERE id = $1 AND equipo_id = $2', [proyecto_id, equipo_id]);
        if (!rows.length) throw new ErrorApp('El proyecto no pertenece a este equipo.', 400);
        nombreProyecto = rows[0].nombre;
    }

    const { rows: destinatario } = await consulta('SELECT nombre, correo FROM usuarios WHERE id = $1 AND activo = TRUE', [usuario_id]);
    if (!destinatario.length) {
        throw new ErrorApp('El usuario no existe o no está activo.', 404);
    }

    const { rows: existente } = await consulta(`
        SELECT 1 FROM miembros_equipo
        WHERE equipo_id = $1 AND usuario_id = $2
    `, [equipo_id, usuario_id]);

    if (existente.length > 0) {
        throw new ErrorApp('El usuario ya es miembro de este equipo.', 409);
    }

    return pool.connect().then(async (cliente) => {
        try {
            await cliente.query('BEGIN');

            if (proyecto_id && rol) await exigirRolLibre(cliente, proyecto_id, usuario_id, rol);

            await cliente.query(`
                INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)
            `, [equipo_id, usuario_id]);

            if (proyecto_id && rol) {
                await auditarRolAsignado(cliente, usuario.id, proyecto_id, usuario_id, rol);
                await cliente.query(`
                    INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol
                `, [proyecto_id, usuario_id, rol]);
            }
            await cliente.query('COMMIT');
        } catch (error) {
            await cliente.query('ROLLBACK');
            throw traducirErrorRol(error);
        } finally {
            cliente.release();
        }

        await avisarAgregadoAEquipo(destinatario[0], nombreProyecto, rol);
        return { mensaje: 'Usuario agregado al equipo.' };
    });
}

/**
 * Rechaza una invitación recibida.
 */
export async function rechazarInvitacion(tokenPlano) {
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    const rechazadas = await enTransaccion(async (cliente) => {
        const { rows } = await cliente.query(`
        UPDATE invitaciones SET estado = 'rechazada'
        WHERE token_hash = $1 AND estado = 'pendiente' AND expira_en > NOW()
        RETURNING id, proyecto_id, correo, rol
    `, [tokenHash]);

        if (rows[0]?.proyecto_id) {
            await registrarAuditoria(cliente, {
                usuarioId: null,
                proyectoId: rows[0].proyecto_id,
                accion: ACCIONES.INVITACION_RECHAZADA,
                objeto: OBJETOS.INVITACION,
                objetoId: rows[0].id,
                antes: { estado: 'pendiente' },
                despues: { estado: 'rechazada' },
                contexto: { correo: rows[0].correo, rol: rows[0].rol },
            });
        }
        return rows.length;
    });
    if (rechazadas === 0) throw new ErrorApp('Invitación inválida o expirada.', 400);
    return { mensaje: 'Has rechazado la invitación correctamente.' };
}