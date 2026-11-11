// Responsable: Diego - HU-12: reglas, SQL y avisos por socket (Sprint Review y aceptacion)
/**
 * HU-12 · Sprint Review y aceptación de historias.
 *
 * Tablas que usa (database/schema.sql): reviews_historias, review_delegaciones, historias, tareas,
 * columnas_tablero, sprints, miembros_proyecto, usuarios, notificaciones y bitacora (vía auditar.js).
 *
 * Decisiones importantes:
 *  - Quién decide: el Product Owner (permiso review.decidir) o quien tenga SU delegación vigente. Todos los
 *    roles del proyecto pueden ver la Review (review.ver); solo el Scrum Master (review.delegar) crea y revoca
 *    delegaciones y ve su historial. Cada petición vuelve a comprobar el permiso: la pantalla solo oculta botones.
 *  - Una historia se revisa cuando está terminada: "hecho", "aceptada" o con todas sus tarjetas en la columna final.
 *  - Aceptar → decisión "aceptada" y la historia queda "aceptada". Rechazar exige comentario: en un sprint activo la
 *    historia queda "rechazada" (al cerrar el sprint, HU-09 la manda al backlog o al siguiente sprint) y en un sprint
 *    ya cerrado regresa al backlog de inmediato (HU-30 cuenta la velocity con reviews_historias, no con historias.estado).
 *  - Si dos personas deciden a la vez sobre la misma historia, la fila de la historia se bloquea (FOR UPDATE): la
 *    segunda recibe 409 y prevalece la primera. Cambiar una decisión ya tomada es explícito (`cambiar`) y se audita.
 *  - Aceptar con criterios incompletos (3 de 4) responde 409 CRITERIOS_INCOMPLETOS hasta que se confirma.
 *  - Velocity del sprint = puntos de las historias ACEPTADAS. Cada decisión la recalcula en la misma transacción
 *    (recalcularVelocity) y HU-09 la usa al cerrar el sprint.
 *  - Toda decisión y toda delegación se registra en la bitácora dentro de la misma transacción.
 *
 * @author Diego Rafael Jimenez Trujano
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto, emitirAUsuario } from '../../sockets/emisor.js';
import { exigirPermiso, tienePermiso, obtenerRolProyecto, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { enTransaccion, registrarAuditoria, ACCIONES, OBJETOS } from '../../middlewares/auditar.js';
import { relojDe } from '../daily/daily.service.js';
import { separarCriterios, esHistoriaTerminada, validarDecision, validarDelegacion, resumirReview } from './reviews.reglas.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = { actualizada: 'review:actualizada' };

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;
const ENLACE_REVIEW = '/pages/review.html';
const CLAVE_CANDADO_DELEGACION = 12;

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver utils/envolverControlador.js).
 */
function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

/**
 * Convertir un identificador recibido en la petición a un entero positivo.
 *
 * @param {*} valor - Valor sin confiar.
 * @param {string} mensaje - Mensaje del error 400 cuando no es válido.
 * @returns {number}
 * @throws {ErrorApp} 400 si no es un entero positivo válido.
 */
function leerId(valor, mensaje = 'El identificador no es válido.') {
  const numero = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? NaN : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > ENTERO_MAXIMO) lanzar(400, mensaje);
  return numero;
}

/** Avisar por socket a todo el proyecto que la Review cambió (la pantalla se recarga sola). */
const avisarCambio = (proyectoId, sprintId) => emitirAProyecto(proyectoId, EVENTOS.actualizada, { proyecto_id: proyectoId, sprint_id: sprintId ?? null });

/* ====================================================================
 * Quién puede decidir
 * ==================================================================== */

/**
 * Averiguar si la persona puede aceptar o rechazar historias en el proyecto: es el Product Owner o tiene
 * una delegación vigente (no revocada, dentro de sus fechas) y sigue siendo integrante activo del proyecto.
 *
 * @param {{id: number}} actor
 * @param {number} proyectoId
 * @returns {Promise<{puede: boolean, como: ('product_owner'|'delegado'|null), delegacion: (Object|null)}>}
 */
