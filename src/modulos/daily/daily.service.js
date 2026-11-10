// Responsable: Diego - HU-10: reglas, SQL y avisos por socket (Daily Scrum)
/**
 * HU-10 · Registrar Daily Scrum.
 *
 * Tablas que usa (database/schema.sql): dailies, daily_tareas, sprints, tareas, columnas_tablero,
 * miembros_proyecto, usuarios, ausencias y eventos_calendario.
 *
 * Decisiones importantes:
 *  - Hay UNA Daily por sprint, persona y día (UNIQUE en la tabla). Volver a guardar el mismo día
 *    edita el registro con INSERT ... ON CONFLICT, así nunca se duplica aunque se guarde desde dos pestañas.
 *  - "Hoy" y la hora de corte se calculan en la zona horaria de la persona (usuarios.zona_horaria).
 *  - Un registro es "tarde" si se CREA después de que terminó la Daily del calendario (HU-15) o,
 *    si no hay evento ese día, después de HORA_CORTE_DEFECTO. Editarlo luego no cambia la marca.
 *  - Los días anteriores solo se consultan (solo lectura); no se puede registrar en el pasado.
 *  - Quien tiene una ausencia ese día y no registró aparece "ausente", sin penalización.
 *  - Solo el Scrum Master (permiso daily.equipo.ver) ve la Daily del resto del equipo; los demás solo
 *    reciben su propio registro. Los chips de tareas solo ofrecen las tareas asignadas a quien registra.
 *
 * @author Diego Rafael Jimenez Trujano
 * @author Citlaly Morales Viveros
 */
import { consulta, pool } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto } from '../../sockets/emisor.js';
import { exigirPermiso, tienePermiso } from '../../utils/permisos.js';
import {
  HORA_CORTE_DEFECTO,
  esFechaValida,
  validarDaily,
  esTarde,
  estadoIntegrante,
  resumenEstados,
} from './daily.reglas.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = {
  registrada: 'daily:registrada',
};

const ZONA_POR_DEFECTO = 'America/Mexico_City';

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver daily.controller.js).
 */
function lanzar(estado, mensaje, detalles) {
  const error = new ErrorApp(mensaje, estado);
  if (detalles) error.detalles = detalles;
  throw error;
}

/**
 * Convertir el identificador del proyecto recibido en la ruta a un entero positivo.
 *
 * @param {*} valor - Valor sin confiar.
 * @returns {number}
 * @throws {ErrorApp} 400 si no es un entero positivo válido.
 */
function leerProyectoId(valor) {
  const numero = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? NaN : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > ENTERO_MAXIMO) {
    lanzar(400, 'El identificador del proyecto no es válido.');
  }
  return numero;
}

/**
 * Obtener el sprint activo del proyecto (como mucho hay uno: índice único en la tabla).
 *
 * @param {number} proyectoId
 * @returns {Promise<{id: number, nombre: string, objetivo: string|null, fecha_inicio: string, fecha_fin: string}|null>}
 */
async function sprintActivo(proyectoId) {
  const { rows } = await consulta(
    `SELECT id, nombre, objetivo, to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
       FROM sprints WHERE proyecto_id = $1 AND estado = 'activo'`,
    [proyectoId],
  );
  return rows[0] ?? null;
}

/**
 * Leer la fecha y la hora locales de la persona. Si su zona guardada no existe en PostgreSQL,
 * usar la zona por defecto en lugar de fallar.
 *
 * @param {number} usuarioId
 * @returns {Promise<{nombre: string, zona: string, hoy: string, hora: string}>} `hoy` "AAAA-MM-DD" y `hora` "HH:MM".
 */
export async function relojDe(usuarioId) {
  const { rows: [usuario] } = await consulta('SELECT nombre, zona_horaria FROM usuarios WHERE id = $1', [usuarioId]);
  const leer = async (zona) => {
    const { rows } = await consulta(
      `SELECT to_char(NOW() AT TIME ZONE $1, 'YYYY-MM-DD') AS hoy, to_char(NOW() AT TIME ZONE $1, 'HH24:MI') AS hora`,
      [zona],
    );
    return rows[0];
  };
  let zona = usuario?.zona_horaria || ZONA_POR_DEFECTO;
  let reloj;
  try {
    reloj = await leer(zona);
  } catch {
    zona = ZONA_POR_DEFECTO;
    reloj = await leer(zona);
  }
  return { nombre: usuario?.nombre ?? '', zona, ...reloj };
}

