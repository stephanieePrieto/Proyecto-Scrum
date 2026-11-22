/**
 * @file auditoria.controller.js
 * @description Controlador para la bitácora de auditoría. Recibe las peticiones y responde.
 *
 * @author Citlaly Morales Viveros
 */

import * as service from './auditoria.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * @openapi
 * components:
 *   schemas:
 *     RegistroAuditoria:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Identificador único del registro.
 *           example: 123
 *         usuarioId:
 *           type: integer
 *           nullable: true
 *           description: ID del usuario que realizó la acción.
 *           example: 456
 *         usuarioNombre:
 *           type: string
 *           description: Nombre del usuario que realizó la acción ("Sistema" si no hay usuario asociado).
 *           example: "Juan Pérez"
 *         proyectoId:
 *           type: integer
 *           description: ID del proyecto al que pertenece el registro.
 *           example: 789
 *         accion:
 *           type: string
 *           description: Tipo de acción realizada.
 *           example: "proyecto_creado"
 *         objeto:
 *           type: string
 *           description: Tipo de objeto afectado.
 *           example: "proyecto"
 *         objetoId:
 *           type: integer
 *           nullable: true
 *           description: ID del objeto afectado.
 *           example: 789
 *         detalle:
 *           type: object
 *           nullable: true
 *           description: Detalles adicionales de la acción (antes, después, contexto).
 *         creadoEn:
 *           type: string
 *           format: date-time
 *           description: Fecha y hora cuando se registró la acción.
 *           example: "2024-01-01T10:30:00.000Z"
 */

/**
 * @openapi
 * /api/auditoria/proyecto/{proyectoId}:
 *   get:
 *     summary: Consultar registros de auditoría de un proyecto
 *     description: "Obtiene los registros de auditoría de un proyecto específico, con soporte para filtros y paginación. Solo accesible para el Scrum Master del proyecto."
 *     tags:
 *       - Auditoría
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: proyectoId
 *         required: true
 *         description: Identificador del proyecto.
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: usuarioId
 *         description: Filtrar por ID de usuario que realizó la acción.
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: accion
 *         description: "Filtrar por tipo de acción (ej: proyecto_creado, sprint_iniciado)."
 *         schema:
 *           type: string
 *       - in: query
 *         name: fechaDesde
 *         description: "Fecha mínima (YYYY-MM-DD, inclusive)."
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-01-01"
 *       - in: query
 *         name: fechaHasta
 *         description: "Fecha máxima (YYYY-MM-DD, inclusive). Incluye todo el día."
 *         schema:
 *           type: string
 *           format: date
 *           example: "2024-01-31"
 *       - in: query
 *         name: limite
 *         description: "Número de registros por página (1-100, default: 50)."
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: offset
 *         description: "Desplazamiento para paginación (default: 0)."
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *     responses:
 *       200:
 *         description: Lista de registros de auditoría con total de coincidencias.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 registros:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/RegistroAuditoria'
 *                 total:
 *                   type: integer
 *                   description: Total de registros que coinciden con los filtros.
 *                   example: 150
 *       400:
 *         description: Parámetros inválidos.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado. Sesión no iniciada.
 *       403:
 *         description: Prohibido. El usuario no es Scrum Master del proyecto.
 *       404:
 *         description: Proyecto no encontrado o usuario sin acceso.
 *
 * @param {import('express').Request} req - Solicitud con req.user, req.params.proyectoId y req.query.
 * @param {import('express').Response} res - Respuesta.
 */
export const listar = asyncHandler(async (req, res) => {
    const { proyectoId } = req.params;
    const { usuarioId, accion, fechaDesde, fechaHasta, limite, offset } = req.query;

    const resultado = await service.listar(req.user, proyectoId, {
        usuarioId,
        accion,
        fechaDesde,
        fechaHasta,
        limite,
        offset,
    });

    res.json(resultado);
});