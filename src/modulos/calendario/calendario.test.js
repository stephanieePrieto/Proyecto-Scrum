/**
 * Probar las reglas del calendario. Ejecutar con: node --test src/modulos/calendario/calendario.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { diasHabiles, generarEventos, coinciden, conflictosPorAusencia } from './calendario.reglas.js';

const tipos = (eventos) => eventos.map((e) => e.tipo);

test('solo cuenta lunes a viernes', () => {
  // 2026-10-26 es lunes
  assert.deepEqual(diasHabiles('2026-10-26', '2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(diasHabiles('2026-10-31', '2026-11-01'), []);
});

test('un sprint de dos semanas tiene Planning, 8 Dailies, Review y Retro', () => {
  const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
  assert.equal(eventos[0].tipo, 'planning');
  assert.equal(eventos[0].fecha, '2026-10-26');
  assert.equal(tipos(eventos).filter((t) => t === 'daily').length, 8);
  assert.deepEqual(tipos(eventos).slice(-2), ['review', 'retro']);
  assert.equal(eventos.at(-1).fecha, '2026-11-06');
  // Ninguna Daily cae en el día de Planning ni en el de Review/Retro
  assert.ok(!eventos.some((e) => e.tipo === 'daily' && (e.fecha === '2026-10-26' || e.fecha === '2026-11-06')));
});

test('si el sprint termina en fin de semana, Review y Retro pasan al último día hábil', () => {
  const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-01' });
  assert.equal(eventos.find((e) => e.tipo === 'review').fecha, '2026-10-30');
});

test('un sprint sin días hábiles no genera eventos', () => {
  assert.deepEqual(generarEventos({ fechaInicio: '2026-10-31', fechaFin: '2026-11-01' }), []);
});

test('detecta cuándo los eventos guardados ya coinciden con las fechas', () => {
  const esperados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-10-30' });
  assert.equal(coinciden(esperados, esperados.map((e) => ({ ...e }))), true);
  const cambiados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
  assert.equal(coinciden(esperados, cambiados), false);
  assert.equal(coinciden(esperados, []), false);
});

test('avisa los eventos que caen en la ausencia del Scrum Master o Product Owner', () => {
  const eventos = [{ id: 1, fecha: '2026-10-27' }, { id: 2, fecha: '2026-10-29' }];
  const ausencias = [{ usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-28' }];
  const conflictos = conflictosPorAusencia(eventos, ausencias);
  assert.equal(conflictos.get(1)[0].nombre, 'Stephy');
  assert.equal(conflictos.has(2), false);
});

test('no repite a la misma persona si tiene dos ausencias el mismo día', () => {
  const ausencias = [
    { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-27' },
    { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-26', hasta: '2026-10-28' },
  ];
  assert.equal(conflictosPorAusencia([{ id: 1, fecha: '2026-10-27' }], ausencias).get(1).length, 1);
});
