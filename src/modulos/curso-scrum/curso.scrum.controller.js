import * as servicio from './curso-scrum.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const obtenerCursoProyecto = asyncHandler(async (req, res) => {
  const usuarioId = req.usuario.id; // Suponiendo que tu middleware de auth inyecta req.usuario
  const { proyectoId } = req.params;
  const resultado = await servicio.obtenerTemarioYProgreso(usuarioId, proyectoId);
  res.json(resultado);
});

export const actualizarProgreso = asyncHandler(async (req, res) => {
  const usuarioId = req.usuario.id;
  const { leccionId, completada, posicionScroll } = req.body;
  await servicio.guardarProgresoLectura(usuarioId, leccionId, completada, posicionScroll);
  res.json({ mensaje: 'Progreso guardado correctamente' });
});

export const enviarQuiz = asyncHandler(async (req, res) => {
  const usuarioId = req.usuario.id;
  const { leccionId, respuestas } = req.body;
  const resultado = await servicio.calificarQuiz(usuarioId, leccionId, respuestas);
  res.json(resultado);
});