/**
 * Probar las reglas de capacidad. Ejecutar con: node --test src/modulos/capacidad/capacidad.test.js
 */
process.env.MODO_DEMO = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validarCapacidad,
  fusionarAusencias,
  capacidadUsuario,
  capacidadEquipo,
} = require('./capacidad.calculo');
const demo = require('./capacidad.demo');
const { ErrorCapacidad, obtenerCapacidad, guardarCapacidad, obtenerCapacidadEquipo } = require('./capacidad.service');

// Sprint de 2 semanas: lunes 2026-10-12 a viernes 2026-10-23 (10 días laborables)
const sprint = { inicio: '2026-10-12', fin: '2026-10-23' };

test('rechaza horas negativas, mayores a 24 o no numéricas', () => {
  assert.equal(validarCapacidad({ horasPorDia: -1 })[0].campo, 'horasPorDia');
  assert.equal(validarCapacidad({ horasPorDia: 24.5 })[0].campo, 'horasPorDia');
  assert.equal(validarCapacidad({ horasPorDia: 'abc' })[0].campo, 'horasPorDia');
  assert.deepEqual(validarCapacidad({ horasPorDia: 6 }), []);
  assert.deepEqual(validarCapacidad({ horasPorDia: 24 }), []);
});

test('rechaza ausencias con fin anterior al inicio o con fecha inexistente', () => {
  const a = validarCapacidad({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-10-18', fechaFin: '2026-10-14' }] });
  assert.equal(a[0].campo, 'ausencias[0].fechaFin');
  const b = validarCapacidad({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-02-30', fechaFin: '2026-03-01' }] });
  assert.equal(b[0].campo, 'ausencias[0].fechaInicio');
});

test('sin ausencias: días laborables por horas por día', () => {
  assert.deepEqual(capacidadUsuario({ horasPorDia: 6 }, sprint), { horas: 60, diasHabiles: 10, diasAusente: 0 });
});

test('una ausencia dentro del sprint descuenta solo días laborables', () => {
  // Del miércoles 14 al domingo 18: cuentan 14, 15 y 16 (el 17 y el 18 son fin de semana)
  const r = capacidadUsuario({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-10-14', fechaFin: '2026-10-18' }] }, sprint);
  assert.deepEqual(r, { horas: 42, diasHabiles: 7, diasAusente: 3 });
});

test('una ausencia fuera del sprint no se toma en cuenta', () => {
  const r = capacidadUsuario({ horasPorDia: 6, ausencias: [{ fechaInicio: '2026-11-02', fechaFin: '2026-11-06' }] }, sprint);
  assert.equal(r.horas, 60);
});

test('una ausencia que cruza el borde del sprint solo cuenta la parte interna', () => {
  const r = capacidadUsuario({ horasPorDia: 5, ausencias: [{ fechaInicio: '2026-10-20', fechaFin: '2026-11-10' }] }, sprint);
  assert.deepEqual(r, { horas: 30, diasHabiles: 6, diasAusente: 4 });
});

test('un sprint con fechas inválidas lanza error', () => {
  assert.throws(() => capacidadUsuario({ horasPorDia: 6 }, { inicio: 'x', fin: 'y' }), RangeError);
});

test('fusiona las ausencias traslapadas y reporta cuántas', () => {
  const r = fusionarAusencias([
    { fechaInicio: '2026-10-25', fechaFin: '2026-10-31' },
    { fechaInicio: '2026-10-14', fechaFin: '2026-10-18' },
    { fechaInicio: '2026-10-16', fechaFin: '2026-10-20' },
  ]);
  assert.equal(r.fusionadas, 1);
  assert.deepEqual(r.ausencias.map((a) => [a.fechaInicio, a.fechaFin]), [
    ['2026-10-14', '2026-10-20'],
    ['2026-10-25', '2026-10-31'],
  ]);
});

test('no fusiona ausencias contiguas sin días en común', () => {
  const r = fusionarAusencias([
    { fechaInicio: '2026-10-14', fechaFin: '2026-10-15' },
    { fechaInicio: '2026-10-16', fechaFin: '2026-10-17' },
  ]);
  assert.equal(r.fusionadas, 0);
  assert.equal(r.ausencias.length, 2);
});

test('el equipo suma las capacidades individuales', () => {
  const t = capacidadEquipo([{ usuarioId: 1, horasPorDia: 6 }, { usuarioId: 2, horasPorDia: 4 }], sprint);
  assert.equal(t.totalHoras, 100);
  assert.equal(t.sinCapacidad, false);
});

test('un equipo con 0 horas se marca sin capacidad', () => {
  const t = capacidadEquipo([{ usuarioId: 1, horasPorDia: 0 }, { usuarioId: 2, horasPorDia: null }], sprint);
  assert.equal(t.totalHoras, 0);
  assert.equal(t.sinCapacidad, true);
  assert.equal(t.miembros[1].configurado, false);
});

test('servicio: guarda, fusiona y avisa', async () => {
  demo.reiniciar();
  const r = await guardarCapacidad({ id: 1, rol: 'DEV' }, 1, {
    horasPorDia: 6,
    notas: ' QA ',
    ausencias: [
      { fechaInicio: '2026-10-14', fechaFin: '2026-10-18' },
      { fechaInicio: '2026-10-16', fechaFin: '2026-10-20' },
    ],
  });
  assert.equal(r.fusionadas, 1);
  assert.match(r.mensaje, /Fusionamos 1 ausencia/);
  assert.equal(r.ausencias.length, 1);
  assert.equal(r.notas, 'QA');
});

test('servicio: no guarda datos inválidos', async () => {
  demo.reiniciar();
  await assert.rejects(
    () => guardarCapacidad({ id: 1, rol: 'DEV' }, 1, { horasPorDia: 30 }),
    (e) => e instanceof ErrorCapacidad && e.estado === 400 && e.errores[0].campo === 'horasPorDia',
  );
  assert.equal((await obtenerCapacidad(1)).horasPorDia, 6); // Conserva lo anterior
});

test('servicio: solo la propia persona o un Admin pueden editar', async () => {
  demo.reiniciar();
  await assert.rejects(() => guardarCapacidad({ id: 2, rol: 'DEV' }, 1, { horasPorDia: 6 }), (e) => e.estado === 403);
  await guardarCapacidad({ id: 9, rol: 'Admin' }, 1, { horasPorDia: 5 });
  assert.equal((await obtenerCapacidad(1)).horasPorDia, 5);
});

test('servicio: la capacidad del equipo se recalcula tras guardar', async () => {
  demo.reiniciar();
  const antes = await obtenerCapacidadEquipo(1, sprint);
  await guardarCapacidad({ id: 3, rol: 'DEV' }, 3, { horasPorDia: 5, ausencias: [] }); // Ana se configura
  const despues = await obtenerCapacidadEquipo(1, sprint);
  assert.equal(despues.totalHoras - antes.totalHoras, 50);
});

test('servicio: rechaza un rango de fechas inválido', async () => {
  await assert.rejects(() => obtenerCapacidadEquipo(1, { inicio: '2026-10-23', fin: '2026-10-12' }), (e) => e.estado === 400);
});
