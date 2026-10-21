// Responsable: Camila - HU-17, HU-22: endpoints de columnas configurables y limites WIP
import { Router } from 'express';
import { obtenerTablero, configurarColumnas } from './tablero.controller.js';
import autenticar from '../../middlewares/autenticar.js';
import requiereRol from '../../middlewares/requiereRol.js';

const router = Router();

// Endpoint para traer las columnas y tareas del sprint activo (Lo usa todo el equipo)
router.get('/:proyectoId', autenticar, requiereRol(['Admin', 'SM', 'PO', 'DEV']), obtenerTablero);

// Endpoint para modificar nombres de columnas (Solo Admin o SM - HU-17)
router.put('/:proyectoId/columnas', autenticar, requiereRol(['Admin', 'SM']), configurarColumnas);

export default router;