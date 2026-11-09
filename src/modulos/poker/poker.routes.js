/** HU-05 · Rutas de estimación Fibonacci y Planning Poker por proyecto. */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './poker.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId/historias', controller.listarHistorias);

router.get('/proyecto/:proyectoId/historias/:historiaId/ronda', controller.consultarPoker);
router.post('/proyecto/:proyectoId/historias/:historiaId/ronda', controller.iniciarPoker);
router.post('/proyecto/:proyectoId/historias/:historiaId/voto', controller.votarPoker);
router.post('/proyecto/:proyectoId/historias/:historiaId/revelar', controller.revelarPoker);
router.post('/proyecto/:proyectoId/historias/:historiaId/nueva-ronda', controller.nuevaRondaPoker);
router.post('/proyecto/:proyectoId/historias/:historiaId/cerrar', controller.cerrarPoker);

export default router;
