// Responsable: Diego - HU-10: recibe la peticion y responde (Daily Scrum); sin logica de negocio
import * as servicio from './daily.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/daily/proyecto/:proyectoId?fecha=AAAA-MM-DD → estado de la Daily del equipo ese día */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId, req.query.fecha));
});

/** PUT /api/daily/proyecto/:proyectoId  { ayer, hoy, impedimentos, tareas } → { creado, tardio, mensaje } */
export const guardar = envolver(async (req, res) => {
  res.json(await servicio.guardar(req.user, req.params.proyectoId, req.body));
});
