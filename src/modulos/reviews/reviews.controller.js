// Responsable: Diego - HU-12: recibe la peticion y responde (Sprint Review y aceptacion); sin logica de negocio
import * as servicio from './reviews.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/reviews/proyecto/:proyectoId?sprint=ID → historias, decisiones, velocity y delegación del sprint */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId, req.query.sprint));
});

/** POST /api/reviews/sprints/:sprintId/historias/:historiaId/decision  { decision, comentario, criterios_cumplidos, confirmar, cambiar } */
export const decidir = envolver(async (req, res) => {
  res.json(await servicio.decidir(req.user, req.params.sprintId, req.params.historiaId, req.body));
});

/** POST /api/reviews/proyecto/:proyectoId/delegaciones  { delegado_id, hasta, motivo } (solo Scrum Master) */
export const delegar = envolver(async (req, res) => {
  res.status(201).json(await servicio.delegar(req.user, req.params.proyectoId, req.body));
});

/** DELETE /api/reviews/delegaciones/:id (solo Scrum Master) */
export const revocar = envolver(async (req, res) => {
  res.json(await servicio.revocar(req.user, req.params.id));
});
