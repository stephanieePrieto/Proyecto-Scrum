/**
 * @file capacidad.test.js
 * @description Pruebas unitarias compatibles con Jest para el módulo de capacidad.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

process.env.MODO_DEMO = 'true';

const { validarCapacidad, fusionarAusencias, capacidadUsuario, capacidadEquipo } = await import('./capacidad.calculo.js');
const demo = await import('./capacidad.demo.js');
const { ErrorCapacidad, obtenerCapacidad, guardarCapacidad, obtenerCapacidadEquipo } = await import('./capacidad.service.js');

const sprint = { inicio: '2026-10-12', fin: '2026-10-23' };

describe('Módulo de Capacidad - Pruebas Unitarias', () => {
  beforeEach(() => {
    demo.reiniciar();
  });

  test('rechaza horas negativas, mayores a 24 o no numéricas', () => {
    expect(validarCapacidad({ horasPorDia: -1 })[0].campo).toBe('horasPorDia');
    expect(validarCapacidad({ horasPorDia: 24.5 })[0].campo).toBe('horasPorDia');
    expect(validarCapacidad({ horasPorDia: 'abc' })[0].campo).toBe('horasPorDia');
    expect(validarCapacidad({ horasPorDia: 6 })).toEqual([]);
    expect(validarCapacidad({ horasPorDia: 24 })).toEqual([]);
  });

  test('rechaza ausencias con fin anterior al inicio o con fecha inexistente', () => {
    const a = validarCapacidad({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-10-18', fechaFin: '2026-10-14' }] });
    expect(a[0].campo).toBe('ausencias[0].fechaFin');
    const b = validarCapacidad({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-02-30', fechaFin: '2026-03-01' }] });
    expect(b[0].campo).toBe('ausencias[0].fechaInicio');
  });

  test('sin ausencias: días laborables por horas por día', () => {
    expect(capacidadUsuario({ horasPorDia: 6 }, sprint)).toEqual({ horas: 60, diasHabiles: 10, diasAusente: 0 });
  });

  test('una ausencia dentro del sprint descuenta solo días laborables', () => {
    const r = capacidadUsuario({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-10-14', fechaFin: '2026-10-18' }] }, sprint);
    expect(r).toEqual({ horas: 42, diasHabiles: 7, diasAusente: 3 });
  });

  test('una ausencia fuera del sprint no se toma en cuenta', () => {
    const r = capacidadUsuario({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }] }, sprint);
    expect(r.horas).toBe(60);
  });

  test('una ausencia que cruza el borde del sprint solo cuenta la parte interna', () => {
    const r = capacidadUsuario({ horasPorDia: 5, ausencias: [{ fechaInicio: '2026-10-20', fechaFin: '2026-11-10' }] }, sprint);
    expect(r).toEqual({ horas: 30, diasHabiles: 6, diasAusente: 4 });
  });

  test('un sprint con fechas inválidas lanza error', () => {
    expect(() => capacidadUsuario({ horasPorDia: 6 }, { inicio: 'x', fin: 'y' })).toThrow(RangeError);
  });

  test('fusiona las ausencias traslapadas y reporta cuántas', () => {
    const r = fusionarAusencias([
      { fechaInicio: '2026-10-25', fechaFin: '2026-10-31' },
      { fechaInicio: '2026-10-14', fechaFin: '2026-10-18' },
      { fechaInicio: '2026-10-16', fechaFin: '2026-10-20' },
    ]);
    expect(r.fusionadas).toBe(1);
    expect(r.ausencias.map((a) => [a.fechaInicio, a.fechaFin])).toEqual([
      ['2026-10-14', '2026-10-20'],
      ['2026-10-25', '2026-10-31'],
    ]);
  });

  test('no fusiona ausencias contiguas sin días en común', () => {
    const r = fusionarAusencias([
      { fechaInicio: '2026-10-14', fechaFin: '2026-10-15' },
      { fechaInicio: '2026-10-16', fechaFin: '2026-10-17' },
    ]);
    expect(r.fusionadas).toBe(0);
    expect(r.ausencias.length).toBe(2);
  });

  test('el equipo suma las capacidades individuales', () => {
    const t = capacidadEquipo([{ usuarioId: 1, horasPorDia: 6 }, { usuarioId: 2, horasPorDia: 4 }], sprint);
    expect(t.totalHoras).toBe(100);
    expect(t.sinCapacidad).toBe(false);
  });

  test('un equipo con 0 horas se marca sin capacidad', () => {
    const t = capacidadEquipo([{ usuarioId: 1, horasPorDia: 0 }, { usuarioId: 2, horasPorDia: null }], sprint);
    expect(t.totalHoras).toBe(0);
    expect(t.sinCapacidad).toBe(true);
    expect(t.miembros[1].configurado).toBe(false);
  });

  test('servicio: guarda, fusiona y avisa', async () => {
    const r = await guardarCapacidad({ id: 1, rol: 'DEV' }, 1, {
      horasPorDia: 6,
      notas: ' QA ',
      ausencias: [
        { fechaInicio: '2026-10-14', fechaFin: '2026-10-18' },
        { fechaInicio: '2026-10-16', fechaFin: '2026-10-20' },
      ],
    });
    expect(r.fusionadas).toBe(1);
    expect(r.mensaje).toMatch(/Fusionamos 1 ausencia/);
    expect(r.ausencias.length).toBe(1);
    expect(r.notas).toBe('QA');
  });

  test('servicio: no guarda datos inválidos', async () => {
    await expect(guardarCapacidad({ id: 1, rol: 'DEV' }, 1, { horasPorDia: 30 })).rejects.toThrow(ErrorCapacidad);
    expect((await obtenerCapacidad(1)).horasPorDia).toBe(6);
  });

  test('servicio: solo la propia persona o un Admin pueden editar', async () => {
    await expect(guardarCapacidad({ id: 2, rol: 'DEV' }, 1, { horasPorDia: 6 })).rejects.toThrow();
    await guardarCapacidad({ id: 9, rol: 'Admin' }, 1, { horasPorDia: 5 });
    expect((await obtenerCapacidad(1)).horasPorDia).toBe(5);
  });

  test('servicio: la capacidad del equipo se recalcula tras guardar', async () => {
    const antes = await obtenerCapacidadEquipo(1, sprint);
    await guardarCapacidad({ id: 3, rol: 'DEV' }, 3, { horasPorDia: 5, ausencias: [] });
    const despues = await obtenerCapacidadEquipo(1, sprint);
    expect(despues.totalHoras - antes.totalHoras).toBe(50);
  });

  test('servicio: rechaza un rango de fechas inválido', async () => {
    await expect(obtenerCapacidadEquipo(1, { inicio: '2026-10-23', fin: '2026-10-12' })).rejects.toThrow();
  });
});