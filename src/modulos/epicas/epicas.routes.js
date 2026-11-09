// HU-04: épicas del proyecto activo.
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './epicas.controller.js';

const router = Router();
router.use(autenticar);
router.get('/proyecto/:proyectoId', controller.listar);
router.post('/proyecto/:proyectoId', controller.crear);
router.put('/proyecto/:proyectoId/:epicaId', controller.actualizar);
router.delete('/proyecto/:proyectoId/:epicaId', controller.eliminar);

export default router;
