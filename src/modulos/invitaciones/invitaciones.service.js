// Responsable: Citlaly - HU-39: reglas, SQL y avisos por socket (invitar por correo y alta directa)

import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { enviarCorreo } from '../../utils/correo.js';
import { esAdminEquipo } from '../../utils/permisos.js'; 
import crypto from 'crypto';
import { env } from '../../config/env.js';

/**
 * @file invitaciones.service.js
 * @description Lógica de negocio de las invitaciones a equipos.
 * @author Citlaly Morales Viveros
 */

const EXPIRACION_INVITACION_HORAS = 72;
const ROLES_PERMITIDOS = ['scrum_master', 'product_owner', 'developer'];

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
    const { correo, equipo_id, proyecto_id, rol } = datos;
    const correoLimpio = correo.trim().toLowerCase();

    if (!(await esAdminEquipo(usuario, equipo_id))) {
        throw new ErrorApp('No tienes permisos para invitar a este equipo.', 403);
    }

    // Validar rol
    if (rol && !ROLES_PERMITIDOS.includes(rol)) {
        throw new ErrorApp('Rol no válido.', 400);
    }

    // Validar que el proyecto pertenece al equipo (si se proporciona)
    if (proyecto_id) {
        const { rows } = await consulta('SELECT 1 FROM proyectos WHERE id = $1 AND equipo_id = $2', [proyecto_id, equipo_id]);
        if (!rows.length) throw new ErrorApp('El proyecto no pertenece a este equipo.', 400);
    }

    // Verificar si el correo ya está registrado
    const { rows: usuarioExistente } = await consulta('SELECT id, nombre FROM usuarios WHERE correo = $1', [correoLimpio]);
    if (usuarioExistente.length > 0) {
        throw new ErrorApp('El correo ya está registrado.', 409, {
            usuario: usuarioExistente[0],
            pregunta: '¿Deseas agregar a este usuario al equipo?'
        });
    }

    // Generar token y guardar invitación
    const { tokenPlano, tokenHash } = generarToken();
    const expiraEn = new Date(Date.now() + EXPIRACION_INVITACION_HORAS * 60 * 60 * 1000);

    const { rows } = await consulta(`
        INSERT INTO invitaciones (correo, equipo_id, proyecto_id, rol, token_hash, expira_en, invitado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, correo, equipo_id, proyecto_id, rol, estado, expira_en, creado_en
    `, [correoLimpio, equipo_id, proyecto_id, rol, tokenHash, expiraEn, usuario.id]);

    const enlace = `${env.APP_URL}/pages/aceptar-invitacion.html?token=${tokenPlano}`;
    await enviarCorreo({
        para: correoLimpio,
        asunto: 'Invitación a ScrumFlow',
        texto: `Has sido invitado a unirte a un equipo en ScrumFlow.\n\nPara aceptar, haz clic en: ${enlace}\n\nEste enlace expirará en ${EXPIRACION_INVITACION_HORAS} horas.`
    });

    return rows[0];
}

/**
 * Acepta una invitación usando el token.
 */
export async function aceptarInvitacion(tokenPlano) {
    const tokenHash = crypto.createHash('sha256').update(tokenPlano).digest('hex');
    const { rows: invitacion } = await consulta(`
        SELECT * FROM invitaciones
        WHERE token_hash = $1 AND estado = 'pendiente' AND expira_en > NOW()
    `, [tokenHash]);

    if (!invitacion.length) throw new ErrorApp('Invitación inválida o expirada.', 400);

    const inv = invitacion[0];
    const { rows: usuarioExistente } = await consulta('SELECT id FROM usuarios WHERE correo = $1', [inv.correo]);

    return pool.connect().then(async (cliente) => {
        try {
            await cliente.query('BEGIN');
            await cliente.query('UPDATE invitaciones SET estado = $1 WHERE id = $2', ['aceptada', inv.id]);

            if (usuarioExistente.length > 0) {
                // Usuario ya existe: agregar a equipo/proyecto
                const usuarioId = usuarioExistente[0].id;
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
                // Usuario nuevo: crear cuenta y agregar a equipo/proyecto
                const { rows: nuevoUsuario } = await cliente.query(`
                    INSERT INTO usuarios (nombre, correo, activo)
                    VALUES (NULL, $1, TRUE) RETURNING id
                `, [inv.correo]);
                const usuarioId = nuevoUsuario[0].id;

                await cliente.query(`
                    INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)
                `, [inv.equipo_id, usuarioId]);

                if (inv.proyecto_id && inv.rol) {
                    await cliente.query(`
                        INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                        VALUES ($1, $2, $3)
                    `, [inv.proyecto_id, usuarioId, inv.rol]);
                }

                // Generar token para definir contraseña (reutiliza tokens_recuperacion)
                const { tokenPlano: tokenPassword, tokenHash: tokenHashPassword } = generarToken();
                const expiraEnPassword = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

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
            throw error;
        } finally {
            cliente.release();
        }
    });
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

    if (!invitacion.length) throw new ErrorApp('Invitación no encontrada.', 404);
    if (!(await esAdminEquipo(usuario, invitacion[0].equipo_id))) {
        throw new ErrorApp('No tienes permisos para gestionar esta invitación.', 403);
    }

    const { tokenPlano, tokenHash } = generarToken();
    const expiraEn = new Date(Date.now() + EXPIRACION_INVITACION_HORAS * 60 * 60 * 1000);

    await consulta(`
        UPDATE invitaciones
        SET token_hash = $1, expira_en = $2, estado = 'pendiente'
        WHERE id = $3
    `, [tokenHash, expiraEn, invitacionId]);

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

    if (!invitacion.length) throw new ErrorApp('Invitación no encontrada.', 404);
    if (!(await esAdminEquipo(usuario, invitacion[0].equipo_id))) {
        throw new ErrorApp('No tienes permisos para gestionar esta invitación.', 403);
    }

    await consulta('UPDATE invitaciones SET estado = $1 WHERE id = $2', ['fallida', invitacionId]);
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
    const { usuario_id, equipo_id, proyecto_id, rol } = datos;

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
            await cliente.query(`
                INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES ($1, $2)
            `, [equipo_id, usuario_id]);

            if (proyecto_id && rol) {
                await cliente.query(`
                    INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (proyecto_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol
                `, [proyecto_id, usuario_id, rol]);
            }
            await cliente.query('COMMIT');
        } catch (error) {
            await cliente.query('ROLLBACK');
            throw error;
        } finally {
            cliente.release();
        }

        await avisarAgregadoAEquipo(destinatario[0], nombreProyecto, rol);
        return { mensaje: 'Usuario agregado al equipo.' };
    });
}