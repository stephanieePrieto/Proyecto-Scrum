/**
 * @file invitaciones.controller.js
 * @description Controladores para las rutas del módulo de invitaciones.
 * @author Citlaly Morales Viveros
 */

import * as invitacionesService from './invitaciones.service.js';
import { ErrorApp } from '../../utils/ErrorApp.js';

export const crearInvitacion = async (req, res) => {
    const invitacion = await invitacionesService.crearInvitacion(
        { ...req.body, equipo_id: req.params.equipoId },
        req.user
    );
    res.status(201).json({ mensaje: 'Invitación enviada correctamente.', invitacion });
};

export const altaDirecta = async (req, res) => {
    const resultado = await invitacionesService.altaDirecta(
        { ...req.body, equipo_id: req.params.equipoId },
        req.user
    );
    res.status(201).json(resultado);
};

export const aceptarInvitacion = async (req, res) => {
    const { token } = req.body;
    if (typeof token !== 'string' || !token) throw new ErrorApp('Token inválido.', 400);
    const resultado = await invitacionesService.aceptarInvitacion(token);
    res.status(200).json(resultado);
};

export const rechazarInvitacion = async (req, res) => {
    const { token } = req.body;
    if (typeof token !== 'string' || !token) throw new ErrorApp('Token inválido.', 400);
    const resultado = await invitacionesService.rechazarInvitacion(token);
    res.status(200).json(resultado);
};

export const reenviarInvitacion = async (req, res) => {
    const resultado = await invitacionesService.reenviarInvitacion(req.params.id, req.user);
    res.status(200).json(resultado);
};

export const cancelarInvitacion = async (req, res) => {
    const resultado = await invitacionesService.cancelarInvitacion(req.params.id, req.user);
    res.status(200).json(resultado);
};

export const listarInvitaciones = async (req, res) => {
    const invitaciones = await invitacionesService.listarInvitaciones(req.params.equipoId, req.user);
    res.status(200).json(invitaciones);
};

export const agregarUsuarioExistente = async (req, res) => {
    const resultado = await invitacionesService.agregarUsuarioExistente(
        { ...req.body, equipo_id: req.params.equipoId },
        req.user
    );
    res.status(200).json(resultado);
};