/**
 * Buscar cuándo termina la Daily del calendario para ese día (HU-15), si ya está programada.
 *
 * @param {number} sprintId
 * @param {string} fecha - "AAAA-MM-DD" en la zona de la persona.
 * @param {string} zona
 * @returns {Promise<{terminaEn: Date, hora: string}|null>}
 */
async function eventoDaily(sprintId, fecha, zona) {
  const { rows } = await consulta(
    `SELECT termina_en, to_char(termina_en AT TIME ZONE $3, 'HH24:MI') AS hora
       FROM eventos_calendario
      WHERE sprint_id = $1 AND tipo = 'daily' AND (inicia_en AT TIME ZONE $3)::date = $2::date
      ORDER BY inicia_en LIMIT 1`,
    [sprintId, fecha, zona],
  );
  return rows[0] ? { terminaEn: rows[0].termina_en, hora: rows[0].hora } : null;
}

/**
 * Consultar la Daily del equipo en un día: quién está registrado, tarde, ausente o pendiente.
 *
 * @param {{id: number}} actor - Usuario autenticado.
 * @param {number|string} proyectoId
 * @param {string} [fechaTexto] - "AAAA-MM-DD"; si no viene, hoy.
 * @returns {Promise<Object>} Ver docs/hu-10-11-daily-impedimentos.md.
 */
export async function consultar(actor, proyectoId, fechaTexto) {
  // Sin vínculo vigente con el proyecto responde 404, igual que si no existiera
  await exigirPermiso(actor, 'proyecto.ver', leerProyectoId(proyectoId));
  const reloj = await relojDe(actor.id);
  const fecha = fechaTexto || reloj.hoy;
  if (!esFechaValida(fecha)) lanzar(400, 'La fecha no es válida. Usa el formato AAAA-MM-DD.');
  if (fecha > reloj.hoy) lanzar(400, 'Todavía no hay Daily para una fecha futura.');

  const base = { fecha, hoy: reloj.hoy, soloLectura: fecha < reloj.hoy, horaCorte: HORA_CORTE_DEFECTO };
  const sprint = await sprintActivo(proyectoId);
  if (!sprint) {
    return { ...base, sprint: null, soloLectura: true, puedeRegistrar: false, verEquipo: false, miembros: [], resumen: resumenEstados([]), tareas: [] };
  }

  // Solo el Scrum Master ve a todo el equipo; el resto únicamente su propio registro
  const verEquipo = await tienePermiso(actor, 'daily.equipo.ver', Number(proyectoId));
  const { rows: integrantes } = await consulta(
    `SELECT u.id, u.nombre, mp.rol
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
       JOIN proyectos p ON p.id = mp.proyecto_id
       JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND u.activo = TRUE AND ($2::boolean OR u.id = $3)
      ORDER BY u.nombre`,
    [proyectoId, verEquipo, actor.id],
  );
  const ids = integrantes.map((i) => i.id);

  const [{ rows: dailies }, { rows: ausentes }, corte] = await Promise.all([
    consulta(
      `SELECT id, usuario_id, ayer, hoy, impedimentos, tardio, actualizado_en
         FROM dailies WHERE sprint_id = $1 AND fecha = $2::date`,
      [sprint.id, fecha],
    ),
    consulta(
      `SELECT DISTINCT usuario_id FROM ausencias
        WHERE usuario_id = ANY($1::int[]) AND $2::date BETWEEN fecha_inicio AND fecha_fin`,
      [ids, fecha],
    ),
    eventoDaily(sprint.id, fecha, reloj.zona),
  ]);

  const { rows: vinculadas } = dailies.length
    ? await consulta(
      `SELECT dt.daily_id, t.id, t.titulo
         FROM daily_tareas dt JOIN tareas t ON t.id = dt.tarea_id
        WHERE dt.daily_id = ANY($1::int[]) ORDER BY t.titulo`,
      [dailies.map((d) => d.id)],
    )
    : { rows: [] };

  const ausentesSet = new Set(ausentes.map((a) => a.usuario_id));
  const miembros = integrantes.map((i) => {
    const fila = dailies.find((d) => d.usuario_id === i.id);
    const daily = fila
      ? {
        id: fila.id,
        ayer: fila.ayer ?? '',
        hoy: fila.hoy ?? '',
        impedimentos: fila.impedimentos ?? '',
        tardio: fila.tardio,
        actualizadoEn: fila.actualizado_en,
        tareas: vinculadas.filter((v) => v.daily_id === fila.id).map((v) => ({ id: v.id, titulo: v.titulo })),
      }
      : null;
    return {
      usuarioId: i.id,
      nombre: i.nombre,
      rol: i.rol,
      ausente: ausentesSet.has(i.id),
      estado: estadoIntegrante({ daily, ausente: ausentesSet.has(i.id) }),
      daily,
    };
  });

  const yo = integrantes.find((i) => i.id === actor.id);
  const puedeRegistrar = Boolean(yo) && !base.soloLectura;

  // Chips de tareas: solo las que tiene asignadas quien registra; únicamente si puede editar
  let tareas = [];
  if (puedeRegistrar) {
    const { rows } = await consulta(
      `SELECT t.id, t.titulo, c.nombre AS columna
         FROM tareas t LEFT JOIN columnas_tablero c ON c.id = t.columna_id
        WHERE t.sprint_id = $1 AND t.responsable_id = $2
        ORDER BY c.orden NULLS LAST, t.orden, t.id`,
      [sprint.id, actor.id],
    );
    tareas = rows.map((t) => ({ id: t.id, titulo: t.titulo, columna: t.columna ?? '' }));
  }

  return {
    ...base,
    horaCorte: corte?.hora ?? HORA_CORTE_DEFECTO,
    corteDelCalendario: Boolean(corte),
    sprint: { id: sprint.id, nombre: sprint.nombre, objetivo: sprint.objetivo },
    yo: { id: actor.id, nombre: reloj.nombre, rol: yo?.rol ?? null },
    puedeRegistrar,
    verEquipo,
    miembros,
    resumen: resumenEstados(miembros),
    tareas,
  };
}

