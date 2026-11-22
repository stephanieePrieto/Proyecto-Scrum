/**
 * @file comentarios.routes
 * @description Rutas de comentarios (se montan en /api/comentarios)
 * 
 * @author Alfonso Mendoza Vasquez
 */
import { Router } from 'express';
import { identificar } from '../../middlewares/identificar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controlador from './comentarios.controller.js';

const router = Router();

/** Resuelve el proyecto a partir de la tarjeta (:tareaId) y exige el permiso indicado. */
const permisoTarea = (clave) => requierePermiso(clave, { recurso: 'tareas', parametroRecurso: 'tareaId' });

router.use(identificar);

router.get('/tarea/:tareaId', permisoTarea('proyecto.ver'), controlador.listar);
router.get('/tarea/:tareaId/mencionables', permisoTarea('proyecto.ver'), controlador.mencionables);
router.post('/tarea/:tareaId', permisoTarea('tarea.gestionar'), controlador.crear);

export default router;