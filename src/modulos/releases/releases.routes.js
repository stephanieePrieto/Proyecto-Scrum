/**
 * @file releases.routes.js
 * @description Rutas de los releases. app.js (BASE) monta este módulo solo, en /api/releases.
 * Todo el proyecto ve la línea de tiempo (proyecto.ver); crear, editar, eliminar y asignar sprints es del
 * Product Owner (release.gestionar). El servicio vuelve a comprobar el permiso contra el proyecto del release.
 *
 *   GET    /api/releases/proyecto/:proyectoId          releases con sus sprints y avance, y sprints sin release
 *   POST   /api/releases/proyecto/:proyectoId          crear un release (opcional: sprints a asignar)
 *   PUT    /api/releases/:id                           editar nombre, descripción o fecha objetivo
 *   DELETE /api/releases/:id                           eliminar el release (los sprints se conservan)
 *   POST   /api/releases/:id/sprints                   asignar un sprint ({ sprint_id }); 409 si ya está en otro
 *   DELETE /api/releases/:id/sprints/:sprintId         quitar un sprint del release
 *
 * @author Diego Rafael Jiménez Trujano
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import * as controller from './releases.controller.js';
import { proyectoDeRelease } from './releases.service.js';

const router = Router();
router.use(autenticar);

/** El proyecto se obtiene del propio release (requiereRol.js no conoce la tabla releases). */
const delRelease = { resolverProyecto: (req) => proyectoDeRelease(req.params.id) };

router.get('/proyecto/:proyectoId', requierePermiso('proyecto.ver'), controller.listar);
router.post('/proyecto/:proyectoId', requierePermiso('release.gestionar'), controller.crear);
router.put('/:id', requierePermiso('release.gestionar', delRelease), controller.actualizar);
router.delete('/:id', requierePermiso('release.gestionar', delRelease), controller.eliminar);
router.post('/:id/sprints', requierePermiso('release.gestionar', delRelease), controller.asignarSprint);
router.delete('/:id/sprints/:sprintId', requierePermiso('release.gestionar', delRelease), controller.quitarSprint);

export default router;
