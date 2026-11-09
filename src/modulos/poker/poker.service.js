/** HU-05 · Estimación Fibonacci, votación grupal, revelación, rondas y cierre de sesiones. */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { exigirPermiso } from '../../utils/permisos.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';

export const ESCALA = Object.freeze([1, 2, 3, 5, 8, 13, 21]);

function idValido(valor) {
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function comprobarId(valor) {
  const id = idValido(valor);
  if (!id) throw new ErrorApp('Identificador no válido.', 400);
  return id;
}

/** Consultar solo historias del proyecto que siguen en backlog o en sprint. */
export async function listarHistorias(usuario, proyectoId) {
  const proyecto = comprobarId(proyectoId);
  await exigirPermiso(usuario, 'proyecto.ver', proyecto);
  const { rows } = await consulta(
    `SELECT id, numero_hu, titulo, puntos, version, estado
       FROM historias
      WHERE proyecto_id = $1 AND estado IN ('backlog', 'en_sprint')
      ORDER BY orden, id`,
    [proyecto],
  );
  return rows;
}

/**
 * Guardado atómico y con versión: un segundo usuario no puede pisar la estimación
 * que alguien ya guardó. La autorización se evalúa para el proyecto de la URL.
 */
export async function estimarHistoria(usuario, proyectoId, historiaId, datos = {}) {
  const proyecto = comprobarId(proyectoId);
  const historiaIdNumero = comprobarId(historiaId);
  const version = idValido(datos?.version);
  if (!version) throw new ErrorApp('Falta la versión de la historia. Actualiza la lista.', 400);
  // No aceptar cadenas ni decimales como puntos; el frontend envía un entero.
  if (typeof datos?.puntos !== 'number' || !ESCALA.includes(datos.puntos)) {
    throw new ErrorApp('Los puntos deben ser 1, 2, 3, 5, 8, 13 o 21.', 400);
  }

  const cliente = await pool.connect();
  let guardada;
  try {
    await cliente.query('BEGIN');
    // HU-05: solo SM/PO del proyecto pueden fijar una estimación definitiva.
    await exigirModerador(usuario, proyecto, cliente);
    const { rows: proyectos } = await cliente.query(
      'SELECT archivado FROM proyectos WHERE id = $1', [proyecto],
    );
    if (!proyectos[0]) throw new ErrorApp('Proyecto no encontrado.', 404);
    if (proyectos[0].archivado) throw new ErrorApp('No se puede estimar en un proyecto archivado.', 409);

    const { rows } = await cliente.query(
      `SELECT id, numero_hu, titulo, puntos, version, estado
         FROM historias
        WHERE id = $1 AND proyecto_id = $2 FOR UPDATE`,
      [historiaIdNumero, proyecto],
    );
    const actual = rows[0];
    if (!actual) throw new ErrorApp('Historia no encontrada en este proyecto.', 404);
    if (!['backlog', 'en_sprint'].includes(actual.estado)) {
      throw new ErrorApp('Esta historia ya no está disponible para estimación.', 409);
    }
    if (actual.puntos !== null) {
      throw new ErrorApp('Esta historia ya tiene puntos estimados. Actualiza la lista.', 409);
    }
    if (actual.version !== version) {
      throw new ErrorApp('Otra persona modificó la historia. Actualiza la lista.', 409);
    }
    const { rows: rondaActiva } = await cliente.query(
      `SELECT 1 FROM poker_sesiones WHERE proyecto_id = $1 AND historia_id = $2 AND estado <> 'cerrada'`,
      [proyecto, historiaIdNumero],
    );
    if (rondaActiva.length) throw new ErrorApp('Hay una ronda de Planning Poker abierta para esta historia.', 409);

    const { rows: actualizadas } = await cliente.query(
      `UPDATE historias SET puntos = $1, version = version + 1
        WHERE id = $2 AND proyecto_id = $3 AND puntos IS NULL AND version = $4
        RETURNING id, numero_hu, titulo, puntos, version, estado`,
      [datos.puntos, historiaIdNumero, proyecto, version],
    );
    if (!actualizadas[0]) throw new ErrorApp('La historia cambió. Actualiza la lista.', 409);
    guardada = actualizadas[0];

    await registrarAuditoria(cliente, {
      usuarioId: usuario.id,
      proyectoId: proyecto,
      accion: ACCIONES.HISTORIA_MODIFICADA,
      objeto: OBJETOS.HISTORIA,
      objetoId: historiaIdNumero,
      antes: { puntos: null },
      despues: { puntos: datos.puntos },
      emitirEvento: false,
    });
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  // El Backlog y otras pantallas ya escuchan este evento para recargar sus historias.
  emitirAProyecto(proyecto, 'story:updated', { proyecto_id: proyecto, historia_id: guardada.id });
  return guardada;
}

/** HU-05 · Planning Poker: estado persistido por historia y proyecto. */
async function comprobarMiembro(usuario, proyecto, cliente = pool) {
  await exigirPermiso(usuario, 'proyecto.ver', proyecto, cliente);
  const { rows } = await cliente.query(
    `SELECT mp.rol FROM miembros_proyecto mp
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
       JOIN usuarios u ON u.id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND mp.usuario_id = $2 AND u.activo = TRUE AND p.archivado = FALSE`,
    [proyecto, usuario.id],
  );
  if (!rows[0]) throw new ErrorApp('No perteneces a este proyecto activo.', 403);
  return rows[0].rol;
}

async function exigirModerador(usuario, proyecto, cliente = pool) {
  const rol = await comprobarMiembro(usuario, proyecto, cliente);
  if (!['scrum_master', 'product_owner'].includes(rol)) {
    throw new ErrorApp('Solo Scrum Master o Product Owner puede administrar la ronda.', 403);
  }
}

async function participantes(cliente, proyecto) {
  const { rows } = await cliente.query(
    `SELECT u.id, u.nombre, mp.rol
       FROM miembros_proyecto mp
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
       JOIN usuarios u ON u.id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE
      ORDER BY CASE mp.rol WHEN 'scrum_master' THEN 0 WHEN 'product_owner' THEN 1 ELSE 2 END, u.nombre, u.id`,
    [proyecto],
  );
  return rows;
}

async function obtenerSesionBloqueada(cliente, proyecto, historia) {
  const { rows } = await cliente.query(
    `SELECT s.* FROM poker_sesiones s
      WHERE s.proyecto_id = $1 AND s.historia_id = $2 AND s.estado <> 'cerrada'
      ORDER BY s.id DESC LIMIT 1 FOR UPDATE`,
    [proyecto, historia],
  );
  return rows[0] ?? null;
}

async function resumenPoker(cliente, usuario, proyecto, historia) {
  const { rows } = await cliente.query(
    `SELECT s.id, s.ronda, s.estado, s.valor_final, s.historia_id,
            h.titulo, h.numero_hu, h.puntos AS puntos_historia
       FROM poker_sesiones s JOIN historias h ON h.id = s.historia_id
      WHERE s.proyecto_id = $1 AND s.historia_id = $2
      ORDER BY s.id DESC LIMIT 1`,
    [proyecto, historia],
  );
  const sesion = rows[0];
  if (!sesion) return { sesion: null };
  const integrantes = await participantes(cliente, proyecto);
  const { rows: votos } = await cliente.query(
    `SELECT usuario_id, puntos FROM poker_votos WHERE sesion_id = $1 AND ronda = $2`,
    [sesion.id, sesion.ronda],
  );
  const mapa = new Map(votos.map((v) => [v.usuario_id, v.puntos]));
  const revelar = sesion.estado !== 'votando';
  const valores = votos.map((v) => v.puntos);
  const diferencia = valores.length > 1 ? Math.max(...valores) - Math.min(...valores) : 0;
  const consenso = valores.length > 0 && valores.length === integrantes.length && new Set(valores).size === 1;
  return {
    sesion: {
      id: sesion.id, ronda: sesion.ronda, estado: sesion.estado,
      valor_final: sesion.valor_final, historia_id: sesion.historia_id,
      titulo: sesion.titulo, numero_hu: sesion.numero_hu,
      puntos_historia: sesion.puntos_historia,
       cierre_automatico: sesion.ronda === 4 && sesion.estado === 'cerrada',
      mi_voto: mapa.get(usuario.id) ?? null,
      votos_recibidos: integrantes.filter((p) => mapa.has(p.id)).length,
      total_participantes: integrantes.length,
      // Solo tras revelar se publica el diagnóstico de la ronda.
      consenso: revelar ? consenso : null,
      diferencia: revelar ? diferencia : null,
      recomendar_discusion: revelar ? diferencia >= 8 : null,
      sin_voto: integrantes.filter((p) => !mapa.has(p.id)).map((p) => p.nombre),
      participantes: integrantes.map((p) => ({
        id: p.id, nombre: p.nombre, rol: p.rol, ha_votado: mapa.has(p.id),
        // Los votos de otras personas NUNCA se envían antes de revelar.
        puntos: revelar ? (mapa.get(p.id) ?? null) : null,
      })),
    },
  };
}

function avisarCambioPoker(proyecto, historia) {
  // Solo se emite la identidad de la historia; cada cliente consulta su estado autorizado.
  emitirAProyecto(proyecto, 'poker:actualizado', { proyecto_id: proyecto, historia_id: historia });
}

export async function consultarPoker(usuario, proyectoId, historiaId) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  await comprobarMiembro(usuario, proyecto);
  return resumenPoker(pool, usuario, proyecto, historia);
}

export async function iniciarPoker(usuario, proyectoId, historiaId) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await exigirModerador(usuario, proyecto, cliente);
    const { rows } = await cliente.query(
      `SELECT puntos, estado FROM historias WHERE id = $1 AND proyecto_id = $2 FOR UPDATE`,
      [historia, proyecto],
    );
    if (!rows[0]) throw new ErrorApp('Historia no encontrada en el proyecto.', 404);
    if (rows[0].puntos !== null) throw new ErrorApp('La historia ya está estimada.', 409);
    const { rows: anteriores } = await cliente.query(
      "SELECT 1 FROM poker_sesiones WHERE proyecto_id = $1 AND historia_id = $2 AND estado = 'cerrada' LIMIT 1",
      [proyecto, historia],
    );
    if (anteriores.length) throw new ErrorApp('Esta historia ya tuvo una estimación definitiva y no puede reestimarse.', 409);
    if (!['backlog', 'en_sprint'].includes(rows[0].estado)) throw new ErrorApp('La historia no está disponible.', 409);
    if (!(await participantes(cliente, proyecto)).length) throw new ErrorApp('No hay participantes en el proyecto.', 409);
    const existente = await obtenerSesionBloqueada(cliente, proyecto, historia);
    if (existente) throw new ErrorApp('Ya existe una sesión activa de Planning Poker para esta historia.', 409);
    await cliente.query(
      `INSERT INTO poker_sesiones(proyecto_id, historia_id, iniciada_por) VALUES ($1, $2, $3)`,
      [proyecto, historia, usuario.id],
    );
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally { cliente.release(); }
  avisarCambioPoker(proyecto, historia);
  return consultarPoker(usuario, proyecto, historia);
}

