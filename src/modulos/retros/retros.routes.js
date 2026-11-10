// Responsable: Diego - HU-13, HU-14: endpoints de retrospectiva y acciones de mejora
/**
 * Rutas de la retrospectiva. app.js (BASE) monta este módulo solo, en /api/retros.
 * Todos los roles del proyecto participan; cerrar la retro y ver las acciones pendientes de todo el equipo
 * es del Scrum Master. Cada servicio comprueba el permiso contra el proyecto del recurso que se toca.
 *
 *   GET    /api/retros/proyecto/:proyectoId              retro del sprint (?sprint=ID) con notas, votos y acciones
 *   GET    /api/retros/proyecto/:proyectoId/pendientes   acciones pendientes de retros anteriores (HU-14)
 *   POST   /api/retros/:retroId/items                    publicar una nota (columna, texto, anonimo)
 *   PATCH  /api/retros/items/:id                         editar el texto de una nota
 *   DELETE /api/retros/items/:id                         eliminar una nota (autor o Scrum Master)
 *   PUT    /api/retros/items/:id/voto                    votar (máximo 5 por integrante)
 *   DELETE /api/retros/items/:id/voto                    quitar mi voto
 *   PUT    /api/retros/items/:id/edicion                 avisar "X la está editando"
 *   DELETE /api/retros/items/:id/edicion                 quitar el aviso
 *   POST   /api/retros/:retroId/acciones                 crear una acción (texto, responsable y fecha límite)
 *   POST   /api/retros/acciones/:id/completar            marcar una acción como completada
 *   POST   /api/retros/:retroId/cerrar                   cerrar la retro (solo Scrum Master)
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './retros.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', controller.obtener);
router.get('/proyecto/:proyectoId/pendientes', controller.pendientes);

router.patch('/items/:id', controller.editarItem);
router.delete('/items/:id', controller.eliminarItem);
router.put('/items/:id/voto', controller.votar);
router.delete('/items/:id/voto', controller.quitarVoto);
router.put('/items/:id/edicion', controller.iniciarEdicion);
router.delete('/items/:id/edicion', controller.terminarEdicion);
router.post('/acciones/:id/completar', controller.completarAccion);

router.post('/:retroId/items', controller.crearItem);
router.post('/:retroId/acciones', controller.crearAccion);
router.post('/:retroId/cerrar', controller.cerrar);

export default router;
