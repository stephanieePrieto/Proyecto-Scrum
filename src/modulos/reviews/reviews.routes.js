// Responsable: Diego - HU-12: endpoints de Sprint Review y aceptacion
/**
 * Rutas de la Sprint Review. app.js (BASE) monta este módulo solo, en /api/reviews.
 * Todos los roles del proyecto ven la Review; aceptar o rechazar es del Product Owner (o de quien tenga su
 * delegación vigente) y delegar o revocar es del Scrum Master. Cada servicio comprueba el permiso contra el
 * proyecto del recurso que se toca.
 *
 *   GET    /api/reviews/proyecto/:proyectoId                   Review del sprint (?sprint=ID) con historias, decisiones y velocity
 *   POST   /api/reviews/sprints/:sprintId/historias/:historiaId/decision   aceptar o rechazar (o cambiar) una historia
 *   POST   /api/reviews/proyecto/:proyectoId/delegaciones      delegar la aceptación (solo Scrum Master)
 *   DELETE /api/reviews/delegaciones/:id                       revocar una delegación (solo Scrum Master)
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './reviews.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', controller.obtener);
router.post('/sprints/:sprintId/historias/:historiaId/decision', controller.decidir);
router.post('/proyecto/:proyectoId/delegaciones', controller.delegar);
router.delete('/delegaciones/:id', controller.revocar);

export default router;
