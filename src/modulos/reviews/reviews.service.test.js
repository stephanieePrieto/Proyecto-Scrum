/**
 * @file reviews.service.test.js
 * @description Pruebas del servicio de la Sprint Review (HU-12) con la base de datos simulada: permisos por rol,
 * "prevalece la primera decisión", criterios incompletos, delegación, auditoría y velocity.
 * Compatible con Jest y ES Modules.
 */
import { describe, test, expect, beforeEach, jest } from '@jest/globals';

/** Lo que "hay" en la base simulada; cada prueba lo ajusta. */
let mundo;
const consultas = [];

const respuestaPool = (sql) => {
  if (sql.includes('FROM sprints WHERE id = $1')) return { rows: mundo.sprint ? [mundo.sprint] : [] };
  if (sql.includes('FROM review_delegaciones') && sql.includes('delegado_id = $2')) return { rows: mundo.delegacion ? [mundo.delegacion] : [] };
  if (sql.includes('SELECT id, proyecto_id FROM review_delegaciones')) return { rows: mundo.delegacionFila ? [mundo.delegacionFila] : [] };
  if (sql.includes('SELECT DISTINCT q.id')) return { rows: [{ id: 7 }] };
  if (sql.includes("rol = 'product_owner'")) return { rows: [{ usuario_id: 3 }] };
  if (sql.includes('INSERT INTO notificaciones')) return { rows: [] };
  throw new Error(`consulta no simulada: ${sql.slice(0, 90)}`);
};

const respuestaCliente = (sql) => {
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('FROM historias WHERE id = $1')) return { rows: mundo.historia ? [mundo.historia] : [] };
  if (sql.includes('FROM reviews_historias r LEFT JOIN usuarios')) return { rows: mundo.previa ? [mundo.previa] : [] };
  if (sql.includes('FROM tareas t LEFT JOIN columnas_tablero')) return { rows: [mundo.conteo] };
  if (sql.includes('UPDATE sprints s')) return { rows: [{ velocity: 5 }] };
  if (sql.includes('SELECT COALESCE(SUM(h.puntos)')) return { rows: [{ velocity: 5 }] };
  if (sql.includes('INSERT INTO bitacora')) return { rows: [{ id: 1, creado_en: new Date() }] };
  if (sql.includes('FOR UPDATE OF d')) return { rows: [mundo.delegacionFila] };
  if (sql.includes('FROM review_delegaciones d JOIN usuarios u')) return { rows: mundo.delegacionActiva ? [{ nombre: 'Ana' }] : [] };
  if (sql.includes('INSERT INTO review_delegaciones')) return { rows: [{ id: 9, desde: new Date(), hasta: new Date(Date.now() + 86400000) }] };
  if (sql.includes('SELECT nombre FROM usuarios')) return { rows: [{ nombre: 'Luis' }] };
  return { rows: [] };
};

const cliente = {
  query: jest.fn(async (sql, params) => { consultas.push({ sql, params }); return respuestaCliente(sql); }),
  release: jest.fn(),
};
const permisos = {
  exigirPermiso: jest.fn(),
  tienePermiso: jest.fn(),
  obtenerRolProyecto: jest.fn(),
  MENSAJE_NO_ENCONTRADO: 'No se encontró el recurso solicitado.',
};

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: jest.fn(async (sql, params) => { consultas.push({ sql, params }); return respuestaPool(sql); }),
  pool: { connect: async () => cliente },
}));
jest.unstable_mockModule('../../sockets/emisor.js', () => ({
  emitirAProyecto: jest.fn(),
  emitirAUsuario: jest.fn(),
  default: { emitirAProyecto: jest.fn() },
}));
jest.unstable_mockModule('../../utils/permisos.js', () => permisos);
jest.unstable_mockModule('../daily/daily.service.js', () => ({
  relojDe: async () => ({ nombre: 'Diego', zona: 'America/Mexico_City', hoy: '2026-11-11', hora: '08:00' }),
}));

const { ErrorApp } = await import('../../utils/ErrorApp.js');
const servicio = await import('./reviews.service.js');

const PO = { id: 2 };
const sqlDe = (texto) => consultas.filter((c) => c.sql.includes(texto));
const accionesAuditadas = () => sqlDe('INSERT INTO bitacora').map((c) => c.params[2]);

