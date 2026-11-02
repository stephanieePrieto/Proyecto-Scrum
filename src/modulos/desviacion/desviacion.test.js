/**
 * Probar el cálculo de la desviación de horas (HU-28). Ejecutar con: node --test src/modulos/desviacion/desviacion.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UMBRAL_OK,
  UMBRAL_ALERTA,
  ESTADOS,
  aCentesimas,
  calcularDesviacion,
  agregarDesviacion,
  ordenarPorDesviacion,
} from './desviacion.calculo.js';

/** Comprueba que ningún valor del resultado sea NaN, Infinity o undefined. */
function sinValoresInvalidos(resultado) {
  for (const [clave, valor] of Object.entries(resultado)) {
    assert.notEqual(valor, undefined, `${clave} es undefined`);
    if (typeof valor === 'number') assert.ok(Number.isFinite(valor), `${clave} no es finito: ${valor}`);
  }
}

test('los umbrales del semáforo son 10 y 25', () => {
  assert.equal(UMBRAL_OK, 10);
  assert.equal(UMBRAL_ALERTA, 25);
});

test('caso 1: 8 h estimadas y 9,5 h reales → +1,5 h · +18,75 % en ámbar', () => {
  const r = calcularDesviacion(8, 9.5);
  assert.deepEqual(r, {
    horasEstimadas: 8,
    horasReales: 9.5,
    desviacionHoras: 1.5,
    desviacionPorcentaje: 18.75,
    estado: ESTADOS.ALERTA,
  });
});

test('caso 2: 10 % exacto es verde', () => {
  const r = calcularDesviacion(10, 11);
  assert.equal(r.desviacionHoras, 1);
  assert.equal(r.desviacionPorcentaje, 10);
  assert.equal(r.estado, ESTADOS.OK);
});

test('caso 3: 25 % exacto es ámbar', () => {
  const r = calcularDesviacion(10, 12.5);
  assert.equal(r.desviacionPorcentaje, 25);
  assert.equal(r.estado, ESTADOS.ALERTA);
});

test('caso 4: arriba de 25 % es rojo', () => {
  const r = calcularDesviacion(10, 12.6);
  assert.equal(r.desviacionPorcentaje, 26);
  assert.equal(r.estado, ESTADOS.CRITICO);
});

test('justo arriba de 10 % ya es ámbar', () => {
  assert.equal(calcularDesviacion(100, 110.01).estado, ESTADOS.ALERTA);
  assert.equal(calcularDesviacion(100, 110).estado, ESTADOS.OK);
});

test('sin desviación (reales = estimadas) es verde con 0 h y 0 %', () => {
  const r = calcularDesviacion(4, 4);
  assert.equal(r.desviacionHoras, 0);
  assert.equal(r.desviacionPorcentaje, 0);
  assert.equal(r.estado, ESTADOS.OK);
});

test('caso 5: reales menores a estimadas es ahorro con valores negativos', () => {
  const r = calcularDesviacion(8, 6);
  assert.equal(r.desviacionHoras, -2);
  assert.equal(r.desviacionPorcentaje, -25);
  assert.equal(r.estado, ESTADOS.AHORRO);
});

test('un ahorro grande sigue siendo ahorro, nunca rojo', () => {
  assert.equal(calcularDesviacion(10, 1).estado, ESTADOS.AHORRO);
});

test('caso 6: estimadas 0 → N/A sin dividir entre cero, pero conserva las horas de diferencia', () => {
  const r = calcularDesviacion(0, 3);
  assert.equal(r.desviacionPorcentaje, null);
  assert.equal(r.desviacionHoras, 3);
  assert.equal(r.estado, ESTADOS.NA);
  sinValoresInvalidos(r);
});

test('caso 7: sin horas reales → "Sin registro"', () => {
  for (const real of [0, null, undefined, '']) {
    const r = calcularDesviacion(5, real);
    assert.equal(r.estado, ESTADOS.SIN_REGISTRO);
    assert.equal(r.desviacionHoras, null);
    assert.equal(r.desviacionPorcentaje, null);
    sinValoresInvalidos(r);
  }
});

test('caso 8: estimadas 0 y reales 0 → "Sin registro" gana sobre N/A', () => {
  assert.equal(calcularDesviacion(0, 0).estado, ESTADOS.SIN_REGISTRO);
});

test('caso 9: estimado null o vacío se trata como 0 → N/A', () => {
  assert.equal(calcularDesviacion(null, 2).estado, ESTADOS.NA);
  assert.equal(calcularDesviacion('', 2).estado, ESTADOS.NA);
  assert.equal(calcularDesviacion(undefined, 2).estado, ESTADOS.NA);
});

