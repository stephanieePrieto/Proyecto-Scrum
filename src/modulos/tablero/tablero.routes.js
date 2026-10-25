/**
 * @file tablero.routes.js
 * @description Endpoints del tablero del sprint (HU-17, HU-18, HU-22).
 * @author Camila Mariné Crespo Zurita
 */

import { Router } from 'express';
import { obtenerTablero, configurarColumnas, moverTarjetaController } from './tablero.controller.js';

// Middlewares MOCK temporales aislados (No importan archivos ajenos)
const autenticarTemp = (req, res, next) => {
    req.usuario = { id: 1, nombre: 'Camila', rol: 'Admin' };
    next();
};

const requiereRolTemp = (rolesPermitidos) => (req, res, next) => {
    next();
};

const router = Router();

// Endpoints protegidos únicamente con los mocks locales de tu archivo
router.get('/:proyectoId', autenticarTemp, requiereRolTemp(['Admin', 'SM', 'PO', 'DEV']), obtenerTablero);
router.put('/:proyectoId/columnas', autenticarTemp, requiereRolTemp(['Admin', 'SM']), configurarColumnas);
router.post('/mover-tarjeta', autenticarTemp, requiereRolTemp(['Admin', 'SM', 'PO', 'DEV']), moverTarjetaController);

export default router;