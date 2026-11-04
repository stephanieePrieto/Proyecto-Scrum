/**
 * @file calendario.test.js
 * @description Suite de pruebas unitarias para el calendario de eventos Scrum.
 * Compatible con Jest y ES Modules.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import { diasHabiles, generarEventos, coinciden, conflictosPorAusencia } from './calendario.reglas.js';

const tipos = (eventos) => eventos.map((e) => e.tipo);

describe('Módulo de Calendario - Pruebas Unitarias', () => {
  test('solo cuenta lunes a viernes', () => {
    expect(diasHabiles('2026-10-26', '2026-11-01')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(diasHabiles('2026-10-31', '2026-11-01')).toEqual([]);
  });

  test('un sprint de dos semanas tiene Planning, 8 Dailies, Review y Retro', () => {
    const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
    expect(eventos[0].tipo).toBe('planning');
    expect(eventos[0].fecha).toBe('2026-10-26');
    expect(tipos(eventos).filter((t) => t === 'daily').length).toBe(8);
    expect(tipos(eventos).slice(-2)).toEqual(['review', 'retro']);
    expect(eventos.at(-1).fecha).toBe('2026-11-06');
    expect(eventos.some((e) => e.tipo === 'daily' && (e.fecha === '2026-10-26' || e.fecha === '2026-11-06'))).toBe(false);
  });

  test('si el sprint termina en fin de semana, Review y Retro pasan al último día hábil', () => {
    const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-01' });
    expect(eventos.find((e) => e.tipo === 'review').fecha).toBe('2026-10-30');
  });

  test('un sprint sin días hábiles no genera eventos', () => {
    expect(generarEventos({ fechaInicio: '2026-10-31', fechaFin: '2026-11-01' })).toEqual([]);
  });

  test('detecta cuándo los eventos guardados ya coinciden con las fechas', () => {
    const esperados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-10-30' });
    expect(coinciden(esperados, esperados.map((e) => ({ ...e })))).toBe(true);
    const cambiados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
    expect(coinciden(esperados, cambiados)).toBe(false);
    expect(coinciden(esperados, [])).toBe(false);
  });

  test('avisa los eventos que caen en la ausencia del Scrum Master o Product Owner', () => {
    const eventos = [{ id: 1, fecha: '2026-10-27' }, { id: 2, fecha: '2026-10-29' }];
    const ausencias = [{ usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-28' }];
    const conflictos = conflictosPorAusencia(eventos, ausencias);
    expect(conflictos.get(1)[0].nombre).toBe('Stephy');
    expect(conflictos.has(2)).toBe(false);
  });

  test('no repite a la misma persona si tiene dos ausencias el mismo día', () => {
    const ausencias = [
      { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-27' },
      { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-26', hasta: '2026-10-28' },
    ];
    expect(conflictosPorAusencia([{ id: 1, fecha: '2026-10-27' }], ausencias).get(1).length).toBe(1);
  });
});