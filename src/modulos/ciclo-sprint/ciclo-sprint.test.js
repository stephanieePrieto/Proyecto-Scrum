/**
 * @file ciclo-sprint.test.js
 * @description Suite de pruebas unitarias para el ciclo de vida del Sprint (HU-06 y HU-09).
 * Compatible con Jest y ES Modules.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import { faltantesParaIniciar, calcularResumen, validarCierre } from './ciclo-sprint.reglas.js';

const completo = { 
  objetivo: 'Entregar el tablero', 
  capacidad: 80, 
  totalHistorias: 3, 
  tieneScrumMaster: true, 
  tieneProductOwner: true 
};

describe('Módulo Ciclo Sprint - Pruebas Unitarias', () => {
  test('un sprint completo puede iniciarse', () => {
    expect(faltantesParaIniciar(completo)).toEqual({ campos: {}, faltantes: [] });
  });

  test('indica qué falta: objetivo, historias, capacidad y roles', () => {
    const r = faltantesParaIniciar({ 
      objetivo: '  ', 
      capacidad: 0, 
      totalHistorias: 0, 
      tieneScrumMaster: false, 
      tieneProductOwner: false 
    });
    expect(r.faltantes.length).toBe(5);
    expect(Boolean(r.campos.objetivo && r.campos.capacidad_horas)).toBe(true);
  });

  test('bloquea si falta solo el Product Owner', () => {
    const r = faltantesParaIniciar({ ...completo, tieneProductOwner: false });
    expect(r.faltantes).toEqual(['El proyecto no tiene un Product Owner asignado.']);
  });

  test('la velocity suma solo los puntos de historias terminadas', () => {
    const r = calcularResumen([
      { estado: 'hecho', puntos: 5 },
      { estado: 'aceptada', puntos: 3 },
      { estado: 'en_sprint', puntos: 8 },
      { estado: 'rechazada', puntos: 2 },
    ]);
    expect(r).toEqual({ total: 4, terminadas: 2, noTerminadas: 2, puntosTotales: 18, velocity: 8 });
  });

  test('un sprint sin historias tiene velocity 0', () => {
    expect(calcularResumen([]).velocity).toBe(0);
  });

  test('historias sin puntos no rompen el cálculo', () => {
    expect(calcularResumen([{ estado: 'hecho', puntos: null }]).velocity).toBe(0);
  });

  test('exige decidir sobre las tarjetas en revisión', () => {
    const e = validarCierre({ noTerminadas: 0, enRevision: 2 });
    expect(Boolean(e.revision)).toBe(true);
    expect(validarCierre({ revision: 'pendiente', noTerminadas: 0, enRevision: 2 })).toEqual({});
  });

  test('exige elegir destino si quedan historias sin terminar', () => {
    expect(Boolean(validarCierre({ noTerminadas: 2, enRevision: 0 }).destino)).toBe(true);
    expect(validarCierre({ destino: 'backlog', noTerminadas: 2, enRevision: 0 })).toEqual({});
    expect(validarCierre({ noTerminadas: 0, enRevision: 0 })).toEqual({});
  });
});