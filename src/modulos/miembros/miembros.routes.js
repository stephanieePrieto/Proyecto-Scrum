// Responsable: Citlaly - HU-41, HU-43: endpoints de rol por proyecto y aislamiento de datos por equipo

/**
 * @file miembros.routes.js
 * @description Rutas de los roles por proyecto, montadas por app.js bajo /api/miembros.
 * Todas exigen sesión iniciada; los permisos de cada operación se validan en el servicio.
 * @author Citlaly Morales Viveros
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import { listar, misPermisos, asignarRol, quitarRol } from './miembros.controller.js';

const router = Router();

router.use(autenticar);

/** Matriz de roles del proyecto. */
router.get('/proyecto/:proyectoId', listar);

/** Rol y permisos vigentes de la persona autenticada en el proyecto, para que la interfaz oculte lo no autorizado. */
router.get('/proyecto/:proyectoId/mis-permisos', requierePermiso('proyecto.ver'), misPermisos);

/** Asigna o cambia el rol de una persona en el proyecto. */
router.put('/proyecto/:proyectoId/usuario/:usuarioId', asignarRol);

/** Retira el rol de una persona en el proyecto. */
router.delete('/proyecto/:proyectoId/usuario/:usuarioId', quitarRol);

export default router;