/** Cuarta ronda: promedio de los votos recibidos, redondeo aritmético y Fibonacci más cercano.
 * En un empate de distancia entre dos valores Fibonacci, se elige el superior.
 * Se ejecuta dentro de la transacción que revela la ronda.
 */
async function finalizarCuartaRonda(cliente, usuario, proyecto, historia, sesion) {
  if (sesion.ronda !== 4) return false;
  const { rows: votos } = await cliente.query(
    'SELECT puntos FROM poker_votos WHERE sesion_id = $1 AND ronda = $2',
    [sesion.id, sesion.ronda],
  );
  if (!votos.length) throw new ErrorApp('Se necesita al menos un voto para finalizar la cuarta ronda.', 409);
  const promedio = votos.reduce((suma, voto) => suma + voto.puntos, 0) / votos.length;
  const entero = Math.round(promedio);
  const puntos = ESCALA.reduce((mejor, candidato) =>
    Math.abs(candidato - entero) <= Math.abs(mejor - entero) ? candidato : mejor,
  );
  const { rows: actualizadas } = await cliente.query(
    `UPDATE historias SET puntos = $1, version = version + 1
       WHERE id = $2 AND proyecto_id = $3 AND puntos IS NULL RETURNING id`,
    [puntos, historia, proyecto],
  );
  if (!actualizadas.length) throw new ErrorApp('La historia ya tiene una estimación definitiva.', 409);
  await cliente.query(
    `UPDATE poker_sesiones SET estado = 'cerrada', valor_final = $1, actualizada_en = NOW() WHERE id = $2`,
    [puntos, sesion.id],
  );
  await registrarAuditoria(cliente, {
    usuarioId: usuario.id, proyectoId: proyecto, accion: ACCIONES.HISTORIA_MODIFICADA,
    objeto: OBJETOS.HISTORIA, objetoId: historia, antes: { puntos: null },
    despues: { puntos, promedio, ronda: 4, calculo_automatico: true }, emitirEvento: false,
  });
  return true;
}

