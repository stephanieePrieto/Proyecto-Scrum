import { Router } from 'express';
import { obtenerCursoProyecto, actualizarProgreso, enviarQuiz } from './curso-scrum.controller.js';
// Importa aquí tu middleware de autenticación real si lo usas (ej. verificarToken)

const router = Router();

router.get('/:proyectoId', obtenerCursoProyecto);
router.post('/progreso', actualizarProgreso);
router.post('/quiz', enviarQuiz);

export default router;