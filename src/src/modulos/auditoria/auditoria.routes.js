/**
 * @file auditoria.routes.js
 * @description Endpoints de la bitácora de auditoría. app.js monta este módulo en /api/auditoria.
 *
 *   GET /api/auditoria/proyecto/:proyectoId   lista (?usuarioId=&accion=&fechaDesde=&fechaHasta=&limite=&offset=)
 *
 * El permiso 'auditoria.ver' se valida en el servicio (exigirPermiso), una sola vez,
 * después de validar el identificador del proyecto.
 *
 * @author Citlaly Morales Viveros
 */

import { Router } from 'express';
import autenticar from '../../middlewares/autenticar.js';
import * as controller from './auditoria.controller.js';

const router = Router();
router.use(autenticar);

router.get('/proyecto/:proyectoId', controller.listar);

export default router;