/** Ejecutar y devolver el error lanzado (o null). */
const fallo = async (promesa) => { try { await promesa; return null; } catch (error) { return error; } };

beforeEach(() => {
  consultas.length = 0;
  jest.clearAllMocks();
  mundo = {
    sprint: { id: 5, proyecto_id: 1, estado: 'activo' },
    historia: { id: 12, numero_hu: 12, titulo: 'Sprint Review', puntos: 8, criterios: 'Dado que A\nDado que B\nDado que C\nDado que D', estado: 'en_sprint', sprint_id: 5, proyecto_id: 1 },
    conteo: { tareas: 3, hechas: 3 },
    previa: null,
    delegacion: null,
  };
  // Por omisión la persona es el Product Owner del proyecto
  permisos.exigirPermiso.mockResolvedValue('product_owner');
  permisos.tienePermiso.mockImplementation(async (_u, clave) => clave === 'review.decidir');
  permisos.obtenerRolProyecto.mockResolvedValue('developer');
});

describe('Review (HU-12) - quién puede decidir', () => {
  test('un integrante sin delegación no puede aceptar ni rechazar (403) y no se escribe nada', async () => {
    permisos.tienePermiso.mockResolvedValue(false);
    const error = await fallo(servicio.decidir({ id: 8 }, 5, 12, { decision: 'aceptada' }));
    expect(error).toBeInstanceOf(ErrorApp);
    expect(error.statusCode).toBe(403);
    expect(sqlDe('INSERT INTO reviews_historias')).toHaveLength(0);
  });

  test('un delegado con delegación vigente sí puede decidir y queda marcado como delegado', async () => {
    permisos.tienePermiso.mockResolvedValue(false);
    mundo.delegacion = { id: 4, hasta: new Date(Date.now() + 3600000) };
    await servicio.decidir({ id: 8 }, 5, 12, { decision: 'aceptada', criterios_cumplidos: 4 });
    const insercion = sqlDe('INSERT INTO reviews_historias')[0];
    expect(insercion.params[5]).toBe(true); // como_delegado
    const auditoria = JSON.parse(sqlDe('INSERT INTO bitacora')[0].params[5]);
    expect(auditoria).toMatchObject({ como_delegado: true, delegacion_id: 4 });
  });

  test('una delegación vigente no sirve si la persona ya no pertenece al proyecto', async () => {
    permisos.tienePermiso.mockResolvedValue(false);
    permisos.obtenerRolProyecto.mockResolvedValue(null);
    mundo.delegacion = { id: 4, hasta: new Date(Date.now() + 3600000) };
    expect((await fallo(servicio.decidir({ id: 8 }, 5, 12, { decision: 'aceptada' }))).statusCode).toBe(403);
  });

  test('un sprint que aún no empieza no tiene Review (409)', async () => {
    mundo.sprint.estado = 'planificado';
    expect((await fallo(servicio.decidir(PO, 5, 12, { decision: 'aceptada' }))).statusCode).toBe(409);
  });
});

