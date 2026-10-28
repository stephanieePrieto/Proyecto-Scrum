// Responsable: Citlaly - HU-39: recibe la peticion y responde (invitar por correo y alta directa); sin logica de negocio

import * as invitacionesService from './invitaciones.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

/**
 * @file invitaciones.controller.js
 * @description Controladores HTTP del módulo de invitaciones.
 * @author Citlaly Morales Viveros
 */

/**
 * Crea una invitación por correo para un equipo.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const crearInvitacion = async (req, res) => {
    const { correo, proyecto_id, rol } = req.body;
    const { equipoId } = req.params;
    const usuario = req.user;

    if (typeof correo !== 'string' || !correo.trim()) {
        throw new ErrorApp('El correo es obligatorio.', 400);
    }

    const invitacion = await invitacionesService.crearInvitacion(
        { correo, equipo_id: parseInt(equipoId), proyecto_id: proyecto_id ? parseInt(proyecto_id) : undefined, rol },
        usuario
    );

    res.status(201).json({ mensaje: 'Invitación enviada.', invitacion });
};

/**
 * Acepta una invitación. El token llega en el cuerpo de la petición.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const aceptarInvitacion = async (req, res) => {
    const { token } = req.body;
    if (typeof token !== 'string' || !token) {
        throw new ErrorApp('Token de invitación no válido.', 400);
    }

    const resultado = await invitacionesService.aceptarInvitacion(token);
    res.status(200).json(resultado);
};

/**
 * Reenvía una invitación generando un nuevo enlace.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const reenviarInvitacion = async (req, res) => {
    const { id } = req.params;
    const usuario = req.user;
    await invitacionesService.reenviarInvitacion(parseInt(id), usuario);
    res.status(200).json({ mensaje: 'Invitación reenviada.' });
};

/**
 * Cancela una invitación.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const cancelarInvitacion = async (req, res) => {
    const { id } = req.params;
    const usuario = req.user;
    await invitacionesService.cancelarInvitacion(parseInt(id), usuario);
    res.status(200).json({ mensaje: 'Invitación cancelada.' });
};

/**
 * Lista las invitaciones de un equipo.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const listarInvitaciones = async (req, res) => {
    const { equipoId } = req.params;
    const usuario = req.user;
    const invitaciones = await invitacionesService.listarInvitaciones(parseInt(equipoId), usuario);
    res.status(200).json({ invitaciones });
};

/**
 * Agrega a un equipo un usuario que ya tiene cuenta.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const agregarUsuarioExistente = async (req, res) => {
    const { equipoId } = req.params;
    const { usuario_id, proyecto_id, rol } = req.body;
    const usuario = req.user;

    await invitacionesService.agregarUsuarioExistente(
        { usuario_id: parseInt(usuario_id), equipo_id: parseInt(equipoId), proyecto_id: proyecto_id ? parseInt(proyecto_id) : undefined, rol },
        usuario
    );

    res.status(201).json({ mensaje: 'Usuario agregado al equipo.' });
};