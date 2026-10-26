// Responsable: Citlaly - HU-40: recibe la peticion y responde (equipos y miembros); sin logica de negocio

/**
 * @file equipos.controller.js
 * @description Adaptadores HTTP de los equipos. Todas las respuestas son JSON, incluida la baja,
 * que devuelve { ok: true, eliminado: id } en lugar de 204, para que el cliente pueda leer siempre
 * el cuerpo. Los errores que traen detalles (campos inválidos, pendientes por resolver) se
 * responden como { mensaje, detalles }.
 * @author Citlaly Morales Viveros
 */
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import * as servicio from './equipos.service.js';

/**
 * Convierte un parámetro de ruta o de consulta en entero positivo.
 *
 * @param {*} valor - Valor recibido.
 * @returns {number}
 * @throws {ErrorApp} 400 si no es un identificador válido.
 */
function idDe(valor) {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero <= 0) throw new ErrorApp('Identificador no válido.', 400);
    return numero;
}

/**
 * Envuelve un manejador para que los errores con detalles lleguen al cliente con su cuerpo
 * estructurado; el resto de errores sigue el manejo global.
 *
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<void>} accion - Manejador.
 * @returns {import('express').RequestHandler}
 */
const manejar = (accion) => asyncHandler(async (req, res) => {
    try {
        await accion(req, res);
    } catch (error) {
        if (error?.detalles && error.statusCode) {
            return res.status(error.statusCode).json({ mensaje: error.message, detalles: error.detalles });
        }
        throw error;
    }
});

export const listar = manejar(async (req, res) => {
    res.json(await servicio.listar(req.user));
});

export const usuariosDisponibles = manejar(async (req, res) => {
    const equipoId = req.query.equipo_id ? idDe(req.query.equipo_id) : null;
    const usuarios = await servicio.usuariosDisponibles({ q: req.query.q, equipoId }, req.user);
    res.json({ usuarios });
});

export const crear = manejar(async (req, res) => {
    res.status(201).json({ equipo: await servicio.crear(req.body, req.user) });
});

export const obtener = manejar(async (req, res) => {
    res.json({ equipo: await servicio.obtener(idDe(req.params.id), req.user) });
});

export const actualizar = manejar(async (req, res) => {
    res.json({ equipo: await servicio.actualizar(idDe(req.params.id), req.body, req.user) });
});

export const eliminar = manejar(async (req, res) => {
    res.json(await servicio.eliminar(idDe(req.params.id), req.user));
});

export const agregarMiembros = manejar(async (req, res) => {
    res.status(201).json({ equipo: await servicio.agregarMiembros(idDe(req.params.id), req.body, req.user) });
});

export const pendientesDeQuitar = manejar(async (req, res) => {
    const pendientes = await servicio.pendientesDeQuitar(idDe(req.params.id), idDe(req.params.usuarioId), req.user);
    res.json({ pendientes });
});

export const quitarMiembro = manejar(async (req, res) => {
    res.json(await servicio.quitarMiembro(idDe(req.params.id), idDe(req.params.usuarioId), req.body, req.user));
});