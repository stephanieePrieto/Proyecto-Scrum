// Responsable: Alfonso - HU-20: rutas del detalle de tarjeta (se montan en /api/detalle-tarjeta)
import { Router } from 'express';
import { identificar } from '../../middlewares/identificar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controlador from './detalle-tarjeta.controller.js';

const router = Router();

/** Resuelve el proyecto a partir de la tarjeta (:tareaId) y exige el permiso indicado. */
const permisoTarea = (clave) => requierePermiso(clave, { recurso: 'tareas', parametroRecurso: 'tareaId' });

router.use(identificar);

router.get('/:tareaId', permisoTarea('proyecto.ver'), controlador.obtener);
router.get('/:tareaId/historial', permisoTarea('proyecto.ver'), controlador.historial);

router.post('/:tareaId/checklist', permisoTarea('tarea.gestionar'), controlador.agregarItem);
router.patch('/:tareaId/checklist/:itemId', permisoTarea('tarea.gestionar'), controlador.actualizarItem);
router.delete('/:tareaId/checklist/:itemId', permisoTarea('tarea.gestionar'), controlador.eliminarItem);

export default router;