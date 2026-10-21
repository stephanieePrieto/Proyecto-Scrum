import { Router } from 'express';
import { esModoDemo } from './capacidad.demo.js';
import { obtener, guardar, obtenerEquipo } from './capacidad.controller.js';
import { autenticar } from '../../middlewares/autenticar.js';

let proteger = (req, res, next) => next();

if (!esModoDemo()) {
  proteger = autenticar;
}

const router = Router();

// Consultar y guardar la capacidad de una persona
router.get('/usuarios/:usuarioId/capacidad', proteger, obtener);
router.put('/usuarios/:usuarioId/capacidad', proteger, guardar);

// Consultar la capacidad total de un equipo en un sprint
router.get('/equipos/:equipoId/capacidad', proteger, obtenerEquipo);

export default router;