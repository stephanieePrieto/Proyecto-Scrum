// Responsable: Jetz - HU-02, HU-03, HU-05: endpoints de historias, orden de prioridad y puntos
/**
 * @file backlog.routes.js
 * @description Rutas del Product Backlog. app.js (BASE) monta este módulo solo, en /api/backlog,
 * porque la carpeta se llama "backlog" y este archivo exporta el router por defecto.
 *
 *   GET    /api/backlog/proyecto/:proyectoId              lista priorizada + épicas
 *   POST   /api/backlog/proyecto/:proyectoId/historias    crear (HU-02)
 *   PUT    /api/backlog/proyecto/:proyectoId/orden        reordenar (HU-03)
 *   PUT    /api/backlog/historias/:id                     editar (HU-02)
 *   DELETE /api/backlog/historias/:id                     eliminar (HU-02)
 *   POST   /api/backlog/historias/:id/devolver            sacar de un sprint y devolver al backlog
 *   POST   /api/backlog/historias/:id/aceptar             aceptar una historia propuesta
 *   POST   /api/backlog/historias/:id/rechazar            rechazar una historia propuesta
 * 
 * @author Jetzaly Josmery Tello Campos
 * @author Citlaly Morales Viveros
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './backlog.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', controller.listar);
router.post('/proyecto/:proyectoId/historias', controller.crear);
router.put('/proyecto/:proyectoId/orden', controller.reordenar);
router.put('/historias/:id', controller.actualizar);
router.delete('/historias/:id', controller.eliminar);
router.post('/historias/:id/devolver', controller.devolver);
router.post('/historias/:id/aceptar', controller.aceptar);
router.post('/historias/:id/rechazar', controller.rechazar);

export default router;