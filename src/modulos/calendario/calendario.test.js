/**
 * @file calendario.test.js
 * @description Suite de pruebas unitarias para el calendario de eventos Scrum y las reuniones, estas últimas
 * también contra el servicio con la base de datos simulada.
 * Compatible con Jest y ES Modules.
 * 
 * @author Diego Rafael Jiménez Trujano
 * @author Stephanie Elizdeth Hernández Prieto
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  diasHabiles, generarEventos, coinciden, conflictosPorAusencia, validarReunion, TIPOS_REUNION, MAX_TITULO_REUNION,
} from './calendario.reglas.js';

/** Lo que "hay" en la base simulada para las pruebas del servicio; cada prueba lo ajusta. */
let mundo = {};
const consultas = [];
const respuesta = (sql) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('SELECT zona_horaria FROM usuarios')) return { rows: [{ zona_horaria: 'America/Mexico_City' }] };
  if (sql.includes('FROM miembros_proyecto mp')) return { rows: [{ id: 3, nombre: 'Ana', rol: 'developer' }, { id: 4, nombre: 'Luis', rol: 'product_owner' }] };
  if (sql.includes("SELECT proyecto_id FROM eventos_calendario")) return { rows: mundo.reunion ? [{ proyecto_id: 1 }] : [] };
  if (sql.includes('INSERT INTO eventos_calendario')) return { rows: [{ id: 50 }] };
  if (sql.includes('UPDATE eventos_calendario')) return { rows: mundo.reunion ? [{ id: 50 }] : [] };
  if (sql.includes('DELETE FROM eventos_calendario WHERE id')) return { rows: mundo.reunion ? [{ id: 50, tipo: 'daily', titulo: 'D', inicia_en: new Date() }] : [] };
  if (sql.includes('INSERT INTO bitacora')) return { rows: [{ id: 1, creado_en: new Date() }] };
  if (sql.includes('FROM eventos_calendario e')) return { rows: mundo.reuniones ?? [{ id: 50, titulo: 'R', participantes: [] }] };
  return { rows: [] };
};
const cliente = { query: jest.fn(async (sql, params) => { consultas.push({ sql, params }); return respuesta(sql); }), release: jest.fn() };
const permisos = { exigirPermiso: jest.fn(), tienePermiso: jest.fn(), MENSAJE_NO_ENCONTRADO: 'No se encontró el recurso solicitado.' };

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
const servicio = await import('./calendario.service.js');
const sqlDe = (texto) => consultas.filter((c) => c.sql.includes(texto));
const fallo = async (promesa) => { try { await promesa; return null; } catch (error) { return error; } };
const SM = { id: 2 };
const REUNION = { titulo: 'Planning del sprint 5', tipo: 'planning', fecha: '2026-11-23', hora_inicio: '10:00', participantes: [3, 4], notas: 'Traer estimaciones' };

const tipos = (eventos) => eventos.map((e) => e.tipo);

