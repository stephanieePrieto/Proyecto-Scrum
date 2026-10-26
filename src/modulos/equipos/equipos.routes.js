// Responsable: Citlaly - HU-40: endpoints de equipos y miembros

/**
 * @file equipos.routes.js
 * @description Rutas de los equipos, montadas automáticamente en /api/equipos. Todas exigen sesión
 * iniciada; los permisos de gestión se comprueban en el servicio y no solo en la interfaz.
 * La ruta de búsqueda de usuarios va antes de /:id para que no se confunda con un identificador.
 * @author Citlaly Morales Viveros
 */
import { Router } from 'express';
import { autenticar } from '../../middlewares/autenticar.js';
import * as controlador from './equipos.controller.js';

const router = Router();

router.use(autenticar);

router.get('/', controlador.listar);
router.post('/', controlador.crear);
router.get('/usuarios-disponibles', controlador.usuariosDisponibles);

router.get('/:id', controlador.obtener);
router.put('/:id', controlador.actualizar);
router.delete('/:id', controlador.eliminar);

router.post('/:id/miembros', controlador.agregarMiembros);
router.get('/:id/miembros/:usuarioId/pendientes', controlador.pendientesDeQuitar);
router.post('/:id/miembros/:usuarioId/quitar', controlador.quitarMiembro);

export default router;