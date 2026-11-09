// Responsable: Camila - HU-18, HU-23, HU-25: endpoints de mover, bloquear y control de version de tarjetas
/**
 * @file tarjetas.routes.js
 * @description Rutas para edición con control de concurrencia optimista (HU-25),
 * aviso de presencia de edición en tiempo real, movimiento (HU-18) y bloqueo de tarjetas (HU-23).
 * @author Camila Mariné Crespo Zurita
 */

import { Router } from 'express';
import { identificar } from '../../middlewares/identificar.js';
import {
    obtenerTarjetaController,
    actualizarTarjetaController,
    notificarEdicionController,
    cambiarBloqueoController,
    moverTarjetaIndividualController
} from './tarjetas.controller.js';

const router = Router();

router.use(identificar);

router.get('/:id', obtenerTarjetaController);
router.put('/:id', actualizarTarjetaController);
router.patch('/:id', actualizarTarjetaController);
router.post('/:id/editando', notificarEdicionController);
router.patch('/:id/bloqueo', cambiarBloqueoController);
router.post('/:id/mover', moverTarjetaIndividualController);

export default router;