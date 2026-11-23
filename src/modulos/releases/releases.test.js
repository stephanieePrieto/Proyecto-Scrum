/**
 * @file releases.test.js
 * @description Pruebas de los releases: reglas (validación, avance y mensajes) y servicio con la base de datos
 * simulada (un sprint en un solo release, eliminar un release conserva los sprints, no eliminar un sprint agrupado
 * y permisos del Product Owner). Compatible con Jest y ES Modules.
 *
 * @author Diego Rafael Jiménez Trujano
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  validarRelease, leerSprints, calcularProgreso, mensajeSprintEnOtroRelease, mensajeSprintAgrupado, MAX_NOMBRE,
} from './releases.reglas.js';

/** Lo que "hay" en la base simulada; cada prueba lo ajusta. */
let mundo;
const consultas = [];

const respuesta = (sql) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('FROM releases WHERE id = $1')) return { rows: mundo.release ? [mundo.release] : [] };
  if (sql.includes('FOR UPDATE OF s')) return { rows: mundo.sprint ? [mundo.sprint] : [] };
  if (sql.includes('INSERT INTO releases')) {
    if (mundo.nombreRepetido) throw Object.assign(new Error('duplicada'), { code: '23505' });
    return { rows: [{ id: 30, proyecto_id: 1, nombre: 'R1' }] };
  }
  if (sql.includes('SELECT id FROM sprints WHERE release_id')) return { rows: [{ id: 4 }, { id: 5 }] };
  if (sql.includes('UPDATE sprints SET release_id = NULL')) return { rows: mundo.quitado ? [{ id: 4, nombre: 'Sprint 4' }] : [] };
  if (sql.includes('FROM sprints s JOIN releases r')) return { rows: mundo.agrupado ? [mundo.agrupado] : [] };
  if (sql.includes('INSERT INTO bitacora')) return { rows: [{ id: 1, creado_en: new Date() }] };
  if (sql.includes('FROM releases r WHERE r.proyecto_id')) return { rows: mundo.releases ?? [] };
  if (sql.includes('FROM sprints s WHERE s.proyecto_id')) return { rows: mundo.sprints ?? [] };
  if (sql.includes('FROM historias h')) return { rows: mundo.historias ?? [] };
  return { rows: [] };
};

const cliente = {
  query: jest.fn(async (sql, params) => { consultas.push({ sql, params }); return respuesta(sql); }),
  release: jest.fn(),
};
const permisos = {
  exigirPermiso: jest.fn(),
  tienePermiso: jest.fn(),
  MENSAJE_NO_ENCONTRADO: 'No se encontró el recurso solicitado.',
};

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: jest.fn(async (sql, params) => { consultas.push({ sql, params }); return respuesta(sql); }),
  pool: { connect: async () => cliente, query: cliente.query },
}));
jest.unstable_mockModule('../../sockets/emisor.js', () => ({
  emitirAProyecto: jest.fn(),
  emitirAUsuario: jest.fn(),
  default: { emitirAProyecto: jest.fn(), emitirAUsuario: jest.fn() },
}));
jest.unstable_mockModule('../../utils/permisos.js', () => permisos);

const { ErrorApp } = await import('../../utils/ErrorApp.js');
const servicio = await import('./releases.service.js');

const PO = { id: 2 };
const sqlDe = (texto) => consultas.filter((c) => c.sql.includes(texto));
const fallo = async (promesa) => { try { await promesa; return null; } catch (error) { return error; } };

beforeEach(() => {
  consultas.length = 0;
  jest.clearAllMocks();
  mundo = {
    release: { id: 30, proyecto_id: 1, nombre: 'R1', descripcion: null, fecha_objetivo: null },
    sprint: { id: 4, nombre: 'Sprint 4', release_id: null, release_nombre: null },
  };
  permisos.exigirPermiso.mockResolvedValue('product_owner');
  permisos.tienePermiso.mockResolvedValue(true);
});