export async function votarPoker(usuario, proyectoId, historiaId, datos = {}) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  if (typeof datos.puntos !== 'number' || !ESCALA.includes(datos.puntos)) {
    throw new ErrorApp('Selecciona un valor Fibonacci válido.', 400);
  }
  const cliente = await pool.connect();
  let cierreAutomatico = false;
  try {
    await cliente.query('BEGIN');
    await comprobarMiembro(usuario, proyecto, cliente);
    const sesion = await obtenerSesionBloqueada(cliente, proyecto, historia);
    if (!sesion) throw new ErrorApp('No se ha iniciado una ronda.', 404);
    if (sesion.estado !== 'votando') throw new ErrorApp('La ronda ya fue revelada o cerrada.', 409);
    await cliente.query(
      `INSERT INTO poker_votos(sesion_id, ronda, usuario_id, puntos) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sesion_id, ronda, usuario_id)
       DO UPDATE SET puntos = EXCLUDED.puntos, votado_en = NOW()`,
      [sesion.id, sesion.ronda, usuario.id, datos.puntos],
    );
    const integrantes = await participantes(cliente, proyecto);
    const { rows: cuenta } = await cliente.query(
      `SELECT COUNT(*)::int AS cantidad FROM poker_votos WHERE sesion_id = $1 AND ronda = $2`,
      [sesion.id, sesion.ronda],
    );
    // La última persona revela simultáneamente la ronda para todos.
    if (integrantes.length > 0 && cuenta[0].cantidad >= integrantes.length) {
      await cliente.query(
        `UPDATE poker_sesiones SET estado = 'revelada', actualizada_en = NOW() WHERE id = $1`,
        [sesion.id],
      );
      cierreAutomatico = await finalizarCuartaRonda(cliente, usuario, proyecto, historia, sesion);
    }
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally { cliente.release(); }
  avisarCambioPoker(proyecto, historia);
  if (cierreAutomatico) emitirAProyecto(proyecto, 'story:updated', { proyecto_id: proyecto, historia_id: historia });
  return consultarPoker(usuario, proyecto, historia);
}

