/**
 * @file tablero.routes.js
 * @description Endpoints del tablero del sprint.
 * 
 * @author Camila Mariné Crespo Zurita
 */

import { Router } from 'express';
import { identificar } from '../../middlewares/identificar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';
import { obtenerTablero, configurarColumnas, moverTarjetaController } from './tablero.controller.js';

const router = Router();

router.get('/:proyectoId', identificar, requierePermiso('proyecto.ver'), obtenerTablero);
router.put('/:proyectoId/columnas', identificar, requierePermiso('tablero.configurar'), configurarColumnas);
router.post('/mover-tarjeta', identificar, moverTarjetaController);

export default router;