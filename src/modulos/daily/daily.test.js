/**
 * Probar las reglas del Daily Scrum. Ejecutar con: node --test src/modulos/daily/daily.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEXTO,
  esFechaValida,
  validarDaily,
  esTarde,
  estadoIntegrante,
  resumenEstados,
} from './daily.reglas.js';

test('exige qué hice ayer y qué haré hoy; los impedimentos son opcionales', () => {
  const { errores } = validarDaily({ ayer: '  ', hoy: '' });
  assert.ok(errores.ayer && errores.hoy);
  const ok = validarDaily({ ayer: 'Terminé el login', hoy: 'Haré el tablero' });
  assert.deepEqual(ok.errores, {});
  assert.equal(ok.valores.impedimentos, null);
});

test('recorta espacios y rechaza textos muy largos', () => {
  const { valores } = validarDaily({ ayer: '  a  ', hoy: ' b ', impedimentos: '  c ' });
  assert.deepEqual([valores.ayer, valores.hoy, valores.impedimentos], ['a', 'b', 'c']);
  const largo = validarDaily({ ayer: 'x'.repeat(MAX_TEXTO + 1), hoy: 'b' });
  assert.ok(largo.errores.ayer);
});

test('las tareas vinculadas se limpian: sin repetidos y solo enteros positivos', () => {
  assert.deepEqual(validarDaily({ ayer: 'a', hoy: 'b', tareas: [3, '3', 5] }).valores.tareas, [3, 5]);
  assert.ok(validarDaily({ ayer: 'a', hoy: 'b', tareas: [0] }).errores.tareas);
  assert.ok(validarDaily({ ayer: 'a', hoy: 'b', tareas: ['x'] }).errores.tareas);
  assert.ok(validarDaily({ ayer: 'a', hoy: 'b', tareas: 'no' }).errores.tareas);
});

test('valida fechas reales', () => {
  assert.equal(esFechaValida('2026-10-26'), true);
  assert.equal(esFechaValida('2026-02-30'), false);
  assert.equal(esFechaValida('26/10/2026'), false);
  assert.equal(esFechaValida(undefined), false);
});

test('marca "tarde" según el fin de la Daily del calendario', () => {
  const termina = new Date('2026-10-26T16:15:00Z');
  assert.equal(esTarde({ ahora: new Date('2026-10-26T16:00:00Z'), terminaEn: termina, horaLocal: '10:00' }), false);
  assert.equal(esTarde({ ahora: new Date('2026-10-26T16:30:00Z'), terminaEn: termina, horaLocal: '10:30' }), true);
});

test('sin evento en el calendario, marca "tarde" después de la hora de corte', () => {
  assert.equal(esTarde({ ahora: new Date(), horaLocal: '09:59' }), false);
  assert.equal(esTarde({ ahora: new Date(), horaLocal: '10:00' }), false);
  assert.equal(esTarde({ ahora: new Date(), horaLocal: '10:01' }), true);
  assert.equal(esTarde({ ahora: new Date(), horaLocal: '08:30', horaCorte: '08:00' }), true);
});

test('estado del integrante: registrado, tarde, ausente (sin penalización) o pendiente', () => {
  assert.equal(estadoIntegrante({ daily: { tardio: false }, ausente: false }), 'registrado');
  assert.equal(estadoIntegrante({ daily: { tardio: true }, ausente: false }), 'tarde');
  assert.equal(estadoIntegrante({ daily: null, ausente: true }), 'ausente');
  assert.equal(estadoIntegrante({ daily: null, ausente: false }), 'pendiente');
  // Si estando ausente igual registró, cuenta su registro
  assert.equal(estadoIntegrante({ daily: { tardio: false }, ausente: true }), 'registrado');
});

test('el resumen cuenta cada estado', () => {
  const r = resumenEstados([{ estado: 'registrado' }, { estado: 'tarde' }, { estado: 'pendiente' }, { estado: 'pendiente' }]);
  assert.deepEqual(r, { registrado: 1, tarde: 1, ausente: 0, pendiente: 2 });
});
