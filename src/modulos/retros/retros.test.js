/**
 * @file retros.test.js
 * @description Pruebas unitarias de las reglas de la retrospectiva (HU-13) y del recordatorio de acciones (HU-14).
 * Compatible con Jest y ES Modules.
 */
import { describe, test, expect } from '@jest/globals';
import {
  MAX_VOTOS,
  MAX_TEXTO_ITEM,
  SEGUNDOS_EDICION,
  validarItem,
  validarAccion,
  votosRestantes,
  accionesIncompletas,
  estaVencida,
  diasDeRetraso,
  editaOtraPersona,
} from './retros.reglas.js';

const HOY = '2026-11-10';

describe('Retrospectiva (HU-13) - ítems', () => {
  test('rechaza un ítem vacío o con columna inválida', () => {
    expect(validarItem({ columna: 'bien', texto: '   ' }).errores.texto).toBeDefined();
    expect(validarItem({ columna: 'otra', texto: 'algo' }).errores.columna).toBeDefined();
  });

  test('acepta un ítem válido, recorta el texto y respeta el anonimato', () => {
    const { errores, valores } = validarItem({ columna: 'mejorar', texto: '  Más pruebas ', anonimo: true });
    expect(errores).toEqual({});
    expect(valores).toEqual({ columna: 'mejorar', texto: 'Más pruebas', anonimo: true });
    expect(validarItem({ columna: 'bien', texto: 'x', anonimo: 'si' }).valores.anonimo).toBe(false);
  });

  test('rechaza textos demasiado largos', () => {
    expect(validarItem({ columna: 'bien', texto: 'a'.repeat(MAX_TEXTO_ITEM + 1) }).errores.texto).toMatch(/Máximo/);
  });
});

describe('Retrospectiva (HU-13) - acciones', () => {
  test('exige texto, responsable y fecha límite', () => {
    const { errores } = validarAccion({}, HOY);
    expect(Object.keys(errores).sort()).toEqual(['fecha_limite', 'responsable_id', 'texto']);
  });

  test('rechaza una fecha pasada o inexistente', () => {
    expect(validarAccion({ texto: 'a', responsable_id: 1, fecha_limite: '2026-11-09' }, HOY).errores.fecha_limite).toMatch(/anterior a hoy/);
    expect(validarAccion({ texto: 'a', responsable_id: 1, fecha_limite: '2026-02-30' }, HOY).errores.fecha_limite).toBeDefined();
  });

  test('acepta hoy o una fecha futura con responsable', () => {
    const { errores, valores } = validarAccion({ texto: ' Hacer retro ', responsable_id: '3', fecha_limite: HOY }, HOY);
    expect(errores).toEqual({});
    expect(valores).toEqual({ texto: 'Hacer retro', responsable_id: 3, fecha_limite: HOY });
  });

  test('no se puede cerrar con acciones sin responsable o sin fecha', () => {
    const acciones = [
      { id: 1, responsable_id: 2, fecha_limite: HOY },
      { id: 2, responsable_id: null, fecha_limite: HOY },
      { id: 3, responsable_id: 2, fecha_limite: null },
    ];
    expect(accionesIncompletas(acciones).map((a) => a.id)).toEqual([2, 3]);
    expect(accionesIncompletas([acciones[0]])).toEqual([]);
  });
});

describe('Retrospectiva (HU-13) - votos', () => {
  test('cada integrante dispone de 5 votos', () => {
    expect(MAX_VOTOS).toBe(5);
    expect(votosRestantes(0)).toBe(5);
    expect(votosRestantes(5)).toBe(0);
    expect(votosRestantes(9)).toBe(0);
  });
});

describe('Retrospectiva (HU-13) - aviso "X la está editando"', () => {
  const ahora = 1_000_000;
  test('avisa si otra persona la edita y el aviso sigue vigente', () => {
    expect(editaOtraPersona({ usuarioId: 2, hasta: ahora + 5000 }, 1, ahora)).toBe(true);
  });
  test('no avisa a quien edita, ni cuando el aviso caducó, ni sin aviso', () => {
    expect(editaOtraPersona({ usuarioId: 1, hasta: ahora + 5000 }, 1, ahora)).toBe(false);
    expect(editaOtraPersona({ usuarioId: 2, hasta: ahora - 1 }, 1, ahora)).toBe(false);
    expect(editaOtraPersona(undefined, 1, ahora)).toBe(false);
    expect(SEGUNDOS_EDICION).toBeGreaterThan(0);
  });
});

describe('Recordatorio de acciones (HU-14)', () => {
  test('una acción pendiente vence al pasar su fecha límite', () => {
    expect(estaVencida({ fecha_limite: '2026-11-09', completada: false }, HOY)).toBe(true);
    expect(estaVencida({ fecha_limite: HOY, completada: false }, HOY)).toBe(false);
  });
  test('una acción completada nunca está vencida', () => {
    expect(estaVencida({ fecha_limite: '2026-01-01', completada: true }, HOY)).toBe(false);
  });
  test('cuenta los días de retraso', () => {
    expect(diasDeRetraso('2026-11-05', HOY)).toBe(5);
    expect(diasDeRetraso(HOY, HOY)).toBe(0);
    expect(diasDeRetraso(null, HOY)).toBe(0);
  });
});