describe('Módulo de Calendario - Pruebas Unitarias', () => {
  test('solo cuenta lunes a viernes', () => {
    expect(diasHabiles('2026-10-26', '2026-11-01')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(diasHabiles('2026-10-31', '2026-11-01')).toEqual([]);
  });

  test('un sprint de dos semanas tiene Planning, 8 Dailies, Review y Retro', () => {
    const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
    expect(eventos[0].tipo).toBe('planning');
    expect(eventos[0].fecha).toBe('2026-10-26');
    expect(tipos(eventos).filter((t) => t === 'daily').length).toBe(8);
    expect(tipos(eventos).slice(-2)).toEqual(['review', 'retro']);
    expect(eventos.at(-1).fecha).toBe('2026-11-06');
    expect(eventos.some((e) => e.tipo === 'daily' && (e.fecha === '2026-10-26' || e.fecha === '2026-11-06'))).toBe(false);
  });

  test('si el sprint termina en fin de semana, Review y Retro pasan al último día hábil', () => {
    const eventos = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-01' });
    expect(eventos.find((e) => e.tipo === 'review').fecha).toBe('2026-10-30');
  });

  test('un sprint sin días hábiles no genera eventos', () => {
    expect(generarEventos({ fechaInicio: '2026-10-31', fechaFin: '2026-11-01' })).toEqual([]);
  });

  test('detecta cuándo los eventos guardados ya coinciden con las fechas', () => {
    const esperados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-10-30' });
    expect(coinciden(esperados, esperados.map((e) => ({ ...e })))).toBe(true);
    const cambiados = generarEventos({ fechaInicio: '2026-10-26', fechaFin: '2026-11-06' });
    expect(coinciden(esperados, cambiados)).toBe(false);
    expect(coinciden(esperados, [])).toBe(false);
  });

  test('avisa los eventos que caen en la ausencia del Scrum Master o Product Owner', () => {
    const eventos = [{ id: 1, fecha: '2026-10-27' }, { id: 2, fecha: '2026-10-29' }];
    const ausencias = [{ usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-28' }];
    const conflictos = conflictosPorAusencia(eventos, ausencias);
    expect(conflictos.get(1)[0].nombre).toBe('Stephy');
    expect(conflictos.has(2)).toBe(false);
  });

  test('no repite a la misma persona si tiene dos ausencias el mismo día', () => {
    const ausencias = [
      { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-27', hasta: '2026-10-27' },
      { usuarioId: 7, nombre: 'Stephy', rol: 'scrum_master', desde: '2026-10-26', hasta: '2026-10-28' },
    ];
    expect(conflictosPorAusencia([{ id: 1, fecha: '2026-10-27' }], ausencias).get(1).length).toBe(1);
  });
});

describe('Reuniones Scrum - reglas', () => {
  test('título, tipo y fecha son obligatorios; sin título o sin fecha se rechaza con el campo marcado', () => {
    const { errores } = validarReunion({ tipo: 'daily' });
    expect(errores.titulo).toBeDefined();
    expect(errores.fecha).toBeDefined();
    expect(validarReunion({ titulo: 'x', fecha: '2026-11-23' }).errores.tipo).toBeDefined();
    expect(validarReunion({ titulo: 'x'.repeat(MAX_TITULO_REUNION + 1), tipo: 'daily', fecha: '2026-11-23' }).errores.titulo).toBeDefined();
    expect(validarReunion({ titulo: 'x', tipo: 'daily', fecha: '2026-02-30' }).errores.fecha).toBeDefined();
  });

  test('acepta los cuatro tipos', () => {
    expect(TIPOS_REUNION).toEqual(['planning', 'daily', 'review', 'retro']);
    for (const tipo of TIPOS_REUNION) expect(validarReunion({ titulo: 'x', tipo, fecha: '2026-11-23' }).errores).toEqual({});
  });

  test('sin horas usa el horario habitual del tipo y, con inicio, la duración habitual', () => {
    expect(validarReunion({ titulo: 'x', tipo: 'daily', fecha: '2026-11-23' }).valores).toMatchObject({ horaInicio: '09:30', horaFin: '09:45' });
    expect(validarReunion({ titulo: 'x', tipo: 'planning', fecha: '2026-11-23', hora_inicio: '12:00' }).valores.horaFin).toBe('14:00');
  });

  test('la hora de fin debe ser posterior a la de inicio y con formato HH:MM', () => {
    expect(validarReunion({ titulo: 'x', tipo: 'review', fecha: '2026-11-23', hora_inicio: '15:00', hora_fin: '14:00' }).errores.hora_fin).toBeDefined();
    expect(validarReunion({ titulo: 'x', tipo: 'review', fecha: '2026-11-23', hora_inicio: '25:00' }).errores.hora_inicio).toBeDefined();
  });

  test('limpia participantes repetidos y rechaza identificadores inválidos', () => {
    expect(validarReunion({ ...REUNION, participantes: [3, '3', 4] }).valores.participantes).toEqual([3, 4]);
    expect(validarReunion({ ...REUNION, participantes: ['a'] }).errores.participantes).toBeDefined();
    expect(validarReunion({ ...REUNION, participantes: 'x' }).errores.participantes).toBeDefined();
  });
});

describe('Reuniones Scrum - servicio', () => {
  beforeEach(() => {
    consultas.length = 0;
    jest.clearAllMocks();
    mundo = { reunion: true };
    permisos.exigirPermiso.mockResolvedValue('scrum_master');
    permisos.tienePermiso.mockResolvedValue(true);
  });

  test('el Scrum Master crea una reunión con sus participantes y queda en la bitácora', async () => {
    const reunion = await servicio.crearReunion(SM, 1, REUNION);
    expect(reunion).toMatchObject({ id: 50 });
    const insercion = sqlDe('INSERT INTO eventos_calendario')[0];
    expect(insercion.sql).toContain("'reunion'");
    expect(insercion.params.slice(0, 4)).toEqual([1, 'planning', 'Planning del sprint 5', 'Traer estimaciones']);
    expect(sqlDe('INSERT INTO eventos_participantes')[0].params).toEqual([50, [3, 4]]);
    expect(sqlDe('INSERT INTO bitacora')[0].params[2]).toBe('reunion_creada');
    expect(permisos.exigirPermiso.mock.calls[0][1]).toBe('reunion.gestionar');
  });

  test('sin título o sin fecha se rechaza (400 con los campos) y no se guarda nada', async () => {
    const error = await fallo(servicio.crearReunion(SM, 1, { tipo: 'daily' }));
    expect(error.statusCode).toBe(400);
    expect(Object.keys(error.detalles)).toEqual(expect.arrayContaining(['titulo', 'fecha']));
    expect(sqlDe('INSERT INTO eventos_calendario')).toHaveLength(0);
  });

  test('un participante que no es del proyecto se rechaza', async () => {
    const error = await fallo(servicio.crearReunion(SM, 1, { ...REUNION, participantes: [99] }));
    expect(error.detalles.participantes).toBeDefined();
  });

  test('el PO y los DEV no pueden crear, editar ni eliminar: el servidor responde 403', async () => {
    permisos.exigirPermiso.mockRejectedValue(new ErrorApp('Tu rol no permite esta acción.', 403));
    expect((await fallo(servicio.crearReunion({ id: 4 }, 1, REUNION))).statusCode).toBe(403);
    expect((await fallo(servicio.actualizarReunion({ id: 4 }, 50, REUNION))).statusCode).toBe(403);
    expect((await fallo(servicio.eliminarReunion({ id: 4 }, 50))).statusCode).toBe(403);
    expect(consultas.some((c) => /INSERT INTO eventos_calendario|UPDATE eventos_calendario|DELETE FROM eventos_calendario/.test(c.sql))).toBe(false);
  });

  test('el PO y los DEV sí pueden ver el listado (solo lectura)', async () => {
    permisos.tienePermiso.mockResolvedValue(false);
    const r = await servicio.listarReuniones({ id: 3 }, 1);
    expect(r).toMatchObject({ puedeGestionar: false, zona: 'America/Mexico_City' });
    expect(r.reuniones).toHaveLength(1);
    expect(permisos.exigirPermiso.mock.calls[0][1]).toBe('proyecto.ver');
  });

  test('editar reemplaza los datos y los participantes', async () => {
    await servicio.actualizarReunion(SM, 50, { ...REUNION, titulo: 'Planning reprogramada', participantes: [3] });
    expect(sqlDe('UPDATE eventos_calendario')[0].params.slice(0, 3)).toEqual([50, 'planning', 'Planning reprogramada']);
    expect(sqlDe('DELETE FROM eventos_participantes')).toHaveLength(1);
    expect(sqlDe('INSERT INTO eventos_participantes')[0].params).toEqual([50, [3]]);
    expect(sqlDe('INSERT INTO bitacora')[0].params[2]).toBe('reunion_modificada');
  });

  test('eliminar borra la reunión; si ya no existe responde 404', async () => {
    expect(await servicio.eliminarReunion(SM, 50)).toEqual({ eliminada: true, id: 50 });
    expect(sqlDe('INSERT INTO bitacora')[0].params[2]).toBe('reunion_eliminada');
    mundo.reunion = false;
    expect((await fallo(servicio.eliminarReunion(SM, 50))).statusCode).toBe(404);
  });

  test('regenerar el calendario del sprint solo borra los eventos generados, nunca las reuniones', async () => {
    await servicio.sincronizarEventos(1, { id: 7, nombre: 'Sprint 7', fechaInicio: '2026-11-23', fechaFin: '2026-11-27' });
    const borrado = sqlDe('DELETE FROM eventos_calendario WHERE sprint_id')[0];
    expect(borrado.sql).toContain("origen = 'generado'");
    expect(sqlDe('FROM eventos_calendario WHERE sprint_id = $1').every((c) => c.sql.includes("origen = 'generado'"))).toBe(true);
  });
});
