// Responsable: Diego - HU-15: recibe la peticion y responde (eventos Scrum); sin logica de negocio
import * as servicio from './calendario.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** GET /api/calendario/proyecto/:proyectoId → { zona, sprint, eventos, conflictos, mensaje } */
export const obtener = asyncHandler(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId));
});
