// Responsable: Diego - HU-13, HU-14: recibe la peticion y responde (retrospectiva y acciones de mejora); sin logica de negocio
import * as servicio from './retros.service.js';
import { envolver } from '../../utils/envolverControlador.js';

/** GET /api/retros/proyecto/:proyectoId?sprint=ID → retro del sprint con notas, votos y acciones */
export const obtener = envolver(async (req, res) => {
  res.json(await servicio.consultar(req.user, req.params.proyectoId, req.query.sprint));
});

/** GET /api/retros/proyecto/:proyectoId/pendientes → recordatorio de acciones sin completar (HU-14) */
export const pendientes = envolver(async (req, res) => {
  res.json(await servicio.pendientes(req.user, req.params.proyectoId));
});

/** POST /api/retros/:retroId/items  { columna, texto, anonimo } */
export const crearItem = envolver(async (req, res) => {
  res.status(201).json(await servicio.crearItem(req.user, req.params.retroId, req.body));
});

/** PATCH /api/retros/items/:id  { texto } */
export const editarItem = envolver(async (req, res) => {
  res.json(await servicio.editarItem(req.user, req.params.id, req.body));
});

/** DELETE /api/retros/items/:id */
export const eliminarItem = envolver(async (req, res) => {
  res.json(await servicio.eliminarItem(req.user, req.params.id));
});

/** PUT /api/retros/items/:id/voto → { votos, restantes } */
export const votar = envolver(async (req, res) => {
  res.json(await servicio.votar(req.user, req.params.id));
});

/** DELETE /api/retros/items/:id/voto → { votos, restantes } */
export const quitarVoto = envolver(async (req, res) => {
  res.json(await servicio.quitarVoto(req.user, req.params.id));
});

/** PUT /api/retros/items/:id/edicion → avisa "X la está editando" */
export const iniciarEdicion = envolver(async (req, res) => {
  res.json(await servicio.iniciarEdicion(req.user, req.params.id));
});

/** DELETE /api/retros/items/:id/edicion → quita el aviso */
export const terminarEdicion = envolver(async (req, res) => {
  res.json(await servicio.terminarEdicion(req.user, req.params.id));
});

/** POST /api/retros/:retroId/acciones  { texto, responsable_id, fecha_limite } */
export const crearAccion = envolver(async (req, res) => {
  res.status(201).json(await servicio.crearAccion(req.user, req.params.retroId, req.body));
});

/** POST /api/retros/acciones/:id/completar */
export const completarAccion = envolver(async (req, res) => {
  res.json(await servicio.completarAccion(req.user, req.params.id));
});

/** POST /api/retros/:retroId/cerrar (solo Scrum Master) */
export const cerrar = envolver(async (req, res) => {
  res.json(await servicio.cerrarRetro(req.user, req.params.retroId));
});
