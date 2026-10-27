// Responsable: Citlaly - HU-41, HU-43: endpoints de rol por proyecto y aislamiento de datos por equipo

/**
 * @file miembros.routes.js
 * @description Rutas de los roles por proyecto, montadas por app.js bajo /api/miembros.
 * Todas exigen sesión iniciada; los permisos de cada operación se validan en el servicio.
 * @author Citlaly Morales Viveros
 */
import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import { listar, asignarRol, quitarRol } from './miembros.controller.js';

const router = Router();

router.use(autenticar);

/** Matriz de roles del proyecto. */
router.get('/proyecto/:proyectoId', listar);

/** Asigna o cambia el rol de una persona en el proyecto. */
router.put('/proyecto/:proyectoId/usuario/:usuarioId', asignarRol);

/** Retira el rol de una persona en el proyecto. */
router.delete('/proyecto/:proyectoId/usuario/:usuarioId', quitarRol);

export default router;