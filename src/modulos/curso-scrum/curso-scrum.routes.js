/**
 * @file curso-scrum.routes.js
 * @description Definición de rutas para el módulo del curso Scrum.
 * 
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { Router } from 'express';
import * as controller from './curso-scrum-controller.js';
import autenticar from '../../middlewares/autenticar.js';

const router = Router();
router.use(autenticar);

// Actualizar progreso de lectura de una lección
router.post('/progreso', controller.actualizarProgreso);

// Registrar si se completó u omitió la guía por rol
router.post('/tutorial/completar', controller.completarTutorial);
router.get('/tutorial/estado/:proyectoId', controller.obtenerEstadoTutorial);

// Enviar y calificar quiz modular
router.post('/quiz', controller.enviarQuiz);

// Enviar y calificar Quiz Final Integrador (20 preguntas)
router.post('/quiz-final', async (req, res, next) => {
  try {
    const usuarioId = req.user.id;
    const { respuestas } = req.body;
    const servicio = await import('./curso-scrum.service.js');
    const resultado = await servicio.calificarQuizFinal(usuarioId, respuestas);
    res.json({
      exito: true,
      calificacion: resultado.calificacion,
      aprobado: resultado.aprobado
    });
  } catch (error) {
    next(error);
  }
});

// RUTAS DE CERTIFICADO

// Obtener información del certificado del usuario
router.get('/certificado', controller.obtenerCertificado);

// Otorgar certificado manualmente (o automático vía servicio)
router.post('/certificado', controller.otorgarCertificado);

// Descargar certificado en PDF
router.get('/certificado/download', controller.descargarCertificado);

// Obtener temario y progreso del curso para un proyecto.
// Va DESPUÉS de /certificado: si estuviera antes, GET /certificado caería aquí
// con proyectoId='certificado' y devolvería 500.
router.get('/:proyectoId', controller.obtenerCursoProyecto);

// Reiniciar progreso del curso
router.post('/progreso/reset', controller.reiniciarProgreso);

// RUTAS ADMIN (Solo para usuarios con rol 'admin')

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
