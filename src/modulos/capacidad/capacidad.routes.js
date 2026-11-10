// Responsable: Diego - HU-44: endpoints de capacidad individual
/**
 * Rutas de capacidad individual. app.js (BASE) monta este módulo solo, en /api/capacidad,
 * porque la carpeta se llama "capacidad" y este archivo exporta el router por defecto.
 *
 *   GET /api/capacidad/yo                              quién soy y a qué equipos pertenezco
 *   GET /api/capacidad/usuarios/:usuarioId             capacidad guardada de una persona (la propia, o cualquiera si eres Scrum Master)
 *   PUT /api/capacidad/usuarios/:usuarioId             guardar horas, notas y ausencias
 *   GET /api/capacidad/proyecto/:proyectoId/equipo     capacidad del equipo en un sprint (?sprint=ID); solo Scrum Master
 *   GET /api/capacidad/equipos/:equipoId               capacidad del equipo en un rango (?inicio=&fin=); solo Scrum Master
 */
import { Router } from 'express';
import { esModoDemo } from './capacidad.demo.js';
import { yo, obtener, guardar, obtenerEquipo, obtenerPorSprint } from './capacidad.controller.js';
import { autenticar } from '../../middlewares/autenticar.js';
import { requierePermiso } from '../../middlewares/requiereRol.js';

// Solo con MODO_DEMO=true (pruebas) las rutas no piden sesión
const proteger = esModoDemo() ? (req, res, next) => next() : autenticar;

const router = Router();

router.get('/yo', proteger, yo);
router.get('/usuarios/:usuarioId', proteger, obtener);
router.put('/usuarios/:usuarioId', proteger, guardar);
router.get('/proyecto/:proyectoId/equipo', proteger, requierePermiso('capacidad.equipo.ver'), obtenerPorSprint);
router.get('/equipos/:equipoId', proteger, obtenerEquipo);

export default router;
