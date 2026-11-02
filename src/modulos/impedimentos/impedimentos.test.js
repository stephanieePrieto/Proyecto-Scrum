/**
 * Probar las reglas de impedimentos. Ejecutar con: node --test src/modulos/impedimentos/impedimentos.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarImpedimento,
  horasAbierto,
  estaVencido,
  mensajeYaResuelto,
  aId,
} from './impedimentos.reglas.js';

test('indica el campo faltante: título y responsable son obligatorios', () => {
  const { errores } = validarImpedimento({ titulo: '   ', severidad: 'alta' });
  assert.ok(errores.titulo);
  assert.ok(errores.responsable_id);
  assert.equal(errores.severidad, undefined);

  assert.deepEqual(validarImpedimento({ titulo: 'Falla el servidor', responsable_id: 4 }).errores, {});
});

test('la severidad es "media" por omisión y solo acepta baja, media o alta', () => {
  assert.equal(validarImpedimento({ titulo: 'x', responsable_id: 1 }).valores.severidad, 'media');
  assert.equal(validarImpedimento({ titulo: 'x', responsable_id: 1, severidad: 'alta' }).valores.severidad, 'alta');
  assert.ok(validarImpedimento({ titulo: 'x', responsable_id: 1, severidad: 'critica' }).errores.severidad);
});

test('la tarea afectada es opcional pero, si viene, debe ser un id válido', () => {
  assert.equal(validarImpedimento({ titulo: 'x', responsable_id: 1 }).valores.tarea_id, null);
  assert.equal(validarImpedimento({ titulo: 'x', responsable_id: 1, tarea_id: '7' }).valores.tarea_id, 7);
  assert.ok(validarImpedimento({ titulo: 'x', responsable_id: 1, tarea_id: 'abc' }).errores.tarea_id);
});

test('recorta el título y rechaza uno demasiado largo', () => {
  assert.equal(validarImpedimento({ titulo: '  Sin acceso  ', responsable_id: 1 }).valores.titulo, 'Sin acceso');
  assert.ok(validarImpedimento({ titulo: 'x'.repeat(201), responsable_id: 1 }).errores.titulo);
});

test('aId solo acepta enteros positivos', () => {
  assert.equal(aId('12'), 12);
  assert.equal(aId(0), null);
  assert.equal(aId('1.5'), null);
  assert.equal(aId(''), null);
});

test('resalta en rojo solo lo abierto por MÁS de 3 días', () => {
  const ahora = new Date('2026-10-26T12:00:00Z');
  const hace = (dias) => new Date(ahora.getTime() - dias * 24 * 3600 * 1000);
  assert.equal(estaVencido({ estado: 'abierto', creadoEn: hace(3) }, ahora), false); // exactamente 3 días: aún no
  assert.equal(estaVencido({ estado: 'abierto', creadoEn: hace(3.01) }, ahora), true);
  assert.equal(estaVencido({ estado: 'abierto', creadoEn: hace(1) }, ahora), false);
  assert.equal(estaVencido({ estado: 'resuelto', creadoEn: hace(10) }, ahora), false);
});

test('calcula cuánto estuvo abierto un impedimento resuelto', () => {
  const creado = new Date('2026-10-20T08:00:00Z');
  const resuelto = new Date('2026-10-21T10:30:00Z');
  assert.equal(horasAbierto(creado, resuelto), 26.5);
  assert.equal(horasAbierto(creado, null, new Date('2026-10-20T09:00:00Z')), 1);
});

test('mensaje cuando otra persona ya lo resolvió', () => {
  assert.equal(mensajeYaResuelto('Dana Carmona'), 'Ya fue resuelto por Dana Carmona.');
  assert.equal(mensajeYaResuelto(null), 'Ya fue resuelto por otra persona.');
});