async function quienDecide(actor, proyectoId) {
  if (await tienePermiso(actor, 'review.decidir', proyectoId)) return { puede: true, como: 'product_owner', delegacion: null };
  const { rows: [delegacion] } = await consulta(
    `SELECT id, hasta FROM review_delegaciones
      WHERE proyecto_id = $1 AND delegado_id = $2 AND revocada_en IS NULL AND desde <= NOW() AND hasta > NOW()
      ORDER BY id DESC LIMIT 1`,
    [proyectoId, actor.id],
  );
  if (delegacion && (await obtenerRolProyecto(actor, proyectoId))) return { puede: true, como: 'delegado', delegacion };
  return { puede: false, como: null, delegacion: null };
}

/* ====================================================================
 * Velocity
 * ==================================================================== */

/**
 * Recalcular la velocity guardada del sprint como la suma de puntos de las historias ACEPTADAS en la review.
 * Solo aplica a sprints cerrados que ya tienen decisiones: mientras el sprint está activo la velocity se muestra
 * en vivo (resumirReview) y HU-09 la guarda al cerrar. Si nadie ha decidido nada, no toca la que calculó HU-09.
 *
 * @param {import('pg').PoolClient} cliente - Cliente de la transacción en curso.
 * @param {number} sprintId
 * @returns {Promise<number|null>} La velocity guardada, o null si no se recalculó.
 */
export async function recalcularVelocity(cliente, sprintId) {
  const { rows: [fila] } = await cliente.query(
    `UPDATE sprints s
        SET velocity = COALESCE((SELECT SUM(h.puntos) FROM reviews_historias r JOIN historias h ON h.id = r.historia_id
                                  WHERE r.sprint_id = s.id AND r.decision = 'aceptada'), 0)
      WHERE s.id = $1 AND s.estado = 'cerrado' AND EXISTS (SELECT 1 FROM reviews_historias r WHERE r.sprint_id = s.id)
      RETURNING s.velocity`,
    [sprintId],
  );
  return fila ? fila.velocity : null;
}

/* ====================================================================
 * Consulta de la pantalla
 * ==================================================================== */

/**
 * Historias que se muestran en la Review de un sprint: las del sprint y las que ya tienen decisión en él
 * (una rechazada en un sprint cerrado ya salió del sprint, pero su decisión sigue siendo parte de la Review).
 *
 * @param {number} sprintId
 * @param {number} proyectoId
 * @returns {Promise<Array<Object>>}
 */
async function historiasDeReview(sprintId, proyectoId) {
  const { rows } = await consulta(
    `SELECT h.id, h.numero_hu, h.titulo, h.puntos, h.criterios, h.estado, h.sprint_id,
            COUNT(t.id)::int AS tareas, COUNT(t.id) FILTER (WHERE c.es_final)::int AS tareas_hechas,
            r.decision, r.comentario, r.decidido_en, r.como_delegado, r.criterios_cumplidos, r.criterios_total,
            u.nombre AS decidido_por_nombre
       FROM historias h
       LEFT JOIN reviews_historias r ON r.historia_id = h.id AND r.sprint_id = $1
       LEFT JOIN usuarios u ON u.id = r.decidido_por
       LEFT JOIN tareas t ON t.historia_id = h.id
       LEFT JOIN columnas_tablero c ON c.id = t.columna_id
      WHERE h.proyecto_id = $2 AND (h.sprint_id = $1 OR r.id IS NOT NULL)
      GROUP BY h.id, r.id, u.nombre
      ORDER BY h.numero_hu`,
    [sprintId, proyectoId],
  );
  return rows;
}

/**
 * Consultar la Review de un sprint con sus historias, decisiones y velocity. Sin sprint indicado se abre la del
 * sprint activo o, si no hay, la del último cerrado. Cada rol recibe solo lo que le corresponde:
 *  - Todos: historias, decisiones (con quién las tomó) y velocity.
 *  - Quien puede decidir (PO o delegado): además, qué historias puede decidir (`puedeDecidir`).
 *  - Scrum Master, Product Owner y delegado: la delegación vigente. Solo el Scrum Master: historial y candidatos.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {number|string} [sprintTexto] - Sprint elegido en el selector.
 * @returns {Promise<Object>}
 * @throws {ErrorApp} 404 si el sprint no es activo ni cerrado, no es del proyecto o la persona no tiene vínculo con él.
 */
