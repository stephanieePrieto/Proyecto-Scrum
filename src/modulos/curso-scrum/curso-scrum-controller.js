/**
 * ===========================================================================
 * CONTROLADOR DEL CURSO SCRUM
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Controladores para las rutas del curso Scrum.
 * ===========================================================================
 */

import * as servicio from './curso-scrum.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

// ===========================================================================
// CONTROLADORES EXISTENTES
// ===========================================================================

/**
 * Obtiene el temario y progreso del curso para un usuario en un proyecto.
 */
export const obtenerCursoProyecto = asyncHandler(async (req, res) => {
  const usuarioId = req.user.id;  // ← CAMBIADO: req.usuario → req.user
  const { proyectoId } = req.params;
  const resultado = await servicio.obtenerTemarioYProgreso(usuarioId, proyectoId);
  res.json(resultado);
});

/**
 * Actualiza el progreso de lectura de una lección.
 */
export const actualizarProgreso = asyncHandler(async (req, res) => {
  const usuarioId = req.user.id;  // ← CAMBIADO
  const { leccionId, completada, posicionScroll } = req.body;
  await servicio.guardarProgresoLectura(usuarioId, leccionId, completada, posicionScroll);
  res.json({ mensaje: 'Progreso guardado correctamente' });
});

/**
 * Califica un quiz y registra el intento.
 */
export async function enviarQuiz(req, res, next) {
  try {
    const usuarioId = req.user.id;
    const { leccionId, respuestas } = req.body;
    
    const resultado = await servicio.calificarQuiz(usuarioId, leccionId, respuestas);
    
    // Retornar directamente la propiedad calificacion y aprobado
    res.json({
      exito: true,
      calificacion: resultado.calificacion,
      aprobado: resultado.aprobado
    });
  } catch (error) {
    next(error);
  }
}

// ===========================================================================
// CONTROLADORES DE CERTIFICADO
// ===========================================================================

/**
 * Obtiene la información del certificado de un usuario.
 */
export const obtenerCertificado = asyncHandler(async (req, res) => {
  const usuarioId = req.user.id;  // ← CAMBIADO
  const certificado = await servicio.tieneCertificado(usuarioId);

  if (certificado) {
    res.json({
      tieneCertificado: true,
      certificadoId: certificado.id,
      emitidoEn: certificado.emitido_en
    });
  } else {
    const progreso = await servicio.verificarCompletacionCurso(usuarioId);
    res.json({
      tieneCertificado: false,
      ...progreso
    });
  }
});

/**
 * Otorga un certificado a un usuario.
 */
export const otorgarCertificado = asyncHandler(async (req, res) => {
  const usuarioId = req.user.id;  // ← CAMBIADO
  const resultado = await servicio.otorgarCertificado(usuarioId);

  if (resultado.yaTieneCertificado) {
    return res.status(400).json({
      error: 'El usuario ya tiene un certificado',
      certificadoId: resultado.certificadoId
    });
  }

  res.json({
    mensaje: 'Certificado otorgado correctamente',
    ...resultado
  });
});

/**
 * Descarga el certificado en PDF.
 */
export async function descargarCertificado(req, res, next) {
  try {
    const usuarioId = req.user.id;
    const pdfBuffer = await servicio.generarCertificadoPDF(usuarioId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Certificado_ScrumFlow.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    
    return res.end(Buffer.from(pdfBuffer));
  } catch (error) {
    next(error);
  }
}

/**
 * Reinicia el progreso del curso.
 */
export const reiniciarProgreso = asyncHandler(async (req, res) => {
  const usuarioId = req.user.id;  // ← CAMBIADO
  const { usuarioId: idParam } = req.body;

  // Si es admin, puede reiniciar el progreso de cualquier usuario
  const targetUsuarioId = req.user.rol === 'admin' ? (idParam || usuarioId) : usuarioId;  // ← CAMBIADO

  await servicio.reiniciarProgresoCurso(targetUsuarioId);
  res.json({ mensaje: 'Progreso del curso reiniciado correctamente' });
});

// ===========================================================================
// CONTROLADORES ADMIN
// ===========================================================================

/**
 * Obtiene todos los módulos del curso (solo Admin).
 */
export const obtenerTodosModulos = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const modulos = await servicio.obtenerTodosLosModulos();
  res.json(modulos);
});

/**
 * Crea un nuevo módulo (solo Admin).
 */
export const crearModulo = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { orden, titulo, contenido, seccion } = req.body;
  const modulo = await servicio.crearModulo(orden, titulo, contenido, seccion);
  res.status(201).json(modulo);
});

/**
 * Actualiza un módulo existente (solo Admin).
 */
export const actualizarModulo = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { id } = req.params;
  const { orden, titulo, contenido, seccion } = req.body;
  const modulo = await servicio.actualizarModulo(id, orden, titulo, contenido, seccion);
  res.json(modulo);
});

/**
 * Elimina un módulo (solo Admin).
 */
export const eliminarModulo = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { id } = req.params;
  await servicio.eliminarModulo(id);
  res.json({ mensaje: 'Módulo eliminado correctamente' });
});

/**
 * Reordena los módulos (solo Admin).
 */
export const reordenarModulos = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { ordenes } = req.body;
  await servicio.reordenarModulos(ordenes);
  res.json({ mensaje: 'Módulos reordenados correctamente' });
});

/**
 * Obtiene los quizzes de una lección (solo Admin).
 */
export const obtenerQuizzesPorLeccion = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { leccionId } = req.params;
  const quizzes = await servicio.obtenerQuizzesPorLeccion(leccionId);
  res.json(quizzes);
});

/**
 * Crea un nuevo quiz (solo Admin).
 */
export const crearQuiz = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { leccionId, pregunta, opciones, respuestaCorrecta } = req.body;
  const quiz = await servicio.crearQuiz(leccionId, pregunta, opciones, respuestaCorrecta);
  res.status(201).json(quiz);
});

/**
 * Actualiza un quiz existente (solo Admin).
 */
export const actualizarQuiz = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { id } = req.params;
  const { pregunta, opciones, respuestaCorrecta } = req.body;
  const quiz = await servicio.actualizarQuiz(id, pregunta, opciones, respuestaCorrecta);
  res.json(quiz);
});

/**
 * Elimina un quiz (solo Admin).
 */
export const eliminarQuiz = asyncHandler(async (req, res) => {
  if (req.user.rol !== 'admin') {  // ← CAMBIADO
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol de Admin.' });
  }
  const { id } = req.params;
  await servicio.eliminarQuiz(id);
  res.json({ mensaje: 'Quiz eliminado correctamente' });
});