/**
 * @file releases.controller.js
 * @description Recibe la petición y responde (releases); sin lógica de negocio.
 *
 * @author Diego Rafael Jiménez Trujano
 */
import * as servicio from './releases.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/releases/proyecto/:proyectoId → { releases, sinRelease, puedeGestionar } */
export const listar = envolver(async (req, res) => {
  res.json(await servicio.listar(req.user, req.params.proyectoId));
});

/** POST /api/releases/proyecto/:proyectoId  { nombre, descripcion, fecha_objetivo, sprints } → 201 { release } */
export const crear = envolver(async (req, res) => {
  res.status(201).json({ release: await servicio.crear(req.user, req.params.proyectoId, req.body) });
});

/** PUT /api/releases/:id  { nombre, descripcion, fecha_objetivo } → { release } */
export const actualizar = envolver(async (req, res) => {
  res.json({ release: await servicio.actualizar(req.user, req.params.id, req.body) });
});

/** DELETE /api/releases/:id → { eliminado, id, sprintsLiberados } */
export const eliminar = envolver(async (req, res) => {
  res.json(await servicio.eliminar(req.user, req.params.id));
});

/** POST /api/releases/:id/sprints  { sprint_id } → { release_id, sprint_id, cambio } */
export const asignarSprint = envolver(async (req, res) => {
  res.json(await servicio.asignarSprint(req.user, req.params.id, req.body));
});

/** DELETE /api/releases/:id/sprints/:sprintId → { release_id, sprint_id } */
export const quitarSprint = envolver(async (req, res) => {
  res.json(await servicio.quitarSprint(req.user, req.params.id, req.params.sprintId));
});
