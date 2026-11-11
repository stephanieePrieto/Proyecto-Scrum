/**
 * @file reviews.test.js
 * @description Pruebas unitarias de las reglas de la Sprint Review (HU-12): criterios, decisión, delegación y velocity.
 * Compatible con Jest y ES Modules.
 */
import { describe, test, expect } from '@jest/globals';
import {
  MAX_COMENTARIO,
  MAX_DIAS_DELEGACION,
  separarCriterios,
  esHistoriaTerminada,
  validarDecision,
  validarDelegacion,
  sumarDias,
  resumirReview,
} from './reviews.reglas.js';

const HOY = '2026-11-11';

describe('Review (HU-12) - criterios de aceptación', () => {
  test('separa un criterio por línea y quita viñetas', () => {
    expect(separarCriterios('Dado que A, entonces B.\n- Dado que C, entonces D.\r\n\n  ')).toEqual([
      'Dado que A, entonces B.',
      'Dado que C, entonces D.',
    ]);
  });

  test('separa varios "Dado que" que vienen seguidos en la misma línea', () => {
    expect(separarCriterios('Dado que A, entonces B. Dado que C, entonces D.')).toHaveLength(2);
  });

  test('un texto vacío o que no es texto no tiene criterios', () => {
    expect(separarCriterios('')).toEqual([]);
    expect(separarCriterios(null)).toEqual([]);
    expect(separarCriterios(42)).toEqual([]);
  });
});

describe('Review (HU-12) - historias terminadas', () => {
  test('con decisión, en hecho o aceptada ya está terminada', () => {
    expect(esHistoriaTerminada({ estado: 'en_sprint', tareas: 0, tareasHechas: 0, decision: 'rechazada' })).toBe(true);
    expect(esHistoriaTerminada({ estado: 'hecho', tareas: 0, tareasHechas: 0 })).toBe(true);
    expect(esHistoriaTerminada({ estado: 'aceptada', tareas: 0, tareasHechas: 0 })).toBe(true);
  });

  test('en sprint solo cuenta si todas sus tarjetas están en la columna final', () => {
    expect(esHistoriaTerminada({ estado: 'en_sprint', tareas: 3, tareasHechas: 3 })).toBe(true);
    expect(esHistoriaTerminada({ estado: 'en_sprint', tareas: 3, tareasHechas: 2 })).toBe(false);
    expect(esHistoriaTerminada({ estado: 'en_sprint', tareas: 0, tareasHechas: 0 })).toBe(false);
    expect(esHistoriaTerminada({ estado: 'backlog', tareas: 2, tareasHechas: 2 })).toBe(false);
  });
});

