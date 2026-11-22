/**
 * @file burnup.service.test.js
 * @description Pruebas del servicio de Burnup y CFD (HU-1) con la base de datos simulada.
 * Se simulan `consulta` y `exigirIntegranteProyecto`; el cálculo lo hacen las funciones
 * puras reales de burnup.calculo.js. Compatible con Jest y ES Modules.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/** Filas que devuelve la base simulada; cada prueba las ajusta. */
let mundo;
const consultas = [];

const respuestaConsulta = (sql) => {
  if (sql.includes('FROM sprints s')) return { rows: mundo.sprints };
  if (sql.includes('FROM columnas_tablero')) return { rows: mundo.columnas };
  if (sql.includes('FROM historial_tareas h')) return { rows: mundo.historial };
  if (sql.includes('FROM tareas')) {
    if (sql.includes('SUM(horas_estimadas)')) return { rows: [mundo.totales] };
    return { rows: mundo.tareas };
  }
  throw new Error(`consulta no simulada: ${sql.slice(0, 90)}`);
};

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: jest.fn(async (sql, params) => {
    consultas.push({ sql, params });
    return respuestaConsulta(sql);
  }),
  pool: { connect: async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() }) },
}));

jest.unstable_mockModule('../metricas/metricas.service.js', () => ({
  exigirIntegranteProyecto: jest.fn(async () => 'developer'),
}));

const servicio = await import('./burnup.service.js');

beforeEach(() => {
  consultas.length = 0;
  jest.clearAllMocks();
  mundo = {
    totales: { total: '100', hechas: '60' },
    sprints: [
      { id: 1, nombre: 'S1', completado_horas: 20 },
      { id: 2, nombre: 'S2', completado_horas: 30 },
    ],
    columnas: [
      { id: 1, nombre: 'Por hacer', orden: 1, esFinal: false },
      { id: 2, nombre: 'En curso', orden: 2, esFinal: false },
      { id: 3, nombre: 'Hecho', orden: 3, esFinal: true },
    ],
    tareas: [{ id: 10, creado: '2026-11-01', columnaActualId: 3 }],
    historial: [],
  };
});

describe('obtenerBurnup', () => {
  test('arma la serie con alcance total y lo completado acumulado por sprint', async () => {
    const r = await servicio.obtenerBurnup(1, 7);
    expect(r.vacio).toBe(false);
    expect(r.unidad).toBe('horas');
    expect(r.alcanceTotal).toBe(100);
    expect(r.puntos.map((p) => [p.nombre, p.completado])).toEqual([
      ['Inicio', 0],
      ['S1', 20],
      ['S2', 50],
      ['Actual', 60],
    ]);
  });

  test('sin horas estimadas el proyecto queda vacío', async () => {
    mundo.totales = { total: '0', hechas: '0' };
    mundo.sprints = [];
    const r = await servicio.obtenerBurnup(1, 7);
    expect(r.vacio).toBe(true);
    expect(r.puntos).toEqual([
      { nombre: 'Inicio', completado: 0, alcance: 0 },
      { nombre: 'Actual', completado: 0, alcance: 0 },
    ]);
  });

  test('omite los sprints planificados porque todavía no tienen trabajo', async () => {
    // El servicio filtra por estado en SQL; aquí se comprueba que la consulta lo pide
    await servicio.obtenerBurnup(1, 7);
    const sqlSprints = consultas.find((c) => c.sql.includes('FROM sprints s')).sql;
    expect(sqlSprints).toMatch("estado <> 'planificado'");
  });
});

describe('obtenerCfd', () => {
  test('sin cambios de columna registrados avisa que el historial no es suficiente', async () => {
    const r = await servicio.obtenerCfd(1, 7);
    expect(r.historialSuficiente).toBe(false);
    expect(r.vacio).toBe(false);
    // Sin eventos, la tarjeta cuenta todo el tiempo en su columna actual (Hecho)
    expect(r.dias[0].conteos).toMatchObject({ 3: 1 });
    expect(r.dias[r.dias.length - 1].fecha).toBe(new Date().toISOString().slice(0, 10));
  });

  test('con un cambio registrado el CFD refleja la columna de cada día', async () => {
    mundo.historial = [
      { tareaId: 10, fecha: '2026-11-02', detalle: { anterior: 1, nueva: 2 } },
    ];
    const r = await servicio.obtenerCfd(1, 7);
    expect(r.historialSuficiente).toBe(true);
    expect(r.dias[0].conteos).toMatchObject({ 1: 1, 2: 0, 3: 0 });
    expect(r.dias[1].conteos).toMatchObject({ 1: 0, 2: 1, 3: 0 });
  });

  test('sin tareas el CFD queda vacío', async () => {
    mundo.tareas = [];
    const r = await servicio.obtenerCfd(1, 7);
    expect(r.vacio).toBe(true);
    expect(r.dias).toEqual([]);
  });
});
