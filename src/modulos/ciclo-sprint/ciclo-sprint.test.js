/**
 * @file ciclo-sprint.test.js
 * @description Suite de pruebas unitarias para el ciclo de vida del Sprint.
 * Compatible con Jest y ES Modules.
 * 
 * @author Diego Rafael Jiménez Trujano
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import {
  faltantesParaIniciar, calcularResumen, validarCierre, faltaVerificar, estaTerminada, validarDod, MAX_HISTORIAS_DOD,
} from './ciclo-sprint.reglas.js';
import { MAX_DOD } from '../reviews/reviews.reglas.js';

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

  test('con criterios, una historia en Hecho sin aceptar en la Review no cuenta como terminada', () => {
    const criterios = 'Dado que A\nDado que B';
    expect(faltaVerificar({ criterios })).toEqual(['criterios']);
    expect(estaTerminada({ estado: 'hecho', criterios })).toBe(false);
    expect(estaTerminada({ estado: 'hecho', criterios, decision: 'rechazada', criterios_cumplidos: 2 })).toBe(false);
  });

  test('aceptada con criterios incompletos (la antigua confirmación) tampoco cuenta', () => {
    const h = { estado: 'aceptada', criterios: 'Dado que A\nDado que B\nDado que C', decision: 'aceptada', criterios_cumplidos: 2 };
    expect(estaTerminada(h)).toBe(false);
    expect(calcularResumen([{ ...h, puntos: 5 }])).toMatchObject({ terminadas: 0, noTerminadas: 1, velocity: 0 });
  });

  test('aceptada con todos sus criterios sí cuenta, igual que una historia sin criterios', () => {
    const aceptada = { estado: 'aceptada', criterios: 'Dado que A\nDado que B', decision: 'aceptada', criterios_cumplidos: 2, puntos: 5 };
    expect(faltaVerificar(aceptada)).toEqual([]);
    expect(calcularResumen([aceptada, { estado: 'hecho', criterios: '  ', puntos: 3 }])).toMatchObject({ terminadas: 2, velocity: 8 });
  });

  test('si se agregan criterios después de aceptarla, vuelve a faltar verificarla', () => {
    expect(estaTerminada({ estado: 'aceptada', criterios: 'Dado que A\nDado que B\nDado que C', decision: 'aceptada', criterios_cumplidos: 2 })).toBe(false);
  });

  test('con DoD, solo cuenta si se aceptó con todos sus puntos (la del sprint o del proyecto, más la propia)', () => {
    const base = { estado: 'aceptada', decision: 'aceptada', dod_proyecto: 'P1', dod_sprint: 'S1\nS2', dod_historia: 'H1' };
    expect(faltaVerificar({ ...base, dod_cumplidos: 2 })).toEqual(['dod']);
    expect(faltaVerificar({ ...base, dod_cumplidos: 3 })).toEqual([]);
    expect(estaTerminada({ ...base, dod_sprint: null, dod_cumplidos: 2 })).toBe(true); // P1 + H1
  });

  test('una historia en Hecho sin Review no cuenta porque siempre hay DoD del proyecto', () => {
    expect(faltaVerificar({ dod_proyecto: 'Código revisado' })).toEqual(['dod']);
    expect(calcularResumen([{ estado: 'hecho', puntos: 5, dod_proyecto: 'Código revisado' }])).toMatchObject({ terminadas: 0, velocity: 0 });
  });

  test('una aceptación de antes de la DoD (dod_cumplidos NULL) no cuenta como verificada', () => {
    expect(faltaVerificar({ decision: 'aceptada', dod_proyecto: 'P1', dod_cumplidos: null })).toEqual(['dod']);
  });

  test('faltan criterios y DoD a la vez', () => {
    expect(faltaVerificar({ criterios: 'Dado que A', dod_proyecto: 'P1' })).toEqual(['criterios', 'dod']);
  });

  test('valida la DoD que guarda el Scrum Master (vacía = NULL)', () => {
    const { errores, valores } = validarDod({
      definition_of_done: '  Código revisado\r\nPruebas  ',
      historias: [{ id: 4, definition_of_done: '' }, { id: '7', definition_of_done: 'Manual' }],
    });
    expect(errores).toEqual({});
    expect(valores).toEqual({ sprint: 'Código revisado\nPruebas', historias: [{ id: 4, texto: null }, { id: 7, texto: 'Manual' }] });
    expect(validarDod({}).valores).toEqual({ sprint: null, historias: [] });
  });

  test('rechaza DoD demasiado larga, no textual o con historias inválidas o repetidas', () => {
    expect(validarDod({ definition_of_done: 'x'.repeat(MAX_DOD + 1) }).errores.definition_of_done).toBeDefined();
    expect(validarDod({ definition_of_done: 5 }).errores.definition_of_done).toBeDefined();
    expect(validarDod({ historias: [{ id: 3, definition_of_done: 'x'.repeat(MAX_DOD + 1) }] }).errores['historia-3']).toBeDefined();
    expect(validarDod({ historias: [{ id: 'a' }] }).errores.historias).toBeDefined();
    expect(validarDod({ historias: [{ id: 2 }, { id: 2 }] }).errores.historias).toBeDefined();
    expect(validarDod({ historias: 'x' }).errores.historias).toBeDefined();
    expect(validarDod({ historias: Array.from({ length: MAX_HISTORIAS_DOD + 1 }, (_, i) => ({ id: i + 1 })) }).errores.historias).toBeDefined();
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