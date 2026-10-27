// Responsable: Citlaly - HU-41, HU-43: recibe la peticion y responde (rol por proyecto y aislamiento de datos por equipo); sin logica de negocio

/**
 * @file miembros.controller.js
 * @description Controladores HTTP de los roles por proyecto. Solo traducen la petición a llamadas
 * del servicio; las reglas de negocio y los permisos se validan en miembros.service.js.
 * @author Citlaly Morales Viveros
 */
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as servicio from './miembros.service.js';

/**
 * Devuelve la matriz de roles del proyecto.
 *
 * @param {import('express').Request} req - Petición con proyectoId en la ruta.
 * @param {import('express').Response} res - Respuesta JSON con la matriz.
 */
export const listar = asyncHandler(async (req, res) => {
    res.json(await servicio.listar(req.params.proyectoId, req.user));
});

/**
 * Asigna o cambia el rol de una persona en el proyecto.
 *
 * @param {import('express').Request} req - Petición con proyectoId y usuarioId en la ruta, y rol en el cuerpo.
 * @param {import('express').Response} res - Respuesta JSON con el resultado y la matriz actualizada.
 */
export const asignarRol = asyncHandler(async (req, res) => {
    res.json(await servicio.asignarRol(req.params.proyectoId, req.params.usuarioId, req.body, req.user));
});

/**
 * Retira el rol de una persona en el proyecto. La confirmación puede llegar en el cuerpo o
 * como parámetro de consulta (confirmar=true).
 *
 * @param {import('express').Request} req - Petición con proyectoId y usuarioId en la ruta.
 * @param {import('express').Response} res - Respuesta JSON con el resultado y la matriz actualizada.
 */
export const quitarRol = asyncHandler(async (req, res) => {
    const confirmar = req.body?.confirmar === true || req.query?.confirmar === 'true';
    res.json(await servicio.quitarRol(req.params.proyectoId, req.params.usuarioId, { confirmar }, req.user));
});