describe('Releases - reglas', () => {
  test('el nombre es obligatorio; descripción y fecha objetivo son opcionales', () => {
    expect(validarRelease({ nombre: '  ' }).errores.nombre).toBeDefined();
    expect(validarRelease({ nombre: 'x'.repeat(MAX_NOMBRE + 1) }).errores.nombre).toBeDefined();
    expect(validarRelease({ nombre: ' Versión 1.0 ' })).toEqual({
      errores: {}, valores: { nombre: 'Versión 1.0', descripcion: null, fecha_objetivo: null },
    });
    expect(validarRelease({ nombre: 'R', fecha_objetivo: '2026-02-30' }).errores.fecha_objetivo).toBeDefined();
    expect(validarRelease({ nombre: 'R', fecha_objetivo: '2026-12-15' }).valores.fecha_objetivo).toBe('2026-12-15');
  });

  test('lee la lista de sprints a asignar sin repetidos y rechaza valores inválidos', () => {
    expect(leerSprints(undefined)).toEqual({ error: null, ids: [] });
    expect(leerSprints([3, '3', 4]).ids).toEqual([3, 4]);
    expect(leerSprints(['a']).error).toBeDefined();
    expect(leerSprints('3').error).toBeDefined();
  });

  test('el avance son los puntos terminados entre los puntos de sus sprints', () => {
    expect(calcularProgreso([
      { estado: 'cerrado', puntos: 10, puntosTerminados: 8 },
      { estado: 'activo', puntos: 10, puntosTerminados: 2 },
    ])).toEqual({ puntos: 20, terminados: 10, porcentaje: 50, sprintsTotal: 2, sprintsCerrados: 1 });
  });

  test('sin puntos, el avance se mide por sprints cerrados; sin sprints es 0', () => {
    expect(calcularProgreso([{ estado: 'cerrado', puntos: 0 }, { estado: 'planificado', puntos: 0 }]).porcentaje).toBe(50);
    expect(calcularProgreso([]).porcentaje).toBe(0);
  });

  test('los mensajes explican el motivo', () => {
    expect(mensajeSprintEnOtroRelease('Sprint 2', 'R1')).toContain('ya pertenece al release «R1»');
    expect(mensajeSprintAgrupado('Sprint 2', 'R1')).toContain('porque pertenece al release «R1»');
  });
});

describe('Releases - asignar sprints', () => {
  test('asigna un sprint libre y lo registra en la bitácora', async () => {
    const r = await servicio.asignarSprint(PO, 30, { sprint_id: 4 });
    expect(r).toEqual({ release_id: 30, sprint_id: 4, cambio: true });
    expect(sqlDe('UPDATE sprints SET release_id = $2')[0].params).toEqual([4, 30]);
    expect(sqlDe('INSERT INTO bitacora')).toHaveLength(1);
  });

  test('un sprint que ya pertenece a otro release no se puede asignar (409 con la explicación)', async () => {
    mundo.sprint = { id: 4, nombre: 'Sprint 4', release_id: 31, release_nombre: 'R2' };
    const error = await fallo(servicio.asignarSprint(PO, 30, { sprint_id: 4 }));
    expect(error).toBeInstanceOf(ErrorApp);
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('«R2»');
    expect(error.detalles).toMatchObject({ codigo: 'SPRINT_EN_OTRO_RELEASE', release: 'R2' });
    expect(sqlDe('UPDATE sprints SET release_id = $2')).toHaveLength(0);
  });

  test('asignarlo al release que ya tiene no cambia nada', async () => {
    mundo.sprint = { id: 4, nombre: 'Sprint 4', release_id: 30, release_nombre: 'R1' };
    expect((await servicio.asignarSprint(PO, 30, { sprint_id: 4 })).cambio).toBe(false);
    expect(sqlDe('INSERT INTO bitacora')).toHaveLength(0);
  });

  test('un sprint de otro proyecto no existe para este release (404)', async () => {
    mundo.sprint = null;
    expect((await fallo(servicio.asignarSprint(PO, 30, { sprint_id: 4 }))).statusCode).toBe(404);
  });

  test('crear con un sprint que ya está en otro release se rechaza completo', async () => {
    mundo.sprint = { id: 4, nombre: 'Sprint 4', release_id: 31, release_nombre: 'R2' };
    const error = await fallo(servicio.crear(PO, 1, { nombre: 'R1', sprints: [4] }));
    expect(error.statusCode).toBe(409);
    expect(sqlDe('ROLLBACK')).toHaveLength(1);
  });

  test('quitar un sprint que no está en el release responde 404', async () => {
    mundo.quitado = false;
    expect((await fallo(servicio.quitarSprint(PO, 30, 4))).statusCode).toBe(404);
  });
});