/**
 * Registrar (o editar) la Daily de HOY de la persona autenticada.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{ayer: string, hoy: string, impedimentos?: string, tareas?: number[]}} datos
 * @returns {Promise<{creado: boolean, tardio: boolean, mensaje: string}>}
 * @throws {ErrorApp} 400 datos inválidos, 409 sin sprint activo.
 */
export async function guardar(actor, proyectoId, datos) {
  await exigirPermiso(actor, 'daily.registrar', leerProyectoId(proyectoId));
  const { errores, valores } = validarDaily(datos);
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const sprint = await sprintActivo(proyectoId);
  if (!sprint) lanzar(409, 'No hay un sprint activo: la Daily se registra cuando el sprint está en curso.');

  const reloj = await relojDe(actor.id);

  if (valores.tareas.length) {
    const { rows } = await consulta(
      'SELECT id FROM tareas WHERE id = ANY($1::int[]) AND sprint_id = $2 AND responsable_id = $3',
      [valores.tareas, sprint.id, actor.id],
    );
    if (rows.length !== valores.tareas.length) {
      lanzar(400, 'Revisa los campos marcados.', { tareas: 'Solo puedes vincular tus tareas asignadas del sprint activo.' });
    }
  }

  const corte = await eventoDaily(sprint.id, reloj.hoy, reloj.zona);
  const tardio = esTarde({ ahora: new Date(), terminaEn: corte?.terminaEn ?? null, horaLocal: reloj.hora });

  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    const { rows: [fila] } = await cliente.query(
      `INSERT INTO dailies (sprint_id, usuario_id, fecha, ayer, hoy, impedimentos, tardio)
            VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (sprint_id, usuario_id, fecha) DO UPDATE
         SET ayer = EXCLUDED.ayer, hoy = EXCLUDED.hoy, impedimentos = EXCLUDED.impedimentos, actualizado_en = NOW()
       RETURNING id, tardio, (xmax = 0) AS creado`,
      [sprint.id, actor.id, reloj.hoy, valores.ayer, valores.hoy, valores.impedimentos, tardio],
    );
    await cliente.query('DELETE FROM daily_tareas WHERE daily_id = $1', [fila.id]);
    if (valores.tareas.length) {
      await cliente.query(
        'INSERT INTO daily_tareas (daily_id, tarea_id) SELECT $1, UNNEST($2::int[])',
        [fila.id, valores.tareas],
      );
    }
    await cliente.query('COMMIT');
    resultado = fila;
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  emitirAProyecto(Number(proyectoId), EVENTOS.registrada, {
    proyecto_id: Number(proyectoId),
    usuario_id: actor.id,
    fecha: reloj.hoy,
    estado: resultado.tardio ? 'tarde' : 'registrado',
  });

  return {
    creado: resultado.creado,
    tardio: resultado.tardio,
    mensaje: `${resultado.creado ? 'Daily registrado.' : 'Daily actualizado.'}${resultado.tardio ? ' Quedó marcado como tarde.' : ''}`,
  };
}