// Responsable: Alfonso - HU-26: rutas del flujo continuo, montadas en /api/flujo-continuo.
/**
 * @file flujo-continuo.routes.js
 * @description Rutas de la HU-26, montadas en /api/flujo-continuo (app.js carga la carpeta del módulo).
 *              Todas pasan por autenticar y por requierePermiso, que responde 404 neutro a quien no tiene
 *              vínculo con el proyecto.
 *
 *   GET  /api/flujo-continuo/proyectos/:proyectoId/tiempos?dias=30                  proyecto.ver
 *        Lead Time y Cycle Time de las tarjetas terminadas en el periodo.
 *   GET  /api/flujo-continuo/proyectos/:proyectoId/opciones-tarea                   proyecto.ver
 *        Historias e integrantes para el formulario "+ Tarea" del tablero en modo continuo.
 *   GET  /api/flujo-continuo/proyectos/:proyectoId/resumen-migracion?destino=...    proyecto.gestionar
 *        Resumen previo al cambio de modo (tareas abiertas, sprint activo, historias en sprint).
 *   POST /api/flujo-continuo/proyectos/:proyectoId/modo                             proyecto.gestionar
 *        Cambia el modo. Cuerpo: { modo: 'scrum'|'continuo', version: number, confirmar: true }.
 *
 * @author Alfonso Mendoza Vasquez
 */

import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controlador from './flujo-continuo.controller.js';

const router = Router();

const consultar = [autenticar, requierePermiso('proyecto.ver')];
const gestionar = [autenticar, requierePermiso('proyecto.gestionar')];

router.get('/proyectos/:proyectoId/tiempos', consultar, controlador.tiempos);
router.get('/proyectos/:proyectoId/opciones-tarea', consultar, controlador.opcionesTarea);
router.get('/proyectos/:proyectoId/resumen-migracion', gestionar, controlador.resumenMigracion);
router.post('/proyectos/:proyectoId/modo', gestionar, controlador.cambiarModo);

export default router;