export async function consultar(actor, proyectoId, sprintTexto) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  // Sin vínculo vigente con el proyecto responde 404, igual que si no existiera
  const rol = await exigirPermiso(actor, 'review.ver', idProyecto);
  const reloj = await relojDe(actor.id);

  const { rows: sprints } = await consulta(
    `SELECT id, nombre, estado FROM sprints
      WHERE proyecto_id = $1 AND estado IN ('activo', 'cerrado')
      ORDER BY fecha_inicio DESC, id DESC`,
    [idProyecto],
  );
  const sprint = sprintTexto
    ? sprints.find((s) => s.id === leerId(sprintTexto, 'El sprint no es válido.'))
    : sprints.find((s) => s.estado === 'activo') ?? sprints[0];
  if (sprintTexto && !sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);

  const [decisor, puedeDelegar] = await Promise.all([quienDecide(actor, idProyecto), tienePermiso(actor, 'review.delegar', idProyecto)]);
  const base = {
    hoy: reloj.hoy,
    sprints,
    yo: { id: actor.id, nombre: reloj.nombre, rol },
    puedeDecidir: decisor.puede,
    decideComo: decisor.como,
    puedeDelegar,
  };
  if (!sprint) {
    return { ...base, sprint: null, historias: [], resumen: resumirReview([]), delegacion: null, delegaciones: [], candidatos: [] };
  }

  const filas = await historiasDeReview(sprint.id, idProyecto);
  const historias = filas.map((h) => {
    const terminada = esHistoriaTerminada({ estado: h.estado, tareas: h.tareas, tareasHechas: h.tareas_hechas, decision: h.decision });
    return {
      id: h.id,
      numeroHu: h.numero_hu,
      titulo: h.titulo,
      puntos: h.puntos,
      criterios: separarCriterios(h.criterios),
      tareas: h.tareas,
      tareasHechas: h.tareas_hechas,
      terminada,
      decision: h.decision
        ? {
          decision: h.decision,
          comentario: h.comentario,
          decididoPor: h.decidido_por_nombre,
          comoDelegado: h.como_delegado,
          decididoEn: h.decidido_en,
          criteriosCumplidos: h.criterios_cumplidos,
          criteriosTotal: h.criterios_total,
        }
        : null,
      // Una decisión solo se puede cambiar mientras la historia siga en el sprint (si ya regresó al backlog es definitiva)
      puedeDecidir: decisor.puede && terminada && (!h.decision || h.sprint_id === sprint.id),
    };
  });

  // Delegaciones: solo las ve quien participa en ellas (SM, PO o el propio delegado); el historial es del SM
  let delegaciones = [];
  let candidatos = [];
  if (puedeDelegar || rol === 'product_owner' || decisor.como === 'delegado') {
    ({ rows: delegaciones } = await consulta(
      `SELECT d.id, d.delegado_id, ud.nombre AS delegado_nombre, d.desde, d.hasta, d.motivo, d.revocada_en,
              uc.nombre AS creada_por_nombre, (d.revocada_en IS NULL AND d.desde <= NOW() AND d.hasta > NOW()) AS vigente
         FROM review_delegaciones d
         JOIN usuarios ud ON ud.id = d.delegado_id
         LEFT JOIN usuarios uc ON uc.id = d.creada_por
        WHERE d.proyecto_id = $1 ORDER BY d.id DESC LIMIT 10`,
      [idProyecto],
    ));
  }
  if (puedeDelegar) {
    ({ rows: candidatos } = await consulta(
      `SELECT u.id, u.nombre, mp.rol
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND u.activo = TRUE AND mp.rol <> 'product_owner' ORDER BY u.nombre`,
      [idProyecto],
    ));
  }
  const vigente = delegaciones.find((d) => d.vigente) ?? null;

  return {
    ...base,
    sprint,
    historias,
    resumen: resumirReview(historias),
    delegacion: vigente,
    delegaciones: puedeDelegar ? delegaciones : [],
    candidatos,
  };
}

/* ====================================================================
 * Aceptar o rechazar (HU-12 · tareas 1 y 2)
 * ==================================================================== */