describe('Review (HU-12) - aceptar y rechazar', () => {
  test('aceptar con todos los criterios marca la historia aceptada, audita y avisa a la sala', async () => {
    const resultado = await servicio.decidir(PO, 5, 12, { decision: 'aceptada', criterios_cumplidos: 4 });
    expect(resultado).toMatchObject({ decision: 'aceptada', historia_id: 12, velocity: 5, cambiada: false });
    expect(sqlDe("estado = 'aceptada'")).toHaveLength(1);
    expect(accionesAuditadas()).toEqual(['review_historia_aceptada']);
  });

  test('aceptar con criterios incompletos (3 de 4) advierte antes de confirmar (409) y no guarda nada', async () => {
    const error = await fallo(servicio.decidir(PO, 5, 12, { decision: 'aceptada', criterios_cumplidos: 3 }));
    expect(error.statusCode).toBe(409);
    expect(error.detalles).toMatchObject({ codigo: 'CRITERIOS_INCOMPLETOS', cumplidos: 3, total: 4 });
    expect(sqlDe('INSERT INTO reviews_historias')).toHaveLength(0);
  });

  test('confirmando, acepta aunque falten criterios y guarda cuántos se cumplían', async () => {
    await servicio.decidir(PO, 5, 12, { decision: 'aceptada', criterios_cumplidos: 3, confirmar: true });
    expect(sqlDe('INSERT INTO reviews_historias')[0].params.slice(6)).toEqual([3, 4]);
  });

  test('rechazar sin comentario es un error 400 con el campo marcado', async () => {
    const error = await fallo(servicio.decidir(PO, 5, 12, { decision: 'rechazada', comentario: '  ' }));
    expect(error.statusCode).toBe(400);
    expect(error.detalles.comentario).toBeDefined();
  });

  test('rechazar en un sprint activo deja la historia "rechazada" y avisa al equipo', async () => {
    await servicio.decidir(PO, 5, 12, { decision: 'rechazada', comentario: 'No cumple el flujo' });
    expect(sqlDe("estado = 'rechazada'")).toHaveLength(1);
    expect(sqlDe('INSERT INTO notificaciones')).toHaveLength(1);
    expect(accionesAuditadas()).toEqual(['review_historia_rechazada']);
  });

  test('rechazar en un sprint ya cerrado devuelve la historia y sus tarjetas al backlog', async () => {
    mundo.sprint.estado = 'cerrado';
    await servicio.decidir(PO, 5, 12, { decision: 'rechazada', comentario: 'No cumple' });
    expect(sqlDe("sprint_id = NULL, estado = 'backlog'")).toHaveLength(1);
    expect(sqlDe('UPDATE tareas SET sprint_id = NULL')).toHaveLength(1);
  });

  test('una historia que todavía no está en Hecho no se puede revisar (409)', async () => {
    mundo.conteo = { tareas: 3, hechas: 1 };
    expect((await fallo(servicio.decidir(PO, 5, 12, { decision: 'aceptada' }))).statusCode).toBe(409);
  });

  test('una historia que no es del sprint responde 404', async () => {
    mundo.historia.sprint_id = 99;
    expect((await fallo(servicio.decidir(PO, 5, 12, { decision: 'aceptada' }))).statusCode).toBe(404);
  });
});

describe('Review (HU-12) - decisiones simultáneas y cambios', () => {
  beforeEach(() => {
    mundo.previa = { decision: 'aceptada', comentario: null, decidido_por_nombre: 'Rosa' };
  });

  test('si otra persona ya decidió, prevalece la primera decisión (409) y no se escribe nada', async () => {
    const error = await fallo(servicio.decidir(PO, 5, 12, { decision: 'rechazada', comentario: 'No' }));
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain('prevalece la primera decisión');
    expect(error.message).toContain('Rosa');
    expect(error.detalles.codigo).toBe('YA_DECIDIDA');
    expect(sqlDe('INSERT INTO reviews_historias')).toHaveLength(0);
  });

  test('cambiar una decisión ya tomada se permite y queda en la bitácora', async () => {
    const resultado = await servicio.decidir(PO, 5, 12, { decision: 'rechazada', comentario: 'Se rompió', cambiar: true });
    expect(resultado.cambiada).toBe(true);
    expect(accionesAuditadas()).toEqual(['review_decision_cambiada']);
    const detalle = JSON.parse(sqlDe('INSERT INTO bitacora')[0].params[5]);
    expect(detalle.antes).toMatchObject({ decision: 'aceptada' });
    expect(detalle.despues).toMatchObject({ decision: 'rechazada', comentario: 'Se rompió' });
  });

  test('repetir exactamente la misma decisión no cambia ni audita nada', async () => {
    await servicio.decidir(PO, 5, 12, { decision: 'aceptada', cambiar: true, criterios_cumplidos: 4 });
    expect(sqlDe('INSERT INTO reviews_historias')).toHaveLength(0);
    expect(sqlDe('INSERT INTO bitacora')).toHaveLength(0);
  });

  test('una historia rechazada que ya regresó al backlog no puede cambiar su decisión (409)', async () => {
    mundo.historia.sprint_id = null;
    const error = await fallo(servicio.decidir(PO, 5, 12, { decision: 'aceptada', cambiar: true }));
    expect(error.statusCode).toBe(409);
  });
});

