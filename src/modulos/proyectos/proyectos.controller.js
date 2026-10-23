// HU-01: recibe la peticion y responde (proyectos y Definition of Done); sin logica de negocio
import * as servicio from './proyectos.service.js';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const listar = asyncHandler(async (req, res) => {
  const proyectos = await servicio.listar(req.user, { archivados: req.query.archivados === 'true' });
  res.json({ proyectos });
});

export const equipos = asyncHandler(async (req, res) => {
  const lista = await servicio.equiposDisponibles(req.user);
  res.json({ equipos: lista, dod_base: servicio.DOD_BASE });
});

export const crear = asyncHandler(async (req, res) => {
  const proyecto = await servicio.crear(req.body, req.user);
  res.status(201).json({ proyecto });
});

export const obtener = asyncHandler(async (req, res) => {
  const proyecto = await servicio.obtener(req.params.id, req.user);
  res.json({ proyecto, puede_gestionar: await servicio.esAdmin(req.user) });
});

export const actualizar = asyncHandler(async (req, res) => {
  const proyecto = await servicio.actualizar(req.params.id, req.body, req.user);
  res.json({ proyecto });
});

export const archivar = asyncHandler(async (req, res) => {
  const proyecto = await servicio.archivar(req.params.id, req.user);
  res.json({ proyecto });
});