/**
 * Avisar a quienes trabajaron en la historia (y al Scrum Master) que fue rechazada, con el comentario del PO.
 * Un fallo aquí nunca debe deshacer la decisión ya guardada.
 *
 * @param {{id: number, numero_hu: number, titulo: string, proyecto_id: number}} historia
 * @param {number} actorId - Quien decidió (no se le avisa a sí mismo).
 * @param {string} comentario
 * @returns {Promise<void>}
 */
async function avisarRechazo(historia, actorId, comentario) {
  try {
    const { rows } = await consulta(
      `SELECT DISTINCT q.id FROM (
          SELECT responsable_id AS id FROM tareas WHERE historia_id = $1
          UNION SELECT usuario_id FROM miembros_proyecto WHERE proyecto_id = $2 AND rol = 'scrum_master'
        ) q WHERE q.id IS NOT NULL AND q.id <> $3`,
      [historia.id, historia.proyecto_id, actorId],
    );
    await notificar(rows.map((r) => r.id), {
      tipo: 'review_rechazada',
      titulo: 'Historia rechazada en la Review',
      mensaje: `HU-${historia.numero_hu} «${historia.titulo}» fue rechazada: ${comentario}`,
      referenciaId: historia.id,
    });
  } catch (error) {
    console.error('[reviews] No se pudo avisar del rechazo:', error.message);
  }
}

/**
 * Crear una notificación para varias personas activas y empujarla por socket a la campana.
 * Misma forma que usa notificaciones.service.js (ver también retros.service.js).
 *
 * @param {number[]} usuarioIds
 * @param {{tipo: string, titulo: string, mensaje: string, referenciaId: number}} datos
 * @returns {Promise<void>}
 */
