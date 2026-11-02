// Responsable: Alfonso - HU-28: reglas, SQL y avisos por socket (desviacion de horas)

/**
 * @file desviacion.service.js
 * @description Núcleo de la HU-28 (RF-29): horas estimadas contra reales y su desviación por
 *              tarea, historia, persona y sprint. Responsabilidades:
 *  1. Comprobar que el rol de la persona alcance (por defecto, solo Scrum Master) y que el sprint sea del proyecto.
 *  2. Leer las tareas del sprint con la suma de sus registros de horas (consulta parametrizada).
 *  3. Agrupar por nivel y calcular con `desviacion.calculo.js` (sin lógica de cálculo duplicada aquí).
 *
 * Siempre se calcula desde `registros_horas`, así que una edición retroactiva de horas (HU-27) se refleja
 * sola en la siguiente consulta. El aviso en tiempo real lo emite el módulo `horas` con `horas:actualizadas`
 * a la sala del proyecto; este módulo no emite eventos porque solo lee.
 */

import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { ROLES } from '../../utils/permisos.js';
import { agregarDesviacion, calcularDesviacion, ordenarPorDesviacion } from './desviacion.calculo.js';

/*
 * Constantes
 */

/**
 * Roles del proyecto que pueden consultar la desviación. La HU-28 la define para el Scrum Master.
 * Para abrirla a todo el equipo (la matriz dice que "Ver métricas del equipo" es Sí para SM, PO y DEV) basta con:
 *   [ROLES.SCRUM_MASTER, ROLES.PRODUCT_OWNER, ROLES.DEVELOPER]
 */
export const ROLES_PERMITIDOS = Object.freeze([ROLES.SCRUM_MASTER]);

/** Niveles que se pueden listar (el nivel "sprint" es el resumen). */
export const NIVELES = Object.freeze(['tareas', 'historias', 'personas']);

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

/*
 * Validaciones
 */

/**
 * Lanza 403 si el rol vigente en el proyecto no está en ROLES_PERMITIDOS.
 * (La pertenencia al proyecto ya la validó `requierePermiso`, que responde 404 neutro a quien no tiene vínculo.)
 * @param {string|null} rol Rol de la persona en el proyecto (req.rolProyecto).
 * @throws {ErrorApp} 403 si el rol no alcanza.
 */
export function exigirRolPermitido(rol) {
  if (!ROLES_PERMITIDOS.includes(rol)) {
    throw new ErrorApp('Solo el Scrum Master puede consultar la desviación de horas de este proyecto.', 403);
  }
}

/**
 * Valida un identificador numérico positivo.
 * @param {*} valor Valor sin confiar.
 * @returns {number} Identificador válido.
 * @throws {ErrorApp} 400 si no es un entero positivo.
 */
function validarSprintId(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  const id = Number(texto);
  if (!/^\d+$/.test(texto) || !Number.isInteger(id) || id <= 0 || id > ENTERO_MAXIMO) {
    throw new ErrorApp('El identificador del sprint no es válido.', 400);
  }
  return id;
}

/**
 * Valida el nivel pedido en la URL.
 * @param {*} nivel Valor sin confiar.
 * @returns {string} Uno de NIVELES.
 * @throws {ErrorApp} 404 si no es un nivel conocido (la ruta no existe).
 */
function validarNivel(nivel) {
  if (!NIVELES.includes(nivel)) throw new ErrorApp('Ese nivel de desviación no existe. Usa tareas, historias o personas.', 404);
  return nivel;
}

/*
 * Consultas
 */

/**
 * Carga el sprint comprobando que pertenezca al proyecto (evita consultar sprints ajenos cambiando la URL).
 * @param {number} proyectoId Proyecto ya autorizado.
 * @param {number} sprintId Sprint pedido.
 * @returns {Promise<{id:number, nombre:string, estado:string, fechaInicio:string, fechaFin:string}>}
 * @throws {ErrorApp} 404 si el sprint no existe o es de otro proyecto.
 */
async function cargarSprint(proyectoId, sprintId) {
  const { rows } = await consulta(
    `SELECT id, nombre, estado, fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin
       FROM sprints WHERE id = $1 AND proyecto_id = $2`,
    [sprintId, proyectoId],
  );
  if (!rows[0]) throw new ErrorApp('No se encontró el sprint en este proyecto.', 404);
  const s = rows[0];
  return { id: s.id, nombre: s.nombre, estado: s.estado, fechaInicio: s.fecha_inicio, fechaFin: s.fecha_fin };
}

