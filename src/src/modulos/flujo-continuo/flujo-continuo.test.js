// Responsable: Alfonso - HU-26: pruebas de la lógica pura del flujo continuo (Lead Time, Cycle Time y cambio de modo).
/**
 * @file flujo-continuo.test.js
 * @description Pruebas unitarias de flujo-continuo.calculo.js (HU-26). Solo lógica pura:
 * sin base de datos, sin Express y sin simulaciones de la base de datos.
 *
 * Tablero de prueba: 1 "Por hacer" (primera), 2 "En progreso", 3 "En revisión", 4 "Hecho" (final).
 *
 * @author Alfonso Mendoza Vasquez
 */

import { describe, test, expect } from '@jest/globals';
import {
  MODOS,
  RESULTADOS_CAMBIO,
  calcularTiemposFlujo,
  evaluarCambioModo,
  promedio,
  mediana,
} from './flujo-continuo.calculo.js';

const COLUMNAS = [
  { id: 1, orden: 1, esFinal: false },
  { id: 2, orden: 2, esFinal: false },
  { id: 3, orden: 3, esFinal: false },
  { id: 4, orden: 4, esFinal: true },
];

/** Fin del periodo fijo para que las pruebas no dependan del día en que se ejecutan. */
const AHORA = '2026-11-16T12:00:00Z';

/** Fecha ISO a partir de un día de noviembre de 2026 y una hora (UTC). */
const nov = (dia, hora = 0) => `2026-11-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:00:00Z`;

/** Atajo para un cambio de columna. */
const mover = (tareaId, fecha, anteriorId, nuevaId) => ({ tareaId, fecha, anteriorId, nuevaId });

const calcular = (tareas, eventos, extra = {}) => calcularTiemposFlujo({ tareas, eventos, columnas: COLUMNAS, ahora: AHORA, ...extra });

describe('HU-26 · Lead Time y Cycle Time', () => {
  test('flujo ideal: creada el día 1, empieza el día 2 y termina el día 4 → Lead 72 h y Cycle 48 h', () => {
    const r = calcular(
      [{ id: 10, titulo: 'Login', creadoEn: nov(1), columnaActualId: 4 }],
      [mover(10, nov(2), 1, 2), mover(10, nov(3), 2, 3), mover(10, nov(4), 3, 4)],
    );
    expect(r.vacio).toBe(false);
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0]).toMatchObject({ tareaId: 10, leadHoras: 72, cycleHoras: 48, terminadaEn: '2026-11-04T00:00:00.000Z' });
    expect(r.lead).toEqual({ cantidad: 1, promedio: 72, mediana: 72 });
    expect(r.cycle).toEqual({ cantidad: 1, promedio: 48, mediana: 48 });
    expect(r.excluidas).toEqual({ sinHistorial: 0, duracionInvalida: 0, sinCycle: 0 });
  });

  test('tarjeta terminada sin historial de movimientos: se excluye con aviso, sin error', () => {
    const r = calcular([{ id: 11, creadoEn: nov(1), columnaActualId: 4 }], []);
    expect(r.vacio).toBe(true);
    expect(r.tarjetas).toEqual([]);
    expect(r.excluidas.sinHistorial).toBe(1);
    expect(r.lead).toEqual({ cantidad: 0, promedio: null, mediana: null });
  });

  test('tarjeta reabierta: cuenta la última llegada a "Hecho", no la primera', () => {
    const r = calcular(
      [{ id: 12, creadoEn: nov(1), columnaActualId: 4 }],
      [mover(12, nov(2), 1, 2), mover(12, nov(3), 2, 4), mover(12, nov(5), 4, 2), mover(12, nov(6), 2, 4)],
    );
    expect(r.tarjetas[0]).toMatchObject({ leadHoras: 120, cycleHoras: 96, terminadaEn: '2026-11-06T00:00:00.000Z' });
  });

  test('duraciones inválidas: llegada igual o anterior a la creación se excluye; Cycle no positivo queda vacío', () => {
    const r = calcular(
      [
        { id: 13, creadoEn: nov(5), columnaActualId: 4 }, // llegó "antes" de crearse
        { id: 14, creadoEn: nov(1), columnaActualId: 4 }, // sale de la primera columna justo al llegar a Hecho
      ],
      [mover(13, nov(4), 1, 4), mover(14, nov(3), 1, 4)],
    );
    expect(r.excluidas.duracionInvalida).toBe(1);
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0]).toMatchObject({ tareaId: 14, leadHoras: 48, cycleHoras: null });
    expect(r.excluidas.sinCycle).toBe(1);
    expect(r.cycle.cantidad).toBe(0);
  });

  test('lista vacía y tarjetas que no están terminadas: resultado vacío, sin errores', () => {
    expect(calcular([], []).vacio).toBe(true);
    const r = calcular([{ id: 15, creadoEn: nov(1), columnaActualId: 2 }], [mover(15, nov(2), 1, 2)]);
    expect(r.vacio).toBe(true);
    expect(r.excluidas).toEqual({ sinHistorial: 0, duracionInvalida: 0, sinCycle: 0 });
  });

  test('periodo: solo cuentan las tarjetas terminadas dentro de los últimos N días', () => {
    const tareas = [
      { id: 16, creadoEn: '2026-09-01T00:00:00Z', columnaActualId: 4 },
      { id: 17, creadoEn: nov(10), columnaActualId: 4 },
    ];
    const eventos = [mover(16, '2026-09-05T00:00:00Z', 1, 4), mover(17, nov(12), 1, 4)];
    expect(calcular(tareas, eventos, { dias: 30 }).tarjetas.map((t) => t.tareaId)).toEqual([17]);
    expect(calcular(tareas, eventos, { dias: 90 }).tarjetas.map((t) => t.tareaId)).toEqual([17, 16]);
  });

  test('modo continuo: un evento con anterior = null cuenta como salida de la primera columna', () => {
    const tareas = [{ id: 18, creadoEn: nov(1), columnaActualId: 4 }];
    // La tarjeta volvió al backlog (sin columna) y se retomó el día 3 directo a "En progreso"
    const eventos = [mover(18, nov(3), null, 2), mover(18, nov(5), 2, 4)];
    expect(calcular(tareas, eventos, { modo: MODOS.CONTINUO }).tarjetas[0].cycleHoras).toBe(48);
    // En Scrum esa misma salida no cuenta como inicio del trabajo
    expect(calcular(tareas, eventos, { modo: MODOS.SCRUM }).tarjetas[0].cycleHoras).toBeNull();
    // Si el evento la deja en la primera columna no es una salida: la salida real es 1 → 2 el día 3
    const aPrimera = [mover(18, nov(2), null, 1), mover(18, nov(3), 1, 2), mover(18, nov(5), 2, 4)];
    expect(calcular(tareas, aPrimera, { modo: MODOS.CONTINUO }).tarjetas[0].cycleHoras).toBe(48);
  });

  test('promedio y mediana con cantidad par e impar, y lista vacía', () => {
    expect(promedio([10, 20, 60])).toBe(30);
    expect(mediana([60, 10, 20])).toBe(20);
    expect(mediana([10, 20, 30, 40])).toBe(25);
    expect(promedio([])).toBeNull();
    expect(mediana([])).toBeNull();
  });
});

