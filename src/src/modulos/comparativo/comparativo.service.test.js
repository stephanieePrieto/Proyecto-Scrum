/**
 * @file comparativo.service.test.js
 * @description Pruebas del servicio del comparativo entre equipos (HU-2) con la base de
 * datos simulada. Se simulan `consulta` (proyectos donde el usuario es Scrum Master) y
 * las métricas reutilizadas de metricas.service.js. Compatible con Jest y ES Modules.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/** Proyectos donde el usuario es Scrum Master, según la base simulada. */
let proyectosSm;
const consultas = [];

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: jest.fn(async (sql) => {
    consultas.push(sql);
    if (sql.includes('FROM miembros_proyecto mp')) return { rows: proyectosSm };
    throw new Error(`consulta no simulada: ${sql.slice(0, 90)}`);
  }),
  pool: {},
}));

const mockVelocity = jest.fn();
const mockKpis = jest.fn();

jest.unstable_mockModule('../metricas/metricas.service.js', () => ({
  obtenerVelocity: (...args) => mockVelocity(...args),
  obtenerKpisDashboard: (...args) => mockKpis(...args),
}));

const servicio = await import('./comparativo.service.js');

/** Ejecutar y devolver el error lanzado (o null). */
const fallo = async (promesa) => {
  try {
    await promesa;
    return null;
  } catch (error) {
    return error;
  }
};

beforeEach(() => {
  consultas.length = 0;
  jest.clearAllMocks();
  proyectosSm = [
    { proyectoId: 1, proyecto: 'Demo Alfa', equipoId: 10, equipo: 'Equipo Alfa' },
    { proyectoId: 2, proyecto: 'Demo Beta', equipoId: 20, equipo: 'Equipo Beta' },
  ];
  mockVelocity.mockImplementation(async (proyectoId) => ({
    sprints: proyectoId === 1
      ? [{ id: 1 }, { id: 2 }]
      : [{ id: 3 }],
    promedioActual: proyectoId === 1 ? 20 : 10,
  }));
  mockKpis.mockImplementation(async (proyectoId) => ({
    kpis: {
      avance: { valor: proyectoId === 1 ? 80 : 60 },
      desviacion: { valor: proyectoId === 1 ? 5 : -2, estimado: 100 },
    },
  }));
});

describe('exigirScrumMaster', () => {
  test('sin sesión responde 401', async () => {
    const error = await fallo(servicio.exigirScrumMaster(null));
    expect(error?.statusCode).toBe(401);
  });

  test('quien no es Scrum Master de ningún proyecto recibe 403', async () => {
    proyectosSm = [];
    const error = await fallo(servicio.exigirScrumMaster(7));
    expect(error?.statusCode).toBe(403);
    expect(error?.message).toMatch(/Scrum Master/);
  });

  test('el Scrum Master pasa y recibe sus proyectos', async () => {
    const proyectos = await servicio.exigirScrumMaster(7);
    expect(proyectos).toHaveLength(2);
  });
});

describe('obtenerComparativo', () => {
  test('compara dos equipos con velocity normalizada y diferencias contra el promedio', async () => {
    const r = await servicio.obtenerComparativo(7);
    expect(r.comparable).toBe(true);
    expect(r.proyectosConsultados).toBe(2);
    const alfa = r.equipos.find((e) => e.equipo === 'Equipo Alfa');
    const beta = r.equipos.find((e) => e.equipo === 'Equipo Beta');
    expect(alfa.velocityPct).toBe(100);
    expect(beta.velocityPct).toBe(50);
    expect(alfa.estado).toBe('ok');
    expect(r.referencia.velocity).toBe(15);
  });

  test('un equipo sin sprints cerrados queda como datos insuficientes y no entra al promedio', async () => {
    mockVelocity.mockImplementation(async (proyectoId) => (
      proyectoId === 1
        ? { sprints: [{ id: 1 }, { id: 2 }], promedioActual: 20 }
        : { sprints: [], promedioActual: null }
    ));
    const r = await servicio.obtenerComparativo(7);
    expect(r.comparable).toBe(false);
    const beta = r.equipos.find((e) => e.equipo === 'Equipo Beta');
    expect(beta.estado).toBe('datos_insuficientes');
    expect(beta.velocityPct).toBeNull();
    expect(r.referencia.velocity).toBe(20);
  });

  test('un equipo con varios proyectos aparece una sola vez, con el de id más alto', async () => {
    proyectosSm = [
      { proyectoId: 1, proyecto: 'Demo Alfa', equipoId: 10, equipo: 'Equipo Alfa' },
      { proyectoId: 9, proyecto: 'Demo Alfa 2', equipoId: 10, equipo: 'Equipo Alfa' },
      { proyectoId: 2, proyecto: 'Demo Beta', equipoId: 20, equipo: 'Equipo Beta' },
    ];
    const r = await servicio.obtenerComparativo(7);
    expect(r.equipos.filter((e) => e.equipo === 'Equipo Alfa')).toHaveLength(1);
    expect(r.equipos.find((e) => e.equipo === 'Equipo Alfa').proyectoId).toBe(9);
  });
});