/**
 * Tareas del sprint con sus horas estimadas, la suma de sus horas reales, su historia y su responsable.
 * @param {number} proyectoId Proyecto.
 * @param {number} sprintId Sprint.
 * @returns {Promise<Object[]>} Filas tal como las devuelve PostgreSQL (NUMERIC como texto).
 */
async function cargarTareas(proyectoId, sprintId) {
  const { rows } = await consulta(
    `SELECT t.id, t.titulo,
            t.horas_estimadas::text AS estimadas,
            r.reales::text AS reales,
            t.historia_id, h.numero_hu, h.titulo AS historia_titulo,
            t.responsable_id, u.nombre AS responsable_nombre,
            (u.activo AND mp.usuario_id IS NOT NULL) AS responsable_activo
       FROM tareas t
       JOIN historias h ON h.id = t.historia_id
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(rh.horas), 0) AS reales
                            FROM registros_horas rh WHERE rh.tarea_id = t.id) r ON TRUE
       LEFT JOIN usuarios u ON u.id = t.responsable_id
       LEFT JOIN miembros_proyecto mp ON mp.proyecto_id = t.proyecto_id AND mp.usuario_id = t.responsable_id
      WHERE t.sprint_id = $1 AND t.proyecto_id = $2
      ORDER BY t.id`,
    [sprintId, proyectoId],
  );
  return rows;
}

/**
 * Historias asignadas al sprint (para mostrar también las que aún no tienen tareas).
 * @param {number} proyectoId Proyecto.
 * @param {number} sprintId Sprint.
 * @returns {Promise<Object[]>} Filas con id, numero_hu y titulo.
 */
async function cargarHistoriasDelSprint(proyectoId, sprintId) {
  const { rows } = await consulta(
    'SELECT id, numero_hu, titulo FROM historias WHERE sprint_id = $1 AND proyecto_id = $2',
    [sprintId, proyectoId],
  );
  return rows;
}

/**
 * Integrantes activos del proyecto (para mostrar también a quien no tiene tareas en el sprint).
 * @param {number} proyectoId Proyecto.
 * @returns {Promise<Object[]>} Filas con id y nombre.
 */
