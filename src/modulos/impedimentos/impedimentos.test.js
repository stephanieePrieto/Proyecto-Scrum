/**
 * @file impedimentos.test.js
 * @description Suite de pruebas unitarias para el registro e historial de impedimentos.
 * Compatible con Jest y ES Modules.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import {
  validarImpedimento,
  horasAbierto,
  estaVencido,
  mensajeYaResuelto,
  aId,
} from './impedimentos.reglas.js';

describe('Módulo de Impedimentos - Pruebas Unitarias', () => {
  test('indica el campo faltante: título y responsable son obligatorios', () => {
    const { errores } = validarImpedimento({ titulo: '   ', severidad: 'alta' });
    expect(errores.titulo).toBeDefined();
    expect(errores.responsable_id).toBeDefined();
    expect(errores.severidad).toBeUndefined();

    expect(validarImpedimento({ titulo: 'Falla el servidor', responsable_id: 4 }).errores).toEqual({});
  });

  test('la severidad es "media" por omisión y solo acepta baja, media o alta', () => {
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1 }).valores.severidad).toBe('media');
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1, severidad: 'alta' }).valores.severidad).toBe('alta');
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1, severidad: 'critica' }).errores.severidad).toBeDefined();
  });

  test('la tarea afectada es opcional pero, si viene, debe ser un id válido', () => {
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1 }).valores.tarea_id).toBeNull();
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1, tarea_id: '7' }).valores.tarea_id).toBe(7);
    expect(validarImpedimento({ titulo: 'x', responsable_id: 1, tarea_id: 'abc' }).errores.tarea_id).toBeDefined();
  });

  test('recorta el título y rechaza uno demasiado largo', () => {
    expect(validarImpedimento({ titulo: '  Sin acceso  ', responsable_id: 1 }).valores.titulo).toBe('Sin acceso');
    expect(validarImpedimento({ titulo: 'x'.repeat(201), responsable_id: 1 }).errores.titulo).toBeDefined();
  });

  test('aId solo acepta enteros positivos', () => {
    expect(aId('12')).toBe(12);
    expect(aId(0)).toBeNull();
    expect(aId('1.5')).toBeNull();
    expect(aId('')).toBeNull();
  });

  test('resalta en rojo solo lo abierto por MÁS de 3 días', () => {
    const ahora = new Date('2026-10-26T12:00:00Z');
    const hace = (dias) => new Date(ahora.getTime() - dias * 24 * 3600 * 1000);
    expect(estaVencido({ estado: 'abierto', creadoEn: hace(3) }, ahora)).toBe(false);
    expect(estaVencido({ estado: 'abierto', creadoEn: hace(3.01) }, ahora)).toBe(true);
    expect(estaVencido({ estado: 'abierto', creadoEn: hace(1) }, ahora)).toBe(false);
    expect(estaVencido({ estado: 'resuelto', creadoEn: hace(10) }, ahora)).toBe(false);
  });

  test('calcula cuánto estuvo abierto un impedimento resuelto', () => {
    const creado = new Date('2026-10-20T08:00:00Z');
    const resuelto = new Date('2026-10-21T10:30:00Z');
    expect(horasAbierto(creado, resuelto)).toBe(26.5);
    expect(horasAbierto(creado, null, new Date('2026-10-20T09:00:00Z'))).toBe(1);
  });

  test('mensaje cuando otra persona ya lo resolvió', () => {
    expect(mensajeYaResuelto('Dana Carmona')).toBe('Ya fue resuelto por Dana Carmona.');
    expect(mensajeYaResuelto(null)).toBe('Ya fue resuelto por otra persona.');
  });
});