describe('Review (HU-12) - velocity', () => {
  test('cada decisión recalcula la velocity guardada del sprint con los puntos aceptados', async () => {
    await servicio.decidir(PO, 5, 12, { decision: 'aceptada', criterios_cumplidos: 4 });
    const recalculo = sqlDe('UPDATE sprints s')[0];
    expect(recalculo.sql).toContain("r.decision = 'aceptada'");
    expect(recalculo.sql).toContain("s.estado = 'cerrado'");
    expect(recalculo.params).toEqual([5]);
  });

  test('recalcularVelocity devuelve null cuando el sprint sigue activo o nadie decidió', async () => {
    const vacio = { query: async () => ({ rows: [] }) };
    expect(await servicio.recalcularVelocity(vacio, 5)).toBeNull();
    expect(await servicio.recalcularVelocity({ query: async () => ({ rows: [{ velocity: 13 }] }) }, 5)).toBe(13);
  });
});

describe('Review (HU-12) - delegación temporal', () => {
  const datos = { delegado_id: 4, hasta: '2026-11-15', motivo: 'Viaje' };

  test('solo quien tiene review.delegar puede delegar', async () => {
    permisos.exigirPermiso.mockRejectedValue(new ErrorApp('No tienes permiso para delegar la aceptación de historias del Product Owner.', 403));
    expect((await fallo(servicio.delegar({ id: 8 }, 1, datos))).statusCode).toBe(403);
    expect(sqlDe('INSERT INTO review_delegaciones')).toHaveLength(0);
  });

  test('delegar crea la delegación, la audita y avisa', async () => {
    const resultado = await servicio.delegar({ id: 6 }, 1, datos);
    expect(resultado).toMatchObject({ id: 9, delegado_id: 4 });
    expect(sqlDe('INSERT INTO review_delegaciones')[0].params).toEqual([1, 4, 6, '2026-11-15', 'America/Mexico_City', 'Viaje']);
    expect(accionesAuditadas()).toEqual(['review_delegacion_creada']);
    expect(sqlDe('INSERT INTO notificaciones')).toHaveLength(1);
  });

  test('valida los campos antes de tocar la base (400)', async () => {
    const error = await fallo(servicio.delegar({ id: 6 }, 1, { delegado_id: 4, hasta: '2026-11-01' }));
    expect(error.statusCode).toBe(400);
    expect(error.detalles.hasta).toBeDefined();
  });

  test('el delegado debe ser integrante activo y no el Product Owner', async () => {
    permisos.obtenerRolProyecto.mockResolvedValue(null);
    expect((await fallo(servicio.delegar({ id: 6 }, 1, datos))).detalles.delegado_id).toBeDefined();
    permisos.obtenerRolProyecto.mockResolvedValue('product_owner');
    expect((await fallo(servicio.delegar({ id: 6 }, 1, datos))).detalles.delegado_id).toContain('Product Owner');
  });

  test('no puede haber dos delegaciones vigentes a la vez (409)', async () => {
    mundo.delegacionActiva = true;
    const error = await fallo(servicio.delegar({ id: 6 }, 1, datos));
    expect(error.statusCode).toBe(409);
    expect(sqlDe('INSERT INTO review_delegaciones')).toHaveLength(0);
  });

  test('revocar una delegación vigente la termina y queda en la bitácora', async () => {
    mundo.delegacionFila = { id: 9, proyecto_id: 1, revocada_en: null, hasta: new Date(Date.now() + 3600000), delegado_nombre: 'Luis', delegado_id: 4 };
    const resultado = await servicio.revocar({ id: 6 }, 9);
    expect(resultado).toMatchObject({ revocada: true, yaTerminada: false });
    expect(sqlDe('UPDATE review_delegaciones SET revocada_en')).toHaveLength(1);
    expect(accionesAuditadas()).toEqual(['review_delegacion_revocada']);
  });

  test('revocar una delegación ya revocada o vencida no repite nada', async () => {
    mundo.delegacionFila = { id: 9, proyecto_id: 1, revocada_en: new Date(), hasta: new Date(Date.now() + 3600000), delegado_nombre: 'Luis', delegado_id: 4 };
    expect((await servicio.revocar({ id: 6 }, 9)).yaTerminada).toBe(true);
    expect(sqlDe('UPDATE review_delegaciones SET revocada_en')).toHaveLength(0);
    expect(sqlDe('INSERT INTO bitacora')).toHaveLength(0);
  });

  test('una delegación que no existe responde 404', async () => {
    mundo.delegacionFila = null;
    expect((await fallo(servicio.revocar({ id: 6 }, 999))).statusCode).toBe(404);
  });
});
