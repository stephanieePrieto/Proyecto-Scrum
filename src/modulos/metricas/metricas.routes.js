/**
 * @file metricas.routes.js
 * @description Declarar las rutas del módulo de métricas y encadenar sus middlewares
 * app.js monta este router automáticamente en /api/metricas (el prefijo es el nombre de la carpeta),
 * por eso las rutas de aquí no repiten "metricas".
 * @author Dana Carmona Santamaria
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { misProyectos, dashboard, velocity, avance, burndown, distribucion, solicitarExportacion, estadoExportacion, descargarArchivo, umbral, guardarUmbralProyecto } from './metricas.controller.js';

const router = Router();
/**
 * Registrar las rutas.
 *   1. autenticar: verificar la sesión y llenar req.user.
 *   2. controlador: validar el proyecto, comprobar que el usuario pertenezca a él y responder.
 */
// Proyectos del usuario: GET /api/metricas/mis-proyectos
router.get('/mis-proyectos', autenticar, misProyectos);

// HU-35: GET /api/metricas/proyectos/:proyectoId/dashboard
router.get('/proyectos/:proyectoId/dashboard', autenticar, dashboard);

// HU-30: GET /api/metricas/proyectos/:proyectoId/velocity
router.get('/proyectos/:proyectoId/velocity', autenticar, velocity);

// HU-31: GET /api/metricas/proyectos/:proyectoId/avance?sprintId=N
router.get('/proyectos/:proyectoId/avance', autenticar, avance);

// HU-29: GET /api/metricas/proyectos/:proyectoId/burndown
router.get('/proyectos/:proyectoId/burndown', autenticar, burndown);

// HU-32: GET /api/metricas/proyectos/:proyectoId/distribucion
router.get('/proyectos/:proyectoId/distribucion', autenticar, distribucion);

// HU-33: GET/PUT /api/metricas/proyectos/:proyectoId/umbral
router.get('/proyectos/:proyectoId/umbral', autenticar, umbral);
router.put('/proyectos/:proyectoId/umbral', autenticar, guardarUmbralProyecto);

/**
 * HU-36: Rutas para la exportación asíncrona de reportes (Polling)
 */
// Iniciar el trabajo de generación en segundo plano
router.post('/proyectos/:proyectoId/exportar', autenticar, solicitarExportacion);

// Consultar el estado y avance de la barra de progreso
router.get('/proyectos/:proyectoId/exportar/:jobId', autenticar, estadoExportacion);

// Descargar el archivo final una vez llegue al 100%
router.get('/proyectos/:proyectoId/exportar/:jobId/descargar', autenticar, descargarArchivo);

export default router;