async function notificar(usuarioIds, { tipo, titulo, mensaje, referenciaId }) {
  const destinos = [...new Set(usuarioIds)];
  if (!destinos.length) return;
  const { rows } = await consulta(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, referencia_id)
     SELECT u.id, $2::text, $3::text, $4::text, $5::text, $6::int FROM usuarios u WHERE u.id = ANY($1::int[]) AND u.activo = TRUE
     RETURNING id, usuario_id, tipo, titulo, mensaje, enlace, referencia_id, metadatos, leida, creado_en`,
    [destinos, tipo, titulo, mensaje, ENLACE_REVIEW, referenciaId],
  );
  for (const n of rows) {
    emitirAUsuario(n.usuario_id, 'notificacion:nueva', {
      id: n.id, tipo: n.tipo, titulo: n.titulo, mensaje: n.mensaje, enlace: n.enlace,
      referenciaId: n.referencia_id, metadatos: n.metadatos ?? {}, leida: n.leida, creadaEn: n.creado_en,
    });
  }
}

/**
 * Aceptar o rechazar una historia terminada de un sprint (o cambiar una decisión ya tomada).
 *
 * @param {{id: number}} actor
 * @param {number|string} sprintId
 * @param {number|string} historiaId
 * @param {{decision: string, comentario?: string, criterios_cumplidos?: number, confirmar?: boolean, cambiar?: boolean}} datos
 * @returns {Promise<{decision: string, historia_id: number, velocity: number, cambiada: boolean}>}
 * @throws {ErrorApp} 400 con `detalles` por campo; 403 si no es el PO ni un delegado vigente; 404 si no existe;
 *   409 si la historia no está terminada, ya fue decidida (prevalece la primera) o tiene criterios incompletos sin confirmar.
 */
export async function decidir(actor, sprintId, historiaId, datos = {}) {
  const idSprint = leerId(sprintId, 'El identificador del sprint no es válido.');
  const idHistoria = leerId(historiaId, 'El identificador de la historia no es válido.');
  const { rows: [sprint] } = await consulta('SELECT id, proyecto_id, estado FROM sprints WHERE id = $1', [idSprint]);
  if (!sprint) lanzar(404, MENSAJE_NO_ENCONTRADO);
  await exigirPermiso(actor, 'review.ver', sprint.proyecto_id);
  if (sprint.estado === 'planificado') lanzar(409, 'El sprint todavía no empieza: no hay nada que revisar.');

  const decisor = await quienDecide(actor, sprint.proyecto_id);
  if (!decisor.puede) lanzar(403, 'Solo el Product Owner, o quien tenga su delegación vigente, puede aceptar o rechazar historias.');

  const resultado = await enTransaccion(async (cliente) => {
    // Bloquear la historia: dos decisiones simultáneas se atienden una tras otra y la segunda ya ve la primera
    const { rows: [historia] } = await cliente.query(
      'SELECT id, numero_hu, titulo, puntos, criterios, estado, sprint_id, proyecto_id FROM historias WHERE id = $1 AND proyecto_id = $2 FOR UPDATE',
      [idHistoria, sprint.proyecto_id],
    );
    if (!historia) lanzar(404, MENSAJE_NO_ENCONTRADO);

    const { rows: [previa] } = await cliente.query(
      `SELECT r.decision, r.comentario, u.nombre AS decidido_por_nombre
         FROM reviews_historias r LEFT JOIN usuarios u ON u.id = r.decidido_por
        WHERE r.sprint_id = $1 AND r.historia_id = $2`,
      [sprint.id, historia.id],
    );
    if (!previa && historia.sprint_id !== sprint.id) lanzar(404, MENSAJE_NO_ENCONTRADO);

    const { errores, valores, incompletos } = validarDecision(datos, separarCriterios(historia.criterios).length);
    if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

    const { rows: [conteo] } = await cliente.query(
      `SELECT COUNT(t.id)::int AS tareas, COUNT(t.id) FILTER (WHERE c.es_final)::int AS hechas
         FROM tareas t LEFT JOIN columnas_tablero c ON c.id = t.columna_id WHERE t.historia_id = $1`,
      [historia.id],
    );
    if (!esHistoriaTerminada({ estado: historia.estado, tareas: conteo.tareas, tareasHechas: conteo.hechas, decision: previa?.decision })) {
      lanzar(409, 'La historia todavía no está en Hecho: solo se revisan las historias terminadas.');
    }
    if (previa && !valores.cambiar) {
      const verbo = previa.decision === 'aceptada' ? 'aceptó' : 'rechazó';
      lanzar(409, `${previa.decidido_por_nombre ?? 'Alguien'} ya ${verbo} esta historia: prevalece la primera decisión.`, { codigo: 'YA_DECIDIDA' });
    }
    if (previa && historia.sprint_id !== sprint.id) {
      lanzar(409, 'La historia ya regresó al backlog tras el rechazo: su decisión ya no puede cambiarse.');
    }
    if (incompletos && !valores.confirmar) {
      lanzar(409, `Solo se cumplen ${valores.criteriosCumplidos} de ${valores.criteriosTotal} criterios de aceptación. Confirma para aceptarla de todas formas.`, {
        codigo: 'CRITERIOS_INCOMPLETOS', cumplidos: valores.criteriosCumplidos, total: valores.criteriosTotal,
      });
    }

    const mismaDecision = previa && previa.decision === valores.decision && (previa.comentario ?? null) === valores.comentario;
    if (!mismaDecision) {
      await cliente.query(
        `INSERT INTO reviews_historias (sprint_id, historia_id, decision, comentario, decidido_por, como_delegado, criterios_cumplidos, criterios_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (sprint_id, historia_id) DO UPDATE
            SET decision = EXCLUDED.decision, comentario = EXCLUDED.comentario, decidido_por = EXCLUDED.decidido_por,
                decidido_en = NOW(), como_delegado = EXCLUDED.como_delegado,
                criterios_cumplidos = EXCLUDED.criterios_cumplidos, criterios_total = EXCLUDED.criterios_total`,
        [sprint.id, historia.id, valores.decision, valores.comentario, actor.id, decisor.como === 'delegado', valores.criteriosCumplidos, valores.criteriosTotal],
      );

      if (valores.decision === 'aceptada') {
        await cliente.query("UPDATE historias SET estado = 'aceptada', version = version + 1 WHERE id = $1", [historia.id]);
      } else if (sprint.estado === 'cerrado') {
        // El sprint ya cerró y no habrá otro cierre que la mueva: regresa al backlog, igual que lo hace HU-09
        await cliente.query("UPDATE historias SET sprint_id = NULL, estado = 'backlog', version = version + 1 WHERE id = $1", [historia.id]);
        await cliente.query('UPDATE tareas SET sprint_id = NULL, columna_id = NULL WHERE historia_id = $1 AND sprint_id = $2', [historia.id, sprint.id]);
      } else {
        await cliente.query("UPDATE historias SET estado = 'rechazada', version = version + 1 WHERE id = $1", [historia.id]);
      }

      const velocityGuardada = await recalcularVelocity(cliente, sprint.id);
      const accion = previa
        ? ACCIONES.REVIEW_DECISION_CAMBIADA
        : valores.decision === 'aceptada' ? ACCIONES.REVIEW_HISTORIA_ACEPTADA : ACCIONES.REVIEW_HISTORIA_RECHAZADA;
      await registrarAuditoria(cliente, {
        usuarioId: actor.id,
        proyectoId: sprint.proyecto_id,
        accion,
        objeto: OBJETOS.HISTORIA,
        objetoId: historia.id,
        antes: previa ? { decision: previa.decision, comentario: previa.comentario } : { estado: historia.estado },
        despues: { decision: valores.decision, comentario: valores.comentario },
        contexto: {
          sprint_id: sprint.id,
          numero_hu: historia.numero_hu,
          puntos: historia.puntos,
          como_delegado: decisor.como === 'delegado',
          delegacion_id: decisor.delegacion?.id ?? null,
          criterios_cumplidos: valores.criteriosCumplidos,
          criterios_total: valores.criteriosTotal,
          velocity_sprint: velocityGuardada,
        },
      });
    }

    const { rows: [{ velocity }] } = await cliente.query(
      `SELECT COALESCE(SUM(h.puntos), 0)::int AS velocity FROM reviews_historias r JOIN historias h ON h.id = r.historia_id
        WHERE r.sprint_id = $1 AND r.decision = 'aceptada'`,
      [sprint.id],
    );
    return { decision: valores.decision, historia, comentario: valores.comentario, velocity, cambiada: Boolean(previa), sinCambios: Boolean(mismaDecision) };
  });

  if (!resultado.sinCambios) {
    avisarCambio(sprint.proyecto_id, sprint.id);
    if (resultado.decision === 'rechazada') await avisarRechazo(resultado.historia, actor.id, resultado.comentario);
  }
  return { decision: resultado.decision, historia_id: resultado.historia.id, velocity: resultado.velocity, cambiada: resultado.cambiada };
}

/* ====================================================================
 * Delegación temporal de la aceptación (HU-12 · tarea 3)
 * ==================================================================== */

/**
 * Delegar la aceptación del Product Owner en otra persona del proyecto, hasta un día (inclusive).
 * Solo quien administra el proyecto (Scrum Master). Hay una sola delegación vigente por proyecto y queda en la bitácora.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{delegado_id: number, hasta: string, motivo?: string}} datos
 * @returns {Promise<{id: number, delegado_id: number, hasta: Date}>}
 * @throws {ErrorApp} 400 con `detalles` por campo; 403/404 por permisos; 409 si ya hay una delegación vigente.
 */
export async function delegar(actor, proyectoId, datos = {}) {
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'review.delegar', idProyecto);

  const reloj = await relojDe(actor.id);
  const { errores, valores } = validarDelegacion(datos, reloj.hoy);
  if (!errores.delegado_id) {
    const rolDelegado = await obtenerRolProyecto({ id: valores.delegadoId }, idProyecto);
    if (!rolDelegado) errores.delegado_id = 'El delegado debe ser un integrante activo del proyecto.';
    else if (rolDelegado === 'product_owner') errores.delegado_id = 'El Product Owner ya puede decidir: elige a otra persona.';
  }
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const resultado = await enTransaccion(async (cliente) => {
    // Candado por proyecto: dos delegaciones simultáneas no pueden quedar vigentes a la vez
    await cliente.query('SELECT pg_advisory_xact_lock($1, $2)', [idProyecto, CLAVE_CANDADO_DELEGACION]);
    const { rows: [activa] } = await cliente.query(
      `SELECT u.nombre FROM review_delegaciones d JOIN usuarios u ON u.id = d.delegado_id
        WHERE d.proyecto_id = $1 AND d.revocada_en IS NULL AND d.hasta > NOW()`,
      [idProyecto],
    );
    if (activa) lanzar(409, `Ya hay una delegación vigente en ${activa.nombre}. Revócala antes de crear otra.`);

    // "hasta" es un día completo en la zona horaria de quien delega: vence al terminar ese día
    const { rows: [delegacion] } = await cliente.query(
      `INSERT INTO review_delegaciones (proyecto_id, delegado_id, creada_por, hasta, motivo)
       VALUES ($1, $2, $3, (($4::date + 1)::timestamp AT TIME ZONE $5), $6)
       RETURNING id, desde, hasta`,
      [idProyecto, valores.delegadoId, actor.id, valores.hasta, reloj.zona, valores.motivo],
    );
    const { rows: [delegado] } = await cliente.query('SELECT nombre FROM usuarios WHERE id = $1', [valores.delegadoId]);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: idProyecto,
      accion: ACCIONES.REVIEW_DELEGACION_CREADA,
      objeto: OBJETOS.REVIEW,
      objetoId: delegacion.id,
      despues: { delegado_id: valores.delegadoId, delegado_nombre: delegado.nombre, desde: delegacion.desde, hasta: delegacion.hasta, motivo: valores.motivo },
    });
    return { ...delegacion, delegado_id: valores.delegadoId, delegado_nombre: delegado.nombre };
  });

  avisarCambio(idProyecto);
  try {
    const { rows: [po] } = await consulta("SELECT usuario_id FROM miembros_proyecto WHERE proyecto_id = $1 AND rol = 'product_owner'", [idProyecto]);
    await notificar([resultado.delegado_id, po?.usuario_id].filter((id) => id && id !== actor.id), {
      tipo: 'review_delegacion',
      titulo: 'Aceptación delegada en la Sprint Review',
      mensaje: `${resultado.delegado_nombre} puede aceptar o rechazar historias en lugar del Product Owner hasta el ${valores.hasta}.`,
      referenciaId: resultado.id,
    });
  } catch (error) {
    console.error('[reviews] No se pudo avisar de la delegación:', error.message);
  }
  return { id: resultado.id, delegado_id: resultado.delegado_id, hasta: resultado.hasta };
}

/**
 * Revocar una delegación antes de que venza (solo quien administra el proyecto). Revocarla dos veces no cambia nada.
 *
 * @param {{id: number}} actor
 * @param {number|string} delegacionId
 * @returns {Promise<{id: number, revocada: true, yaTerminada: boolean}>}
 * @throws {ErrorApp} 403/404 por permisos o porque no existe.
 */
export async function revocar(actor, delegacionId) {
  const id = leerId(delegacionId, 'El identificador de la delegación no es válido.');
  const { rows: [delegacion] } = await consulta('SELECT id, proyecto_id FROM review_delegaciones WHERE id = $1', [id]);
  if (!delegacion) lanzar(404, MENSAJE_NO_ENCONTRADO);
  await exigirPermiso(actor, 'review.delegar', delegacion.proyecto_id);

  const resultado = await enTransaccion(async (cliente) => {
    const { rows: [fila] } = await cliente.query(
      `SELECT d.revocada_en, d.hasta, u.nombre AS delegado_nombre, d.delegado_id
         FROM review_delegaciones d JOIN usuarios u ON u.id = d.delegado_id WHERE d.id = $1 FOR UPDATE OF d`,
      [id],
    );
    const vencida = new Date(fila.hasta) <= new Date();
    if (fila.revocada_en || vencida) return { yaTerminada: true };
    await cliente.query('UPDATE review_delegaciones SET revocada_en = NOW(), revocada_por = $2 WHERE id = $1', [id, actor.id]);
    await registrarAuditoria(cliente, {
      usuarioId: actor.id,
      proyectoId: delegacion.proyecto_id,
      accion: ACCIONES.REVIEW_DELEGACION_REVOCADA,
      objeto: OBJETOS.REVIEW,
      objetoId: id,
      despues: { delegado_id: fila.delegado_id, delegado_nombre: fila.delegado_nombre },
    });
    return { yaTerminada: false, delegadoId: fila.delegado_id };
  });

  if (!resultado.yaTerminada) avisarCambio(delegacion.proyecto_id);
  return { id, revocada: true, yaTerminada: resultado.yaTerminada };
}
