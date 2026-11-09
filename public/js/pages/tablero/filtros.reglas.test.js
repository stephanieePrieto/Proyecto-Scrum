// Responsable: Alfonso - HU-21: pruebas de las reglas puras de filtros y carriles del tablero
/**
 * @file filtros.reglas.test.js
 * @description Suite de pruebas unitarias de la lógica pura de la HU-21 (filtros y swimlanes).
 * Compatible con Jest y ES Modules. No usa DOM, localStorage ni base de datos.
 */

import { describe, test, expect } from '@jest/globals';
import {
  MODOS_AGRUPACION,
  SIN_ASIGNAR,
  SIN_EPICA,
  FILTROS_VACIOS,
  MENSAJES_CARRIL,
  normalizarFiltros,
  hayFiltrosActivos,
  filtrarTareas,
  construirOpciones,
  depurarFiltros,
  agruparEnCarriles,
  decidirMovimientoEntreCarriles,
  aplicarCambioEnVivo,
  evaluarCambioEnVivo,
} from './filtros.reglas.js';

/** Tablero de ejemplo: 2 historias, 2 personas más una tarea sin asignar, 3 columnas. */
function crearTareas() {
  return [
    { id: 1, titulo: 'Login', columna_id: 10, responsable_id: 7, responsable: 'Ana', epica_id: 3, epica_nombre: 'Acceso', historia_id: 100, numero_hu: 2, historia_titulo: 'Iniciar sesión', etiquetas: ['Frontend', 'urgente'] },
    { id: 2, titulo: 'API login', columna_id: 11, responsable_id: 8, responsable: 'Beto', epica_id: 3, epica_nombre: 'Acceso', historia_id: 100, numero_hu: 2, historia_titulo: 'Iniciar sesión', etiquetas: ['backend'] },
    { id: 3, titulo: 'Gráfica', columna_id: 10, responsable_id: 7, responsable: 'Ana', epica_id: null, epica_nombre: null, historia_id: 200, numero_hu: 1, historia_titulo: 'Dashboard', etiquetas: null },
    { id: 4, titulo: 'Pruebas', columna_id: 12, responsable_id: null, responsable: null, epica_id: 5, epica_nombre: 'Calidad', historia_id: 200, numero_hu: 1, historia_titulo: 'Dashboard', etiquetas: ['FRONTEND '] },
  ];
}

const COLUMNAS = [
  { id: 10, nombre: 'Por hacer' },
  { id: 11, nombre: 'En progreso' },
  { id: 12, nombre: 'Hecho' },
];

const MIEMBROS = [
  { usuario_id: 7, nombre: 'Ana', activo: true },
  { usuario_id: 8, nombre: 'Beto', activo: true },
  { usuario_id: 9, nombre: 'Carla', activo: true },
  { usuario_id: 6, nombre: 'Dani', activo: false },
];

const ids = (tareas) => tareas.map((t) => t.id);

