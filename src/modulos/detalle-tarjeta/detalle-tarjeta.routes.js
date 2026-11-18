/**
 * @file detalle-tarjeta.routes.js
 * @description Rutas del detalle de tarjeta (se montan en /api/detalle-tarjeta)
 * 
 * @author Alfonso Mendoza Vasquez
 */
import { Router } from 'express';
import { consulta } from '../../config/db.js';
import { identificar } from '../../middlewares/identificar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { exigirPropietarioTarea } from '../../utils/permisos.js';
import * as controlador from './detalle-tarjeta.controller.js';

const router = Router();

/** Resuelve el proyecto a partir de la tarjeta (:tareaId) y exige el permiso indicado. */
const permisoTarea = (clave) => requierePermiso(clave, { recurso: 'tareas', parametroRecurso: 'tareaId' });

const exigirPropiedadTarea = async (req, res, next) => {
  try {
    const { rows } = await consulta('SELECT responsable_id FROM tareas WHERE id = $1', [req.params.tareaId]);
    if (!rows.length) throw new ErrorApp('No se encontró el recurso solicitado.', 404);
    exigirPropietarioTarea(req.user, rows[0], req.rolProyecto);
    next();
  } catch (error) {
    next(error);
  }
};

router.use(identificar);

router.get('/:tareaId', permisoTarea('proyecto.ver'), controlador.obtener);
router.get('/:tareaId/historial', permisoTarea('proyecto.ver'), controlador.historial);

router.post('/:tareaId/checklist', permisoTarea('tarea.gestionar'), exigirPropiedadTarea, controlador.agregarItem);
router.patch('/:tareaId/checklist/:itemId', permisoTarea('tarea.gestionar'), exigirPropiedadTarea, controlador.actualizarItem);
router.delete('/:tareaId/checklist/:itemId', permisoTarea('tarea.gestionar'), exigirPropiedadTarea, controlador.eliminarItem);

export default router;