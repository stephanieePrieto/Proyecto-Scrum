// Responsable: Diego - HU-11: recibe la peticion y responde (impedimentos); sin logica de negocio
import * as servicio from './impedimentos.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/impedimentos/proyecto/:proyectoId?estado=&severidad= → { impedimentos, resumen, miembros, tareas, yo } */
export const listar = envolver(async (req, res) => {
  res.json(await servicio.listar(req.user, req.params.proyectoId, {
    estado: req.query.estado || 'todos',
    severidad: req.query.severidad || '',
  }));
});

/** POST /api/impedimentos/proyecto/:proyectoId → 201 { impedimento } */
export const crear = envolver(async (req, res) => {
  const impedimento = await servicio.crear(req.user, req.params.proyectoId, req.body);
  res.status(201).json({ impedimento });
});

/** POST /api/impedimentos/:id/resolver → { impedimento } */
export const resolver = envolver(async (req, res) => {
  const impedimento = await servicio.resolver(req.user, req.params.id);
  res.json({ impedimento });
});
