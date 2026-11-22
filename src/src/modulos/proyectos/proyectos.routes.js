/**
 * @file proyectos.routes.js
 * @description Rutas de proyectos. Montar en app.js (BASE, avisar al equipo):
 *   app.use('/api/proyectos', require('./modulos/proyectos/proyectos.routes'));
 * 
 * @author Jetzaly Josmery Tello Campos
 */

import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './proyectos.controller.js';

const router = Router();
router.use(autenticar);

router.get('/', controller.listar);
router.get('/equipos-disponibles', controller.equipos);
router.post('/', controller.crear);
router.get('/:id', controller.obtener);
router.put('/:id', controller.actualizar);
router.post('/:id/archivar', controller.archivar);

export default router;