test('acepta los NUMERIC que PostgreSQL devuelve como texto', () => {
  const r = calcularDesviacion('8.0', '9.5');
  assert.equal(r.desviacionPorcentaje, 18.75);
  assert.equal(r.estado, ESTADOS.ALERTA);
});

test('valores no numéricos o negativos cuentan como 0', () => {
  assert.equal(aCentesimas('abc'), 0);
  assert.equal(aCentesimas(-3), 0);
  assert.equal(aCentesimas(Infinity), 0);
  assert.equal(calcularDesviacion('abc', 'xyz').estado, ESTADOS.SIN_REGISTRO);
});

test('caso 16: sin artefactos de coma flotante (0,1 + 0,2)', () => {
  const r = agregarDesviacion([
    { horasEstimadas: 0.1, horasReales: 0.1 },
    { horasEstimadas: 0.2, horasReales: 0.2 },
  ]);
  assert.equal(r.horasEstimadas, 0.3);
  assert.equal(r.horasReales, 0.3);
  assert.equal(r.desviacionHoras, 0);

  const s = calcularDesviacion(0.3, 0.1 + 0.2);
  assert.equal(s.desviacionHoras, 0);
  assert.equal(s.estado, ESTADOS.OK);
});

test('el porcentaje se redondea a 2 decimales', () => {
  // 1/3 = 33,333… % → 33,33 %
  assert.equal(calcularDesviacion(3, 4).desviacionPorcentaje, 33.33);
  // −1/3 → −33,33 % (simétrico al sobrecosto)
  assert.equal(calcularDesviacion(3, 2).desviacionPorcentaje, -33.33);
  // 2/3 = 66,666… % → 66,67 %
  assert.equal(calcularDesviacion(3, 5).desviacionPorcentaje, 66.67);
});

test('agregar: solo cuenta las tareas con registro e informa las excluidas', () => {
  const r = agregarDesviacion([
    { horasEstimadas: 8, horasReales: 9.5 },
    { horasEstimadas: 2, horasReales: 0 },    // sin registro: no se suma (evita un ahorro falso)
    { horasEstimadas: null, horasReales: null },
  ]);
  assert.equal(r.horasEstimadas, 8);
  assert.equal(r.horasReales, 9.5);
  assert.equal(r.desviacionPorcentaje, 18.75);
  assert.equal(r.estado, ESTADOS.ALERTA);
  assert.equal(r.totalTareas, 3);
  assert.equal(r.tareasConsideradas, 1);
  assert.equal(r.tareasSinRegistro, 2);
});

test('agregar: ninguna tarea con registro → "Sin registro"', () => {
  const r = agregarDesviacion([{ horasEstimadas: 5, horasReales: 0 }]);
  assert.equal(r.estado, ESTADOS.SIN_REGISTRO);
  assert.equal(r.horasEstimadas, 0);
  assert.equal(r.tareasSinRegistro, 1);
  sinValoresInvalidos(r);
});

test('casos 10 y 11: grupo sin tareas no falla y queda "Sin registro" con 0 tareas', () => {
  for (const r of [agregarDesviacion([]), agregarDesviacion()]) {
    assert.equal(r.estado, ESTADOS.SIN_REGISTRO);
    assert.equal(r.totalTareas, 0);
    assert.equal(r.tareasConsideradas, 0);
    assert.equal(r.tareasSinRegistro, 0);
    sinValoresInvalidos(r);
  }
});

test('agregar: tareas con registro pero sin estimado dan N/A en el total', () => {
  const r = agregarDesviacion([{ horasEstimadas: null, horasReales: 2 }, { horasEstimadas: null, horasReales: 1.5 }]);
  assert.equal(r.estado, ESTADOS.NA);
  assert.equal(r.desviacionHoras, 3.5);
  assert.equal(r.desviacionPorcentaje, null);
});

test('agregar: compensa sobrecostos con ahorros entre tareas trabajadas', () => {
  const r = agregarDesviacion([
    { horasEstimadas: 10, horasReales: 14 }, // +4
    { horasEstimadas: 10, horasReales: 7 },  // −3
  ]);
  assert.equal(r.desviacionHoras, 1);
  assert.equal(r.desviacionPorcentaje, 5);
  assert.equal(r.estado, ESTADOS.OK);
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
  assert.deepEqual(orden, ['critico', 'alerta', 'ok', 'ahorro', 'na', 'sin']);
  assert.equal(elementos[0].nombre, 'sin', 'no debe modificar el arreglo original');
});

test('ordenar: empates por nombre', () => {
  const orden = ordenarPorDesviacion([
    { nombre: 'Beto', ...calcularDesviacion(5, 0) },
    { nombre: 'Ana', ...calcularDesviacion(5, 0) },
  ]).map((e) => e.nombre);
  assert.deepEqual(orden, ['Ana', 'Beto']);
});