/** Permite que SM/PO revele votos existentes si hay integrantes ausentes. */
export async function revelarPoker(usuario, proyectoId, historiaId) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  const cliente = await pool.connect();
  let cierreAutomatico = false;
  try {
    await cliente.query('BEGIN');
    await exigirModerador(usuario, proyecto, cliente);
    const sesion = await obtenerSesionBloqueada(cliente, proyecto, historia);
    if (!sesion || sesion.estado !== 'votando') throw new ErrorApp('No hay una ronda abierta.', 409);
    const { rows } = await cliente.query(
      'SELECT COUNT(*)::int AS cantidad FROM poker_votos WHERE sesion_id = $1 AND ronda = $2',
      [sesion.id, sesion.ronda],
    );
    if (!rows[0].cantidad) throw new ErrorApp('Se necesita al menos un voto para revelar.', 409);
    await cliente.query(
      "UPDATE poker_sesiones SET estado = 'revelada', actualizada_en = NOW() WHERE id = $1",
      [sesion.id],
    );
    cierreAutomatico = await finalizarCuartaRonda(cliente, usuario, proyecto, historia, sesion);
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally { cliente.release(); }
  avisarCambioPoker(proyecto, historia);
  if (cierreAutomatico) emitirAProyecto(proyecto, 'story:updated', { proyecto_id: proyecto, historia_id: historia });
  return consultarPoker(usuario, proyecto, historia);
}

