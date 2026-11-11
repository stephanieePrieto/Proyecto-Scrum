/**
 * @file desviacion.test.js
 * @description Suite de pruebas unitarias para el cálculo de desviación de estimaciones (HU-28).
 * Compatible con Jest y ES Modules.
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect } from '@jest/globals';
import {
  UMBRAL_OK,
  UMBRAL_ALERTA,
  ESTADOS,
  aCentesimas,
  calcularDesviacion,
  agregarDesviacion,
  ordenarPorDesviacion,
} from './desviacion.calculo.js';
import { DESVIACION_UMBRAL_OK, DESVIACION_UMBRAL_ALERTA, tonoDesviacion } from '../../../public/js/core/semaforo.js';

function sinValoresInvalidos(resultado) {
  for (const [clave, valor] of Object.entries(resultado)) {
    expect(valor).toBeDefined();
    if (typeof valor === 'number') expect(Number.isFinite(valor)).toBe(true);
  }
}

describe('Módulo de Desviación de Horas - Pruebas Unitarias', () => {
  test('los umbrales del semáforo son 10 y 25', () => {
    expect(UMBRAL_OK).toBe(10);
    expect(UMBRAL_ALERTA).toBe(25);
  });

  test('caso 1: 8 h estimadas y 9.5 h reales → +1.5 h · +18.75 % en ámbar', () => {
    const r = calcularDesviacion(8, 9.5);
    expect(r).toEqual({
      horasEstimadas: 8,
      horasReales: 9.5,
      desviacionHoras: 1.5,
      desviacionPorcentaje: 18.75,
      estado: ESTADOS.ALERTA,
    });
  });

  test('caso 2: 10 % exacto es verde', () => {
    const r = calcularDesviacion(10, 11);
    expect(r.desviacionHoras).toBe(1);
    expect(r.desviacionPorcentaje).toBe(10);
    expect(r.estado).toBe(ESTADOS.OK);
  });

  test('caso 3: 25 % exacto es ámbar', () => {
    const r = calcularDesviacion(10, 12.5);
    expect(r.desviacionPorcentaje).toBe(25);
    expect(r.estado).toBe(ESTADOS.ALERTA);
  });

  test('caso 4: arriba de 25 % es rojo', () => {
    const r = calcularDesviacion(10, 12.6);
    expect(r.desviacionPorcentaje).toBe(26);
    expect(r.estado).toBe(ESTADOS.CRITICO);
  });

  test('justo arriba de 10 % ya es ámbar', () => {
    expect(calcularDesviacion(100, 110.01).estado).toBe(ESTADOS.ALERTA);
    expect(calcularDesviacion(100, 110).estado).toBe(ESTADOS.OK);
  });

  test('sin desviación (reales = estimadas) es verde con 0 h y 0 %', () => {
    const r = calcularDesviacion(4, 4);
    expect(r.desviacionHoras).toBe(0);
    expect(r.desviacionPorcentaje).toBe(0);
    expect(r.estado).toBe(ESTADOS.OK);
  });

  test('caso 5: reales menores a estimadas es ahorro con valores negativos', () => {
    const r = calcularDesviacion(8, 6);
    expect(r.desviacionHoras).toBe(-2);
    expect(r.desviacionPorcentaje).toBe(-25);
    expect(r.estado).toBe(ESTADOS.AHORRO);
  });

  test('un ahorro grande sigue siendo ahorro, nunca rojo', () => {
    expect(calcularDesviacion(10, 1).estado).toBe(ESTADOS.AHORRO);
  });

  test('caso 6: estimadas 0 → N/A sin dividir entre cero, pero conserva las horas de diferencia', () => {
    const r = calcularDesviacion(0, 3);
    expect(r.desviacionPorcentaje).toBeNull();
    expect(r.desviacionHoras).toBe(3);
    expect(r.estado).toBe(ESTADOS.NA);
    sinValoresInvalidos(r);
  });

  test('caso 7: sin horas reales → "Sin registro"', () => {
    for (const real of [0, null, undefined, '']) {
      const r = calcularDesviacion(5, real);
      expect(r.estado).toBe(ESTADOS.SIN_REGISTRO);
      expect(r.desviacionHoras).toBeNull();
      expect(r.desviacionPorcentaje).toBeNull();
      sinValoresInvalidos(r);
    }
  });

  test('caso 8: estimadas 0 y reales 0 → "Sin registro" gana sobre N/A', () => {
    expect(calcularDesviacion(0, 0).estado).toBe(ESTADOS.SIN_REGISTRO);
  });

  test('caso 9: estimado null o vacío se trata como 0 → N/A', () => {
    expect(calcularDesviacion(null, 2).estado).toBe(ESTADOS.NA);
    expect(calcularDesviacion('', 2).estado).toBe(ESTADOS.NA);
    expect(calcularDesviacion(undefined, 2).estado).toBe(ESTADOS.NA);
  });

  test('acepta los NUMERIC que PostgreSQL devuelve como texto', () => {
    const r = calcularDesviacion('8.0', '9.5');
    expect(r.desviacionPorcentaje).toBe(18.75);
    expect(r.estado).toBe(ESTADOS.ALERTA);
  });

  test('valores no numéricos o negativos cuentan como 0', () => {
    expect(aCentesimas('abc')).toBe(0);
    expect(aCentesimas(-3)).toBe(0);
    expect(aCentesimas(Infinity)).toBe(0);
    expect(calcularDesviacion('abc', 'xyz').estado).toBe(ESTADOS.SIN_REGISTRO);
  });

  test('caso 16: sin artefactos de coma flotante (0,1 + 0,2)', () => {
    const r = agregarDesviacion([
      { horasEstimadas: 0.1, horasReales: 0.1 },
      { horasEstimadas: 0.2, horasReales: 0.2 },
    ]);
    expect(r.horasEstimadas).toBe(0.3);
    expect(r.horasReales).toBe(0.3);
    expect(r.desviacionHoras).toBe(0);

    const s = calcularDesviacion(0.3, 0.1 + 0.2);
    expect(s.desviacionHoras).toBe(0);
    expect(s.estado).toBe(ESTADOS.OK);
  });

  test('el porcentaje se redondea a 2 decimales', () => {
    expect(calcularDesviacion(3, 4).desviacionPorcentaje).toBe(33.33);
    expect(calcularDesviacion(3, 2).desviacionPorcentaje).toBe(-33.33);
    expect(calcularDesviacion(3, 5).desviacionPorcentaje).toBe(66.67);
  });

  test('agregar: solo cuenta las tareas con registro e informa las excluidas', () => {
    const r = agregarDesviacion([
      { horasEstimadas: 8, horasReales: 9.5 },
      { horasEstimadas: 2, horasReales: 0 },
      { horasEstimadas: null, horasReales: null },
    ]);
    expect(r.horasEstimadas).toBe(8);
    expect(r.horasReales).toBe(9.5);
    expect(r.desviacionPorcentaje).toBe(18.75);
    expect(r.estado).toBe(ESTADOS.ALERTA);
    expect(r.totalTareas).toBe(3);
    expect(r.tareasConsideradas).toBe(1);
    expect(r.tareasSinRegistro).toBe(2);
  });

  test('agregar: ninguna tarea con registro → "Sin registro"', () => {
    const r = agregarDesviacion([{ horasEstimadas: 5, horasReales: 0 }]);
    expect(r.estado).toBe(ESTADOS.SIN_REGISTRO);
    expect(r.horasEstimadas).toBe(0);
    expect(r.tareasSinRegistro).toBe(1);
    sinValoresInvalidos(r);
  });

  test('casos 10 y 11: grupo sin tareas no falla y queda "Sin registro" con 0 tareas', () => {
    for (const r of [agregarDesviacion([]), agregarDesviacion()]) {
      expect(r.estado).toBe(ESTADOS.SIN_REGISTRO);
      expect(r.totalTareas).toBe(0);
      expect(r.tareasConsideradas).toBe(0);
      expect(r.tareasSinRegistro).toBe(0);
      sinValoresInvalidos(r);
    }
  });

  test('agregar: tareas con registro pero sin estimado dan N/A en el total', () => {
    const r = agregarDesviacion([{ horasEstimadas: null, horasReales: 2 }, { horasEstimadas: null, horasReales: 1.5 }]);
    expect(r.estado).toBe(ESTADOS.NA);
    expect(r.desviacionHoras).toBe(3.5);
    expect(r.desviacionPorcentaje).toBeNull();
  });

  test('agregar: compensa sobrecostos con ahorros entre tareas trabajadas', () => {
    const r = agregarDesviacion([
      { horasEstimadas: 10, horasReales: 14 },
      { horasEstimadas: 10, horasReales: 7 },
    ]);
    expect(r.desviacionHoras).toBe(1);
    expect(r.desviacionPorcentaje).toBe(5);
    expect(r.estado).toBe(ESTADOS.OK);
  });

  test('ordenar: lo más preocupante primero, luego ahorros, N/A y "Sin registro"', () => {
    const elementos = [
      { nombre: 'sin', ...calcularDesviacion(5, 0) },
      { nombre: 'ahorro', ...calcularDesviacion(8, 6) },
      { nombre: 'na', ...calcularDesviacion(0, 3) },
      { nombre: 'critico', ...calcularDesviacion(10, 15) },
      { nombre: 'ok', ...calcularDesviacion(10, 10.5) },
      { nombre: 'alerta', ...calcularDesviacion(8, 9.5) },
    ];
    const orden = ordenarPorDesviacion(elementos).map((e) => e.nombre);
    expect(orden).toEqual(['critico', 'alerta', 'ok', 'ahorro', 'na', 'sin']);
    expect(elementos[0].nombre).toBe('sin');
  });

  test('ordenar: empates por nombre', () => {
    const orden = ordenarPorDesviacion([
      { nombre: 'Beto', ...calcularDesviacion(5, 0) },
      { nombre: 'Ana', ...calcularDesviacion(5, 0) },
    ]).map((e) => e.nombre);
    expect(orden).toEqual(['Ana', 'Beto']);
  });
});

describe('Semáforo del dashboard (public/js/core/semaforo.js) = regla del servidor', () => {
  // Cada estado del servidor y el tono con que lo pinta el dashboard
  const TONO_DE_ESTADO = {
    [ESTADOS.OK]: 'exito',
    [ESTADOS.ALERTA]: 'advertencia',
    [ESTADOS.CRITICO]: 'peligro',
    [ESTADOS.AHORRO]: 'info',
    [ESTADOS.NA]: 'neutro',
    [ESTADOS.SIN_REGISTRO]: 'neutro',
  };

  test('usa los mismos umbrales que el servidor', () => {
    expect(DESVIACION_UMBRAL_OK).toBe(UMBRAL_OK);
    expect(DESVIACION_UMBRAL_ALERTA).toBe(UMBRAL_ALERTA);
  });

  test('límites exactos: 10 % verde, 10.01 % ámbar, 25 % ámbar, 25.01 % rojo', () => {
    expect(tonoDesviacion(10, 100, 110)).toBe('exito');
    expect(tonoDesviacion(10.01, 100, 110.01)).toBe('advertencia');
    expect(tonoDesviacion(25, 100, 125)).toBe('advertencia');
    expect(tonoDesviacion(25.01, 100, 125.01)).toBe('peligro');
    expect(calcularDesviacion(100, 125.01).estado).toBe(ESTADOS.CRITICO);
  });

  test('0 estimadas → neutro sin dividir; sin reales → neutro aunque sea un "ahorro" del 100 %', () => {
    expect(tonoDesviacion(5, 0, 5)).toBe('neutro');
    expect(tonoDesviacion(0, 0, 0)).toBe('neutro');
    expect(tonoDesviacion(-8, 8, 0)).toBe('neutro');
    expect(tonoDesviacion(-8, 8)).toBe('neutro'); // sin el dato de reales se deduce: 8 + (−8) = 0
  });

  test('ahorro → info (nunca verde ni rojo)', () => {
    expect(tonoDesviacion(-1, 8, 7)).toBe('info');
  });

  test('coincide con calcularDesviacion en una cuadrícula de horas, límites incluidos', () => {
    const estimadas = [0, 0.5, 1, 3, 8, 10, 12.5, 40, 100];
    const factores = [0, 0.5, 0.9, 1, 1.05, 1.1, 1.1001, 1.15, 1.25, 1.2501, 1.3, 2];
    let comparados = 0;
    for (const est of estimadas) {
      const reales = [...factores.map((f) => est * f), 0.25, 5];
      for (const real of reales) {
        const esperado = TONO_DE_ESTADO[calcularDesviacion(est, real).estado];
        expect(tonoDesviacion(real - est, est, real)).toBe(esperado);
        comparados += 1;
      }
    }
    expect(comparados).toBeGreaterThan(100);
  });
});