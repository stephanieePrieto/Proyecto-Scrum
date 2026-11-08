/**
 * ===========================================================================
 * RUTAS DEL CURSO SCRUM
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Definición de rutas para el módulo del curso Scrum.
 * ===========================================================================
 */

import { Router } from 'express';
import * as controller from './curso-scrum-controller.js';
import autenticar from '../../middlewares/autenticar.js';

const router = Router();
router.use(autenticar); 

// ===========================================================================
// RUTAS PRINCIPALES (Acceso para todos los usuarios autenticados)
// ===========================================================================

// Obtener temario y progreso del curso para un proyecto
router.get('/:proyectoId', controller.obtenerCursoProyecto);

// Actualizar progreso de lectura de una lección
router.post('/progreso', controller.actualizarProgreso);

// Enviar y calificar quiz
router.post('/quiz', controller.enviarQuiz);

// ===========================================================================
// RUTAS DE CERTIFICADO
// ===========================================================================

// Obtener información del certificado del usuario
router.get('/certificado', controller.obtenerCertificado);

// Otorgar certificado manualmente (o automático vía servicio)
router.post('/certificado', controller.otorgarCertificado);

// Descargar certificado en PDF
router.get('/certificado/download', controller.descargarCertificado);

// Reiniciar progreso del curso
router.post('/progreso/reset', controller.reiniciarProgreso);

// ===========================================================================
// RUTAS ADMIN (Solo para usuarios con rol 'admin')
// ===========================================================================

// Módulos
router.get('/admin/modulos', controller.obtenerTodosModulos);
router.post('/admin/modulos', controller.crearModulo);
router.put('/admin/modulos/:id', controller.actualizarModulo);
router.delete('/admin/modulos/:id', controller.eliminarModulo);
router.post('/admin/modulos/reordenar', controller.reordenarModulos);

// Quizzes
router.get('/admin/quizzes/:leccionId', controller.obtenerQuizzesPorLeccion);
router.post('/admin/quizzes', controller.crearQuiz);
router.put('/admin/quizzes/:id', controller.actualizarQuiz);
router.delete('/admin/quizzes/:id', controller.eliminarQuiz);

export default router;