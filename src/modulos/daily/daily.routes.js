// Responsable: Diego - HU-10: endpoints de Daily Scrum
/**
 * Rutas del Daily Scrum. app.js (BASE) monta este módulo solo, en /api/daily.
 *
 *   GET /api/daily/proyecto/:proyectoId   estado del equipo en un día (?fecha=AAAA-MM-DD, por omisión hoy);
 *                                         solo el Scrum Master recibe a todo el equipo, los demás su propio registro
 *   PUT /api/daily/proyecto/:proyectoId   registrar o editar MI Daily de hoy
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './daily.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', requierePermiso('proyecto.ver'), controller.obtener);
router.put('/proyecto/:proyectoId', requierePermiso('daily.registrar'), controller.guardar);

export default router;