describe('HU-26 · Regla de cambio de modo', () => {
  test('pasar a continuo con un sprint activo está bloqueado, aunque se confirme', () => {
    const r = evaluarCambioModo({ modoActual: 'scrum', destino: 'continuo', sprintActivo: true, confirmar: true });
    expect(r.resultado).toBe(RESULTADOS_CAMBIO.BLOQUEADO);
    expect(r.motivo).toBe('sprint_activo');
    expect(r.mensaje).toMatch(/Cierra el sprint/);
  });

  test('sin confirmación explícita (o con un valor que no es exactamente true) se pide confirmar', () => {
    for (const confirmar of [undefined, false, 'true', 1]) {
      const r = evaluarCambioModo({ modoActual: 'scrum', destino: 'continuo', sprintActivo: false, confirmar });
      expect(r.resultado).toBe(RESULTADOS_CAMBIO.REQUIERE_CONFIRMACION);
    }
    expect(evaluarCambioModo({ modoActual: 'scrum', destino: 'continuo', confirmar: true }).resultado)
      .toBe(RESULTADOS_CAMBIO.PERMITIDO);
  });

  test('mismo modo: no hay cambio; volver a Scrum no se bloquea por sprint activo; destino desconocido es inválido', () => {
    expect(evaluarCambioModo({ modoActual: 'continuo', destino: 'continuo', confirmar: true }).resultado)
      .toBe(RESULTADOS_CAMBIO.SIN_CAMBIO);
    expect(evaluarCambioModo({ modoActual: 'continuo', destino: 'scrum', sprintActivo: true, confirmar: true }).resultado)
      .toBe(RESULTADOS_CAMBIO.PERMITIDO);
    expect(evaluarCambioModo({ modoActual: 'scrum', destino: 'kanban', confirmar: true }).resultado)
      .toBe(RESULTADOS_CAMBIO.INVALIDO);
  });
});
