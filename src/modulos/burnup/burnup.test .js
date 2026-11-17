/**
 * @file burnup.test.js
 * @description Pruebas unitarias de las funciones puras del Burnup y del CFD (HU-1).
 * Compatible con Jest y ES Modules, igual que desviacion.test.js.
 */

import { describe, test, expect } from '@jest/globals';
import { calcularBurnup, sumarDias, columnaEnDia, calcularCfd } from './burnup.calculo.js';

describe('Burnup (HU-1)', () => {
  test('el alcance es el total de horas y no cambia entre puntos', () => {
    const r = calcularBurnup(100, [{ nombre: 'S1', completadoHoras: 20 }, { nombre: 'S2', completadoHoras: 30 }], 10);
    expect(r.alcanceTotal).toBe(100);
    expect(r.puntos.every((p) => p.alcance === 100)).toBe(true);
  });

  test('acumula lo completado por sprint y suma al final lo hecho sin sprint', () => {
    const r = calcularBurnup(100, [{ nombre: 'S1', completadoHoras: 20 }, { nombre: 'S2', completadoHoras: 30 }], 10);
    expect(r.puntos.map((p) => [p.nombre, p.completado])).toEqual([
      ['Inicio', 0],
      ['S1', 20],
      ['S2', 50],
      ['Actual', 60],
    ]);
  });

  test('sin sprints deja solo Inicio y Actual', () => {
    const r = calcularBurnup(40, [], 0);
    expect(r.puntos.map((p) => p.nombre)).toEqual(['Inicio', 'Actual']);
    expect(r.puntos[1].completado).toBe(0);
  });

  test('redondea a un decimal y acepta horas que llegan como texto de PostgreSQL', () => {
    const r = calcularBurnup('10.25', [{ nombre: 'S1', completadoHoras: '3.33' }], 0);
    expect(r.alcanceTotal).toBe(10.3);
    expect(r.puntos[1].completado).toBe(3.3);
  });
});

describe('Fechas del CFD', () => {
  test('sumarDias avanza y retrocede días sin depender de la zona horaria', () => {
    expect(sumarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('Columna de una tarjeta en un día (CFD)', () => {
  const tarjeta = { columnaActualId: 3 };
  const eventos = [
    { fecha: '2026-11-02', anteriorId: 1, nuevaId: 2 },
    { fecha: '2026-11-04', anteriorId: 2, nuevaId: 3 },
  ];

  test('antes del primer cambio, la tarjeta sigue en la columna anterior a ese cambio', () => {
    expect(columnaEnDia(tarjeta, eventos, '2026-11-01')).toBe(1);
  });

  test('en un día con cambio, cuenta la columna nueva', () => {
    expect(columnaEnDia(tarjeta, eventos, '2026-11-02')).toBe(2);
    expect(columnaEnDia(tarjeta, eventos, '2026-11-03')).toBe(2);
  });

  test('sin ningún cambio registrado, usa la columna actual', () => {
    expect(columnaEnDia(tarjeta, [], '2026-11-01')).toBe(3);
  });

  test('una tarjeta que salió de todas las columnas cuenta como sin columna', () => {
    expect(columnaEnDia({ columnaActualId: null }, [], '2026-11-01')).toBeNull();
  });
});

describe('Flujo acumulado (CFD)', () => {
  const columnas = [
    { id: 1, nombre: 'Por hacer', orden: 1, esFinal: false },
    { id: 2, nombre: 'En curso', orden: 2, esFinal: false },
    { id: 3, nombre: 'Hecho', orden: 3, esFinal: true },
  ];

  test('cuenta tarjetas por columna día a día con dos tarjetas que se mueven', () => {
    const r = calcularCfd({
      columnas,
      tareas: [
        { id: 10, creado: '2026-11-01', columnaActualId: 3 },
        { id: 11, creado: '2026-11-03', columnaActualId: 1 },
      ],
      eventos: [
        { tareaId: 10, fecha: '2026-11-02', anteriorId: 1, nuevaId: 2 },
        { tareaId: 10, fecha: '2026-11-04', anteriorId: 2, nuevaId: 3 },
      ],
      hoy: '2026-11-04',
    });

    expect(r.vacio).toBe(false);
    expect(r.dias.map((d) => d.fecha)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(r.dias[0].conteos).toMatchObject({ 1: 1, 2: 0, 3: 0 });
    expect(r.dias[1].conteos).toMatchObject({ 1: 0, 2: 1 });
    expect(r.dias[2].conteos).toMatchObject({ 1: 1, 2: 1 });
    expect(r.dias[3].conteos).toMatchObject({ 1: 1, 3: 1 });
  });

  test('una tarjeta no aparece antes de su fecha de creación', () => {
    const r = calcularCfd({
      columnas,
      tareas: [{ id: 1, creado: '2026-11-05', columnaActualId: 1 }],
      eventos: [],
      hoy: '2026-11-06',
    });
    expect(r.dias[0].fecha).toBe('2026-11-05');
    expect(r.dias).toHaveLength(2);
  });

  test('sin tarjetas devuelve vacio true y ningún día', () => {
    const r = calcularCfd({ columnas, tareas: [], eventos: [], hoy: '2026-11-04' });
    expect(r).toEqual({ vacio: true, columnas: expect.any(Array), dias: [] });
  });

  test('las tarjetas sin columna van a la clave sinColumna', () => {
    const r = calcularCfd({
      columnas,
      tareas: [{ id: 1, creado: '2026-11-01', columnaActualId: null }],
      eventos: [],
      hoy: '2026-11-01',
    });
    expect(r.dias[0].conteos.sinColumna).toBe(1);
  });

  test('ordena las columnas por orden aunque lleguen desordenadas', () => {
    const r = calcularCfd({ columnas: [...columnas].reverse(), tareas: [], eventos: [], hoy: '2026-11-01' });
    expect(r.columnas.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