describe('HU-21 · Reglas de filtros y carriles del tablero', () => {
  test('normalizarFiltros descarta lo que no reconoce (localStorage vacío, dañado o de otra versión)', () => {
    expect(normalizarFiltros(null)).toEqual(FILTROS_VACIOS);
    expect(normalizarFiltros('texto suelto')).toEqual(FILTROS_VACIOS);
    expect(normalizarFiltros({ persona: 7, epica: { x: 1 }, estado: ' 11 ', agrupar: 'columnas', otro: 'x' }))
      .toEqual({ ...FILTROS_VACIOS, persona: '7', estado: '11' });
    expect(normalizarFiltros({ agrupar: MODOS_AGRUPACION.PERSONA }).agrupar).toBe('persona');
  });

  test('criterio 1: filtra por persona, incluida la opción "Sin asignar"', () => {
    const tareas = crearTareas();
    expect(ids(filtrarTareas(tareas, { persona: '7' }))).toEqual([1, 3]);
    expect(ids(filtrarTareas(tareas, { persona: SIN_ASIGNAR }))).toEqual([4]);
    expect(ids(filtrarTareas(tareas, FILTROS_VACIOS))).toEqual([1, 2, 3, 4]);
  });

  test('criterio 1: combina épica y estado (todas las condiciones deben cumplirse)', () => {
    const tareas = crearTareas();
    expect(ids(filtrarTareas(tareas, { epica: '3' }))).toEqual([1, 2]);
    expect(ids(filtrarTareas(tareas, { epica: '3', estado: '10' }))).toEqual([1]);
    expect(ids(filtrarTareas(tareas, { epica: SIN_EPICA }))).toEqual([3]);
  });

  test('criterio 1: la etiqueta no distingue mayúsculas ni espacios, y una tarea sin etiquetas no rompe el filtro', () => {
    const tareas = crearTareas();
    expect(ids(filtrarTareas(tareas, { etiqueta: 'frontend' }))).toEqual([1, 4]);
    expect(ids(filtrarTareas(tareas, { etiqueta: '  URGENTE ' }))).toEqual([1]);
    expect(filtrarTareas(null, { etiqueta: 'x' })).toEqual([]);
  });

  test('criterio 3: si nada coincide devuelve un arreglo vacío y se sabe que hay filtros activos', () => {
    const tareas = crearTareas();
    const filtros = { persona: '8', estado: '12' };
    expect(filtrarTareas(tareas, filtros)).toEqual([]);
    expect(hayFiltrosActivos(filtros)).toBe(true);
    expect(hayFiltrosActivos({ agrupar: MODOS_AGRUPACION.HISTORIA })).toBe(false);
  });

  test('criterio 6: filtrar y agrupar no modifican las tareas originales', () => {
    const tareas = crearTareas();
    const copia = structuredClone(tareas);
    const filtradas = filtrarTareas(tareas, { persona: '7', etiqueta: 'frontend' });
    agruparEnCarriles(filtradas, MODOS_AGRUPACION.PERSONA, { miembros: MIEMBROS });
    agruparEnCarriles(tareas, MODOS_AGRUPACION.HISTORIA);
    expect(tareas).toEqual(copia);
    expect(filtradas).not.toBe(tareas);
  });

  test('criterio 2: agrupar por historia crea un carril por historia, ordenados por número de HU', () => {
    const carriles = agruparEnCarriles(crearTareas(), MODOS_AGRUPACION.HISTORIA);
    expect(carriles.map((c) => c.titulo)).toEqual(['HU-1 · Dashboard', 'HU-2 · Iniciar sesión']);
    expect(carriles.map((c) => ids(c.tareas))).toEqual([[3, 4], [1, 2]]);
    expect(agruparEnCarriles(crearTareas(), MODOS_AGRUPACION.NINGUNO)).toEqual([]);
    expect(agruparEnCarriles(crearTareas(), 'desconocido')).toEqual([]);
  });

  test('criterio 2: agrupar por persona incluye miembros sin tareas, deja "Sin asignar" al final y respeta el filtro de persona', () => {
    const carriles = agruparEnCarriles(crearTareas(), MODOS_AGRUPACION.PERSONA, { miembros: MIEMBROS });
    expect(carriles.map((c) => c.titulo)).toEqual(['Ana', 'Beto', 'Carla', 'Sin asignar']);
    expect(carriles.map((c) => ids(c.tareas))).toEqual([[1, 3], [2], [], [4]]);
    expect(carriles[0].responsableId).toBe(7);

    const soloBeto = agruparEnCarriles(filtrarTareas(crearTareas(), { persona: '8' }), MODOS_AGRUPACION.PERSONA, { miembros: MIEMBROS, personaFiltrada: '8' });
    expect(soloBeto.map((c) => c.clave)).toEqual(['8']);
  });

  test('criterio 4: soltar en el carril de otra persona pide reasignar; otros casos no', () => {
    const { PERSONA, HISTORIA, NINGUNO } = MODOS_AGRUPACION;
    expect(decidirMovimientoEntreCarriles(PERSONA, '7', '9')).toEqual({ tipo: 'reasignar', responsableId: 9 });
    expect(decidirMovimientoEntreCarriles(PERSONA, '7', '7')).toEqual({ tipo: 'normal' });
    expect(decidirMovimientoEntreCarriles(NINGUNO, '7', '9')).toEqual({ tipo: 'normal' });
    expect(decidirMovimientoEntreCarriles(PERSONA, '7', SIN_ASIGNAR)).toEqual({ tipo: 'rechazar', mensaje: MENSAJES_CARRIL.SIN_RESPONSABLE });
    expect(decidirMovimientoEntreCarriles(HISTORIA, '100', '200')).toEqual({ tipo: 'rechazar', mensaje: MENSAJES_CARRIL.OTRA_HISTORIA });
  });

  test('criterio 5: un cambio en vivo que deja de cumplir el filtro se oculta; los demás se muestran o actualizan', () => {
    const [tarea] = crearTareas();
    const porEstado = { estado: '10' };

    const movida = aplicarCambioEnVivo(tarea, { tareaId: 1, columnaId: 11, usuarioNombre: 'Beto' });
    expect(movida.columna_id).toBe(11);
    expect(tarea.columna_id).toBe(10);
    expect(evaluarCambioEnVivo(tarea, movida, porEstado).accion).toBe('ocultar');
    expect(evaluarCambioEnVivo(movida, tarea, porEstado).accion).toBe('mostrar');

    const reasignada = aplicarCambioEnVivo(tarea, { responsableId: 9, responsable: 'Carla' });
    expect(reasignada).toMatchObject({ responsable_id: 9, responsable: 'Carla', columna_id: 10 });
    expect(evaluarCambioEnVivo(tarea, reasignada, { persona: '7' }).accion).toBe('ocultar');
    expect(evaluarCambioEnVivo(tarea, reasignada, porEstado).accion).toBe('actualizar');
    expect(evaluarCambioEnVivo(null, null, porEstado).accion).toBe('ninguna');
  });

  test('construirOpciones arma los selectores: personas activas, épicas, etiquetas únicas y estados en orden de columna', () => {
    const opciones = construirOpciones(crearTareas(), { columnas: COLUMNAS, miembros: MIEMBROS });
    expect(opciones.personas.map((o) => o.etiqueta)).toEqual(['Ana', 'Beto', 'Carla', 'Sin asignar']);
    expect(opciones.epicas.map((o) => o.valor)).toEqual(['3', '5', SIN_EPICA]);
    expect(opciones.etiquetas).toEqual([
      { valor: 'backend', etiqueta: 'backend' },
      { valor: 'frontend', etiqueta: 'Frontend' },
      { valor: 'urgente', etiqueta: 'urgente' },
    ]);
    expect(opciones.estados.map((o) => o.valor)).toEqual(['10', '11', '12']);
  });

  test('depurarFiltros quita valores guardados que ya no existen y conserva los válidos', () => {
    const opciones = construirOpciones(crearTareas(), { columnas: COLUMNAS, miembros: MIEMBROS });
    const { filtros, descartados } = depurarFiltros(
      { persona: '6', epica: '3', etiqueta: 'FRONTEND', estado: '99', agrupar: 'historia' },
      opciones,
    );
    expect(filtros).toEqual({ persona: '', epica: '3', etiqueta: 'frontend', estado: '', agrupar: 'historia' });
    expect(descartados).toEqual(['persona', 'estado']);
  });
});
