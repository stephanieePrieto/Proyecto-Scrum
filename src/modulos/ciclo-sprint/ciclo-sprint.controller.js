// Responsable: Diego - HU-09: recibe la peticion y responde (iniciar y cerrar sprint); sin logica de negocio
import * as servicio from './ciclo-sprint.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/ciclo-sprint/proyecto/:proyectoId → { activo, planificados, roles, yo, puedeGestionar } */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.estado(req.user, req.params.proyectoId));
});

/** GET /api/ciclo-sprint/sprint/:id/resumen → resumen de cierre */
export const resumen = envolver(async (req, res) => {
  res.json(await servicio.resumen(req.user, req.params.id));
});

/** POST /api/ciclo-sprint/sprint/:id/iniciar  { objetivo, capacidad_horas } → { sprint } */
export const iniciar = envolver(async (req, res) => {
  res.json({ sprint: await servicio.iniciar(req.user, req.params.id, req.body) });
});

/** POST /api/ciclo-sprint/sprint/:id/cerrar  { destino, siguienteSprintId, revision } → resumen del cierre */
export const cerrar = envolver(async (req, res) => {
  res.json(await servicio.cerrar(req.user, req.params.id, req.body));
});