describe('Review (HU-12) - decisión del Product Owner', () => {
  test('rechazar exige comentario; aceptar lo deja opcional', () => {
    expect(validarDecision({ decision: 'rechazada', comentario: '   ' }).errores.comentario).toBeDefined();
    expect(validarDecision({ decision: 'aceptada', comentario: '' }).errores).toEqual({});
    expect(validarDecision({ decision: 'rechazada', comentario: ' Falta validar ' }).valores.comentario).toBe('Falta validar');
  });

  test('rechaza una decisión inválida y un comentario demasiado largo', () => {
    expect(validarDecision({ decision: 'quizas' }).errores.decision).toBeDefined();
    expect(validarDecision({ decision: 'aceptada', comentario: 'a'.repeat(MAX_COMENTARIO + 1) }).errores.comentario).toBeDefined();
  });

  test('advierte al aceptar con criterios incompletos (3 de 4)', () => {
    const { incompletos, valores } = validarDecision({ decision: 'aceptada', criterios_cumplidos: 3 }, 4);
    expect(incompletos).toBe(true);
    expect(valores.criteriosCumplidos).toBe(3);
    expect(valores.criteriosTotal).toBe(4);
  });

  test('no advierte con todos los criterios, sin criterios o al rechazar', () => {
    expect(validarDecision({ decision: 'aceptada', criterios_cumplidos: 4 }, 4).incompletos).toBe(false);
    expect(validarDecision({ decision: 'aceptada' }, 0).incompletos).toBe(false);
    expect(validarDecision({ decision: 'rechazada', comentario: 'x', criterios_cumplidos: 1 }, 4).incompletos).toBe(false);
  });

  test('rechaza una cantidad de criterios fuera de rango', () => {
    expect(validarDecision({ decision: 'aceptada', criterios_cumplidos: 5 }, 4).errores.criterios_cumplidos).toBeDefined();
    expect(validarDecision({ decision: 'aceptada', criterios_cumplidos: -1 }, 4).errores.criterios_cumplidos).toBeDefined();
    expect(validarDecision({ decision: 'aceptada', criterios_cumplidos: 1.5 }, 4).errores.criterios_cumplidos).toBeDefined();
  });

  test('confirmar y cambiar solo valen cuando son exactamente true', () => {
    expect(validarDecision({ decision: 'aceptada', confirmar: 'true', cambiar: 1 }).valores).toMatchObject({ confirmar: false, cambiar: false });
    expect(validarDecision({ decision: 'aceptada', confirmar: true, cambiar: true }).valores).toMatchObject({ confirmar: true, cambiar: true });
  });
});

describe('Review (HU-12) - delegación temporal', () => {
  test('suma días a una fecha', () => {
    expect(sumarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(sumarDias(HOY, MAX_DIAS_DELEGACION)).toBe('2026-12-11');
  });

  test('acepta una delegación válida y recorta el motivo', () => {
    const { errores, valores } = validarDelegacion({ delegado_id: 4, hasta: '2026-11-15', motivo: '  Viaje ' }, HOY);
    expect(errores).toEqual({});
    expect(valores).toEqual({ delegadoId: 4, hasta: '2026-11-15', motivo: 'Viaje' });
  });

  test('exige delegado y una fecha real que no esté en el pasado', () => {
    expect(validarDelegacion({ hasta: '2026-11-15' }, HOY).errores.delegado_id).toBeDefined();
    expect(validarDelegacion({ delegado_id: 4 }, HOY).errores.hasta).toBeDefined();
    expect(validarDelegacion({ delegado_id: 4, hasta: '2026-02-30' }, HOY).errores.hasta).toBeDefined();
    expect(validarDelegacion({ delegado_id: 4, hasta: '2026-11-10' }, HOY).errores.hasta).toBeDefined();
  });

  test('limita la duración y el largo del motivo', () => {
    expect(validarDelegacion({ delegado_id: 4, hasta: HOY }, HOY).errores).toEqual({});
    expect(validarDelegacion({ delegado_id: 4, hasta: '2026-12-12' }, HOY).errores.hasta).toBeDefined();
    expect(validarDelegacion({ delegado_id: 4, hasta: HOY, motivo: 'x'.repeat(201) }, HOY).errores.motivo).toBeDefined();
  });
});

describe('Review (HU-12) - velocity', () => {
  test('la velocity suma solo los puntos de las historias aceptadas', () => {
    const resumen = resumirReview([
      { puntos: 5, terminada: true, decision: 'aceptada' },
      { puntos: 3, terminada: true, decision: 'aceptada' },
      { puntos: 8, terminada: true, decision: 'rechazada' },
      { puntos: 2, terminada: true, decision: null },
      { puntos: 13, terminada: false, decision: null },
      { puntos: null, terminada: true, decision: 'aceptada' },
    ]);
    expect(resumen).toEqual({ aceptadas: 3, rechazadas: 1, porRevisar: 1, velocity: 8, puntosRechazados: 8, puntosPorRevisar: 2 });
  });

  test('sin historias todo es cero', () => {
    expect(resumirReview([]).velocity).toBe(0);
  });
});
