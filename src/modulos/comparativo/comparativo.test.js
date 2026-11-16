/**
 * @file comparativo.test.js
 * @description Pruebas unitarias de las funciones puras del comparativo entre equipos (HU-2).
 * Compatible con Jest y ES Modules.
 */

import { describe, test, expect } from '@jest/globals';
import { elegirProyectoPorEquipo, normalizarComparativo, SPRINTS_MINIMOS, EQUIPOS_MINIMOS } from './comparativo.calculo.js';

const equipoA = { equipo: 'Alfa', equipoId: 1, proyectoId: 11, proyecto: 'A', sprintsCerrados: 3, velocity: 20, avancePct: 50, desviacionPct: 10 };
const equipoB = { equipo: 'Beta', equipoId: 2, proyectoId: 22, proyecto: 'B', sprintsCerrados: 2, velocity: 10, avancePct: 80, desviacionPct: -5 };
const equipoC = { equipo: 'Gamma', equipoId: 3, proyectoId: 33, proyecto: 'C', sprintsCerrados: 0, velocity: null, avancePct: null, desviacionPct: null };

describe('Comparativo: elegir un proyecto por equipo', () => {
  test('un equipo con varios proyectos aparece una sola vez, con el proyecto de id más alto', () => {
    const r = elegirProyectoPorEquipo([
      { equipoId: 1, proyectoId: 5 },
      { equipoId: 1, proyectoId: 9 },
      { equipoId: 2, proyectoId: 3 },
    ]);
    expect(r).toEqual([{ equipoId: 1, proyectoId: 9 }, { equipoId: 2, proyectoId: 3 }]);
  });

  test('sin filas devuelve una lista vacía', () => {
    expect(elegirProyectoPorEquipo([])).toEqual([]);
  });
});

describe('Comparativo: normalización por porcentaje', () => {
  test('la velocity se expresa como porcentaje del equipo con mayor velocity', () => {
    const r = normalizarComparativo([equipoA, equipoB]);
    const porEquipo = Object.fromEntries(r.equipos.map((e) => [e.equipo, e]));
    expect(porEquipo.Alfa.velocityPct).toBe(100);
    expect(porEquipo.Beta.velocityPct).toBe(50);
  });

  test('la diferencia se calcula contra el promedio de los equipos con datos', () => {
    const r = normalizarComparativo([equipoA, equipoB]);
    expect(r.referencia).toEqual({ velocity: 15, avancePct: 65, desviacionPct: 2.5 });
    const alfa = r.equipos.find((e) => e.equipo === 'Alfa');
    expect(alfa.diferencia).toEqual({ velocity: 5, avancePp: -15, desviacionPp: 7.5 });
    const beta = r.equipos.find((e) => e.equipo === 'Beta');
    expect(beta.diferencia).toEqual({ velocity: -5, avancePp: 15, desviacionPp: -7.5 });
  });

  test('si la velocity máxima es cero, el porcentaje es 0 y no hay división entre cero', () => {
    const r = normalizarComparativo([
      { ...equipoA, velocity: 0 },
      { ...equipoB, velocity: 0 },
    ]);
    expect(r.equipos.every((e) => e.velocityPct === 0)).toBe(true);
  });
});

describe('Comparativo: criterios de aceptación', () => {
  test('criterio 2: un equipo sin sprints cerrados queda como datos insuficientes y no entra al promedio', () => {
    const r = normalizarComparativo([equipoA, equipoB, equipoC]);
    const gamma = r.equipos.find((e) => e.equipo === 'Gamma');
    expect(gamma.estado).toBe('datos_insuficientes');
    expect(gamma.velocityPct).toBeNull();
    expect(gamma.diferencia).toBeNull();
    expect(r.referencia.velocity).toBe(15);
  });

  test('criterio 1: la comparación solo es válida con al menos dos equipos con datos', () => {
    expect(normalizarComparativo([equipoA, equipoB]).comparable).toBe(true);
    expect(normalizarComparativo([equipoA, equipoC]).comparable).toBe(false);
    expect(normalizarComparativo([]).comparable).toBe(false);
  });

  test('los mínimos exportados son los que define la HU', () => {
    expect(SPRINTS_MINIMOS).toBe(1);
    expect(EQUIPOS_MINIMOS).toBe(2);
  });

  test('un dato faltante en un equipo no rompe la diferencia de los demás', () => {
    const r = normalizarComparativo([equipoA, { ...equipoB, desviacionPct: null }]);
    const beta = r.equipos.find((e) => e.equipo === 'Beta');
    expect(beta.diferencia.desviacionPp).toBeNull();
    expect(beta.diferencia.avancePp).toBe(15);
  });

  test('los equipos se devuelven ordenados por nombre', () => {
    const r = normalizarComparativo([equipoB, equipoA]);
    expect(r.equipos.map((e) => e.equipo)).toEqual(['Alfa', 'Beta']);
  });
});
