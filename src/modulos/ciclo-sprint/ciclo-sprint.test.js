/**
 * Probar las reglas del ciclo del sprint. Ejecutar con: node --test src/modulos/ciclo-sprint/ciclo-sprint.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { faltantesParaIniciar, calcularResumen, validarCierre } from './ciclo-sprint.reglas.js';

const completo = { objetivo: 'Entregar el tablero', capacidad: 80, totalHistorias: 3, tieneScrumMaster: true, tieneProductOwner: true };

test('un sprint completo puede iniciarse', () => {
  assert.deepEqual(faltantesParaIniciar(completo), { campos: {}, faltantes: [] });
});

test('indica qué falta: objetivo, historias, capacidad y roles', () => {
  const r = faltantesParaIniciar({ objetivo: '  ', capacidad: 0, totalHistorias: 0, tieneScrumMaster: false, tieneProductOwner: false });
  assert.equal(r.faltantes.length, 5);
  assert.ok(r.campos.objetivo && r.campos.capacidad_horas);
});

test('bloquea si falta solo el Product Owner', () => {
  const r = faltantesParaIniciar({ ...completo, tieneProductOwner: false });
  assert.deepEqual(r.faltantes, ['El proyecto no tiene un Product Owner asignado.']);
});

test('la velocity suma solo los puntos de historias terminadas', () => {
  const r = calcularResumen([
    { estado: 'hecho', puntos: 5 },
    { estado: 'aceptada', puntos: 3 },
    { estado: 'en_sprint', puntos: 8 },
    { estado: 'rechazada', puntos: 2 },
  ]);
  assert.deepEqual(r, { total: 4, terminadas: 2, noTerminadas: 2, puntosTotales: 18, velocity: 8 });
});

test('un sprint sin historias tiene velocity 0', () => {
  assert.equal(calcularResumen([]).velocity, 0);
});

test('historias sin puntos no rompen el cálculo', () => {
  assert.equal(calcularResumen([{ estado: 'hecho', puntos: null }]).velocity, 0);
});

test('exige decidir sobre las tarjetas en revisión', () => {
  const e = validarCierre({ noTerminadas: 0, enRevision: 2 });
  assert.ok(e.revision);
  assert.deepEqual(validarCierre({ revision: 'pendiente', noTerminadas: 0, enRevision: 2 }), {});
});

test('exige elegir destino si quedan historias sin terminar', () => {
  assert.ok(validarCierre({ noTerminadas: 2, enRevision: 0 }).destino);
  assert.deepEqual(validarCierre({ destino: 'backlog', noTerminadas: 2, enRevision: 0 }), {});
  assert.deepEqual(validarCierre({ noTerminadas: 0, enRevision: 0 }), {});
});