describe('Releases - crear, eliminar y permisos', () => {
  test('crear exige nombre (400 con el campo) y no escribe nada', async () => {
    const error = await fallo(servicio.crear(PO, 1, { nombre: '' }));
    expect(error.statusCode).toBe(400);
    expect(error.detalles.nombre).toBeDefined();
    expect(sqlDe('INSERT INTO releases')).toHaveLength(0);
  });

  test('un nombre repetido en el proyecto responde 409', async () => {
    mundo.nombreRepetido = true;
    const error = await fallo(servicio.crear(PO, 1, { nombre: 'R1' }));
    expect(error.statusCode).toBe(409);
    expect(error.detalles.nombre).toBeDefined();
  });

  test('eliminar un release solo quita la agrupación: no borra ningún sprint', async () => {
    const r = await servicio.eliminar(PO, 30);
    expect(r).toEqual({ eliminado: true, id: 30, sprintsLiberados: [4, 5] });
    expect(sqlDe('DELETE FROM releases')).toHaveLength(1);
    expect(consultas.some((c) => /DELETE FROM sprints/.test(c.sql))).toBe(false);
    const detalle = JSON.parse(sqlDe('INSERT INTO bitacora')[0].params[5]);
    expect(detalle).toMatchObject({ sprints_conservados: [4, 5] });
  });

  test('quien no es Product Owner no puede crear, editar ni eliminar (se respeta el 403 del permiso)', async () => {
    permisos.exigirPermiso.mockRejectedValue(new ErrorApp('Tu rol no permite esta acción.', 403));
    expect((await fallo(servicio.crear({ id: 9 }, 1, { nombre: 'R' }))).statusCode).toBe(403);
    expect((await fallo(servicio.eliminar({ id: 9 }, 30))).statusCode).toBe(403);
    expect((await fallo(servicio.asignarSprint({ id: 9 }, 30, { sprint_id: 4 }))).statusCode).toBe(403);
    expect(sqlDe('DELETE FROM releases')).toHaveLength(0);
    expect(permisos.exigirPermiso.mock.calls.every(([, clave]) => clave === 'release.gestionar')).toBe(true);
  });

  test('un release que no existe responde 404', async () => {
    mundo.release = null;
    expect((await fallo(servicio.actualizar(PO, 99, { nombre: 'R' }))).statusCode).toBe(404);
  });
});

describe('Releases - eliminar un sprint agrupado y línea de tiempo', () => {
  test('validarEliminacionSprint rechaza un sprint que pertenece a un release y explica el motivo', async () => {
    mundo.agrupado = { nombre: 'Sprint 4', release_nombre: 'R1' };
    const error = await fallo(servicio.validarEliminacionSprint(4));
    expect(error.statusCode).toBe(409);
    expect(error.detalles).toMatchObject({ codigo: 'SPRINT_EN_RELEASE', release: 'R1' });
    mundo.agrupado = null;
    expect(await fallo(servicio.validarEliminacionSprint(4))).toBeNull();
  });

  test('la línea de tiempo agrupa los sprints por release, en orden, con su avance', async () => {
    mundo.releases = [
      { id: 31, nombre: 'R2', fecha_objetivo: null },
      { id: 30, nombre: 'R1', fecha_objetivo: null },
    ];
    mundo.sprints = [
      { id: 4, nombre: 'S4', estado: 'cerrado', release_id: 30, fecha_inicio: '2026-01-01', fecha_fin: '2026-01-14' },
      { id: 5, nombre: 'S5', estado: 'activo', release_id: 31, fecha_inicio: '2026-01-15', fecha_fin: '2026-01-28' },
      { id: 6, nombre: 'S6', estado: 'planificado', release_id: null, fecha_inicio: '2026-01-29', fecha_fin: '2026-02-11' },
    ];
    mundo.historias = [
      { sprint_id: 4, puntos: 5, estado: 'aceptada', decision: 'aceptada', dod_proyecto: 'P1', dod_cumplidos: 1 },
      { sprint_id: 5, puntos: 3, estado: 'hecho', dod_proyecto: 'P1' }, // en Hecho pero sin verificar en la Review
    ];
    const r = await servicio.listar(PO, 1);
    expect(r.releases.map((x) => x.nombre)).toEqual(['R1', 'R2']);
    expect(r.releases[0].progreso).toMatchObject({ puntos: 5, terminados: 5, porcentaje: 100 });
    expect(r.releases[1].progreso).toMatchObject({ puntos: 3, terminados: 0, porcentaje: 0 });
    expect(r.sinRelease.map((s) => s.id)).toEqual([6]);
    expect(r.puedeGestionar).toBe(true);
  });
});