export async function nuevaRondaPoker(usuario, proyectoId, historiaId) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await exigirModerador(usuario, proyecto, cliente);
    const sesion = await obtenerSesionBloqueada(cliente, proyecto, historia);
    if (!sesion) throw new ErrorApp('No hay una sesión de Planning Poker.', 404);
    if (sesion.estado !== 'revelada') throw new ErrorApp('Primero deben revelarse los votos.', 409);
    if (sesion.ronda >= 4) throw new ErrorApp('La cuarta ronda es la última; no se permiten más rondas.', 409);
    await cliente.query(
      `UPDATE poker_sesiones SET ronda = ronda + 1, estado = 'votando', actualizada_en = NOW() WHERE id = $1`,
      [sesion.id],
    );
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally { cliente.release(); }
  avisarCambioPoker(proyecto, historia);
  return consultarPoker(usuario, proyecto, historia);
}

export async function cerrarPoker(usuario, proyectoId, historiaId, datos = {}) {
  const proyecto = comprobarId(proyectoId);
  const historia = comprobarId(historiaId);
  if (typeof datos.puntos !== 'number' || !ESCALA.includes(datos.puntos)) {
    throw new ErrorApp('La estimación final debe pertenecer a la escala Fibonacci.', 400);
  }
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await exigirModerador(usuario, proyecto, cliente);
    const sesion = await obtenerSesionBloqueada(cliente, proyecto, historia);
    if (!sesion) throw new ErrorApp('No hay una sesión de Planning Poker.', 404);
    if (sesion.estado !== 'revelada') throw new ErrorApp('La ronda debe revelarse antes de fijar los puntos.', 409);
    if (sesion.ronda >= 4) throw new ErrorApp('La cuarta ronda se finaliza automáticamente.', 409);
    const { rows } = await cliente.query(
      `UPDATE historias SET puntos = $1, version = version + 1
        WHERE id = $2 AND proyecto_id = $3 AND puntos IS NULL
        RETURNING id`,
      [datos.puntos, historia, proyecto],
    );
    if (!rows[0]) throw new ErrorApp('La historia ya tiene estimación. Actualiza la página.', 409);
    await cliente.query(
      `UPDATE poker_sesiones SET estado = 'cerrada', valor_final = $1, actualizada_en = NOW() WHERE id = $2`,
      [datos.puntos, sesion.id],
    );
    await registrarAuditoria(cliente, {
      usuarioId: usuario.id, proyectoId: proyecto, accion: ACCIONES.HISTORIA_MODIFICADA,
      objeto: OBJETOS.HISTORIA, objetoId: historia, antes: { puntos: null },
      despues: { puntos: datos.puntos }, emitirEvento: false,
    });
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally { cliente.release(); }
  avisarCambioPoker(proyecto, historia);
  emitirAProyecto(proyecto, 'story:updated', { proyecto_id: proyecto, historia_id: historia });
  return consultarPoker(usuario, proyecto, historia);
}