async function cargarIntegrantes(proyectoId) {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre
       FROM miembros_proyecto mp JOIN usuarios u ON u.id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE`,
    [proyectoId],
  );
  return rows;
}

/*
 * Armado por nivel
 */

/**
 * Convierte una fila de tarea al par estimado/real que usa el cálculo.
 * @param {Object} fila Fila de `cargarTareas`.
 * @returns {{horasEstimadas:string|null, horasReales:string}}
 */
const horasDe = (fila) => ({ horasEstimadas: fila.estimadas, horasReales: fila.reales });

/**
 * Nombre visible de una historia: "HU-12 · Título".
 * @param {number} numero Número de HU dentro del proyecto.
 * @param {string} titulo Título de la historia.
 * @returns {string}
 */
const nombreHistoria = (numero, titulo) => `HU-${numero} · ${titulo}`;

/**
 * Desviación por tarea.
 * @param {Object[]} tareas Filas de `cargarTareas`.
 * @returns {Object[]} Una fila por tarea, ordenada por lo más preocupante.
 */
function porTarea(tareas) {
  return ordenarPorDesviacion(tareas.map((t) => ({
    id: t.id,
    nombre: t.titulo,
    historia: nombreHistoria(t.numero_hu, t.historia_titulo),
    responsable: t.responsable_nombre ?? null,
    ...calcularDesviacion(t.estimadas, t.reales),
  })));
}

/**
 * Desviación por historia: suma de sus tareas del sprint (solo las que tienen registro).
 * @param {Object[]} tareas Filas de `cargarTareas`.
 * @param {Object[]} historias Historias asignadas al sprint (pueden no tener tareas).
 * @returns {Object[]} Una fila por historia, ordenada por lo más preocupante.
 */
function porHistoria(tareas, historias) {
  const grupos = new Map(historias.map((h) => [h.id, { id: h.id, nombre: nombreHistoria(h.numero_hu, h.titulo), tareas: [] }]));
  for (const t of tareas) {
    if (!grupos.has(t.historia_id)) {
      grupos.set(t.historia_id, { id: t.historia_id, nombre: nombreHistoria(t.numero_hu, t.historia_titulo), tareas: [] });
    }
    grupos.get(t.historia_id).tareas.push(horasDe(t));
  }
  return ordenarPorDesviacion([...grupos.values()].map(({ tareas: lista, ...h }) => ({ ...h, ...agregarDesviacion(lista) })));
}

/**
 * Desviación por persona: tareas del sprint que tiene asignadas (solo las que tienen registro).
 * Estimado y real se miden sobre las mismas tareas (sus asignadas, registre quien registre las horas)
 * para que la comparación tenga sentido aunque la tarea se haya reasignado o el SM haya registrado en ella.
 * Se incluyen los integrantes sin tareas ("Sin tareas"), las personas dadas de baja con tareas
 * (se conservan en el histórico como inactivas) y, si existen, las tareas sin responsable.
 *
 * @param {Object[]} tareas Filas de `cargarTareas`.
 * @param {Object[]} integrantes Integrantes activos del proyecto.
 * @returns {Object[]} Una fila por persona, ordenada por lo más preocupante.
 */
function porPersona(tareas, integrantes) {
  const grupos = new Map(integrantes.map((u) => [u.id, { id: u.id, nombre: u.nombre, activo: true, tareas: [] }]));
  for (const t of tareas) {
    const clave = t.responsable_id ?? 'sin-responsable';
    if (!grupos.has(clave)) {
      grupos.set(clave, t.responsable_id === null
        ? { id: null, nombre: 'Sin responsable', activo: true, sinResponsable: true, tareas: [] }
        : { id: t.responsable_id, nombre: t.responsable_nombre, activo: Boolean(t.responsable_activo), tareas: [] });
    }
    grupos.get(clave).tareas.push(horasDe(t));
  }
  return ordenarPorDesviacion([...grupos.values()].map(({ tareas: lista, sinResponsable = false, ...p }) => ({
    ...p,
    sinResponsable,
    ...agregarDesviacion(lista),
  })));
}

/*
 * API del servicio
 */

/**
 * Resumen del sprint: totales del sprint con su desviación.
 * @param {number} proyectoId Proyecto ya autorizado (req.proyectoId).
 * @param {number|string} sprintId Sprint de la URL.
 * @returns {Promise<{sprint:Object, resumen:Object}>}
 * @throws {ErrorApp} 400 identificador inválido; 404 sprint de otro proyecto o inexistente.
 */
export async function obtenerResumen(proyectoId, sprintId) {
  const sprint = await cargarSprint(proyectoId, validarSprintId(sprintId));
  const tareas = await cargarTareas(proyectoId, sprint.id);
  return { sprint, resumen: { id: sprint.id, nombre: sprint.nombre, ...agregarDesviacion(tareas.map(horasDe)) } };
}

/**
 * Lista la desviación de un nivel del sprint (tareas, historias o personas) junto con el resumen.
 * @param {number} proyectoId Proyecto ya autorizado (req.proyectoId).
 * @param {number|string} sprintId Sprint de la URL.
 * @param {string} nivel 'tareas' | 'historias' | 'personas'.
 * @returns {Promise<{sprint:Object, resumen:Object, nivel:string, elementos:Object[]}>}
 * @throws {ErrorApp} 400 identificador inválido; 404 sprint ajeno o nivel inexistente.
 */
export async function listarPorNivel(proyectoId, sprintId, nivel) {
  const nivelValido = validarNivel(nivel);
  const sprint = await cargarSprint(proyectoId, validarSprintId(sprintId));
  const [tareas, extra] = await Promise.all([
    cargarTareas(proyectoId, sprint.id),
    nivelValido === 'historias' ? cargarHistoriasDelSprint(proyectoId, sprint.id)
      : nivelValido === 'personas' ? cargarIntegrantes(proyectoId)
        : Promise.resolve([]),
  ]);

  const elementos = nivelValido === 'tareas' ? porTarea(tareas)
    : nivelValido === 'historias' ? porHistoria(tareas, extra)
      : porPersona(tareas, extra);

  return {
    sprint,
    resumen: { id: sprint.id, nombre: sprint.nombre, ...agregarDesviacion(tareas.map(horasDe)) },
    nivel: nivelValido,
    elementos,
  };
}

/**
 * Sprints del proyecto para el selector del componente, con el sugerido por defecto
 * (el activo; si no hay, el más reciente).
 * @param {number} proyectoId Proyecto ya autorizado.
 * @returns {Promise<{sprints:Object[], sugeridoId:number|null}>}
 */
export async function listarSprints(proyectoId) {
  const { rows } = await consulta(
    `SELECT id, nombre, estado FROM sprints WHERE proyecto_id = $1
      ORDER BY fecha_inicio DESC, id DESC`,
    [proyectoId],
  );
  const activo = rows.find((s) => s.estado === 'activo');
  return { sprints: rows, sugeridoId: (activo ?? rows[0])?.id ?? null };
}
