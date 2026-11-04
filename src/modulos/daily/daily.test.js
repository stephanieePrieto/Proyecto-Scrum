/**
 * @file daily.test.js
 * @description Suite de pruebas unitarias para el registro de Daily Scrum.
 * Compatible con Jest y ES Modules.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import {
  MAX_TEXTO,
  esFechaValida,
  validarDaily,
  esTarde,
  estadoIntegrante,
  resumenEstados,
} from './daily.reglas.js';

describe('Módulo de Daily Scrum - Pruebas Unitarias', () => {
  test('exige qué hice ayer y qué haré hoy; los impedimentos son opcionales', () => {
    const { errores } = validarDaily({ ayer: '  ', hoy: '' });
    expect(errores.ayer).toBeDefined();
    expect(errores.hoy).toBeDefined();

    const ok = validarDaily({ ayer: 'Terminé el login', hoy: 'Haré el tablero' });
    expect(ok.errores).toEqual({});
    expect(ok.valores.impedimentos).toBeNull();
  });

  test('recorta espacios y rechaza textos muy largos', () => {
    const { valores } = validarDaily({ ayer: '  a  ', hoy: ' b ', impedimentos: '  c ' });
    expect([valores.ayer, valores.hoy, valores.impedimentos]).toEqual(['a', 'b', 'c']);
    const largo = validarDaily({ ayer: 'x'.repeat(MAX_TEXTO + 1), hoy: 'b' });
    expect(largo.errores.ayer).toBeDefined();
  });

  test('las tareas vinculadas se limpian: sin repetidos y solo enteros positivos', () => {
    expect(validarDaily({ ayer: 'a', hoy: 'b', tareas: [3, '3', 5] }).valores.tareas).toEqual([3, 5]);
    expect(validarDaily({ ayer: 'a', hoy: 'b', tareas: [0] }).errores.tareas).toBeDefined();
    expect(validarDaily({ ayer: 'a', hoy: 'b', tareas: ['x'] }).errores.tareas).toBeDefined();
    expect(validarDaily({ ayer: 'a', hoy: 'b', tareas: 'no' }).errores.tareas).toBeDefined();
  });

  test('valida fechas reales', () => {
    expect(esFechaValida('2026-10-26')).toBe(true);
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('26/10/2026')).toBe(false);
    expect(esFechaValida(undefined)).toBe(false);
  });

  test('marca "tarde" según el fin de la Daily del calendario', () => {
    const termina = new Date('2026-10-26T16:15:00Z');
    expect(esTarde({ ahora: new Date('2026-10-26T16:00:00Z'), terminaEn: termina, horaLocal: '10:00' })).toBe(false);
    expect(esTarde({ ahora: new Date('2026-10-26T16:30:00Z'), terminaEn: termina, horaLocal: '10:30' })).toBe(true);
  });

  test('sin evento en el calendario, marca "tarde" después de la hora de corte', () => {
    expect(esTarde({ ahora: new Date(), horaLocal: '09:59' })).toBe(false);
    expect(esTarde({ ahora: new Date(), horaLocal: '10:00' })).toBe(false);
    expect(esTarde({ ahora: new Date(), horaLocal: '10:01' })).toBe(true);
    expect(esTarde({ ahora: new Date(), horaLocal: '08:30', horaCorte: '08:00' })).toBe(true);
  });

  test('estado del integrante: registrado, tarde, ausente (sin penalización) o pendiente', () => {
    expect(estadoIntegrante({ daily: { tardio: false }, ausente: false })).toBe('registrado');
    expect(estadoIntegrante({ daily: { tardio: true }, ausente: false })).toBe('tarde');
    expect(estadoIntegrante({ daily: null, ausente: true })).toBe('ausente');
    expect(estadoIntegrante({ daily: null, ausente: false })).toBe('pendiente');
    expect(estadoIntegrante({ daily: { tardio: false }, ausente: true })).toBe('registrado');
  });

  test('el resumen cuenta cada estado', () => {
    const r = resumenEstados([{ estado: 'registrado' }, { estado: 'tarde' }, { estado: 'pendiente' }, { estado: 'pendiente' }]);
    expect(r).toEqual({ registrado: 1, tarde: 1, ausente: 0, pendiente: 2 });
  });
});