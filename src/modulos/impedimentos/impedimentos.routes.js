// Responsable: Diego - HU-11: endpoints de impedimentos
/**
 * Rutas de impedimentos. app.js (BASE) monta este módulo solo, en /api/impedimentos.
 *
 *   GET  /api/impedimentos/proyecto/:proyectoId   lista (?estado=abierto|resuelto|todos&severidad=)
 *   POST /api/impedimentos/proyecto/:proyectoId   registrar uno nuevo
 *   POST /api/impedimentos/:id/resolver           marcarlo como resuelto
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './impedimentos.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', requierePermiso('proyecto.ver'), controller.listar);
router.post('/proyecto/:proyectoId', requierePermiso('impedimento.gestionar'), controller.crear);
router.post('/:id/resolver', requierePermiso('impedimento.gestionar', { recurso: 'impedimentos' }), controller.resolver);

export default router;
