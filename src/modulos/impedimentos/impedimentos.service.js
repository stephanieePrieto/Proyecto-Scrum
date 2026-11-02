// Responsable: Diego - HU-11: reglas, SQL y avisos por socket (impedimentos)
/**
 * HU-11 · Gestionar impedimentos.
 *
 * Tablas que usa (database/schema.sql): impedimentos, tareas, sprints, miembros_proyecto, usuarios
 * y notificaciones.
 *
 * Decisiones importantes:
 *  - "Cuánto estuvo abierto" no se guarda en una columna aparte: es resuelto_en - creado_en,
 *    y la API lo devuelve ya calculado en `horas_abierto`.
 *  - Resolver es una sola sentencia UPDATE ... WHERE estado = 'abierto'. Si dos personas resuelven
 *    a la vez, PostgreSQL deja pasar a una y la otra recibe 409 "Ya fue resuelto por X".
 *  - Si el responsable ya no es un integrante activo del proyecto (se dio de baja o lo quitaron),
 *    el impedimento abierto pasa al Scrum Master y se le avisa. Se revisa cada vez que se consulta
 *    la lista y también se puede llamar con reasignarDeBaja(proyectoId) desde otro módulo.
 * 
 * @author Diego Rafael Jimenez Trujano
 * @author Citlaly Morales Viveros
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { emitirAProyecto, emitirAUsuario } from '../../sockets/emisor.js';
import { exigirPermiso, obtenerRolProyecto, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import {
  SEVERIDADES,
  DIAS_PARA_ALERTA,
  validarImpedimento,
  mensajeYaResuelto,
} from './impedimentos.reglas.js';

/** Nombres de los eventos en tiempo real (el cliente de la pantalla los escucha). */
export const EVENTOS = {
  creado: 'impedimento:creado',
  resuelto: 'impedimento:resuelto',
  reasignado: 'impedimento:reasignado',
  aviso: 'impedimento:aviso',
};

const ESTADOS_FILTRO = ['abierto', 'resuelto', 'todos'];

/** Valor máximo de una columna INTEGER de PostgreSQL. */
const ENTERO_MAXIMO = 2147483647;

/**
 * Lanzar un ErrorApp. `detalles` viaja al navegador (ver impedimentos.controller.js).
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
 * @param {string} mensaje - Mensaje del error 400 cuando el valor no es válido.
 * @returns {number}
 * @throws {ErrorApp} 400 si no es un entero positivo válido.
 */
function leerId(valor, mensaje) {
  const numero = typeof valor === 'string' && !/^\d+$/.test(valor.trim()) ? NaN : Number(valor);
  if (!Number.isInteger(numero) || numero <= 0 || numero > ENTERO_MAXIMO) lanzar(400, mensaje);
  return numero;
}

/** Consulta base: un impedimento con los nombres que necesita la pantalla. */
const SELECT_IMPEDIMENTO = `
  SELECT i.id, i.proyecto_id, i.sprint_id, i.titulo, i.severidad, i.estado,
         i.tarea_id, t.titulo AS tarea_titulo,
         i.responsable_id, r.nombre AS responsable_nombre, (r.activo IS FALSE) AS responsable_inactivo,
         i.creado_por, c.nombre AS creado_por_nombre,
         i.resuelto_por, x.nombre AS resuelto_por_nombre,
         i.creado_en, i.resuelto_en,
         ROUND((EXTRACT(EPOCH FROM (COALESCE(i.resuelto_en, NOW()) - i.creado_en)) / 3600.0)::numeric, 1)::float AS horas_abierto,
         (i.estado = 'abierto' AND NOW() - i.creado_en > INTERVAL '${DIAS_PARA_ALERTA} days') AS vencido
    FROM impedimentos i
    LEFT JOIN tareas t ON t.id = i.tarea_id
    LEFT JOIN usuarios r ON r.id = i.responsable_id
    LEFT JOIN usuarios c ON c.id = i.creado_por
    LEFT JOIN usuarios x ON x.id = i.resuelto_por`;

/**
 * Obtener un impedimento por id con sus nombres.
 *
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function obtenerUno(id) {
  const { rows } = await consulta(`${SELECT_IMPEDIMENTO} WHERE i.id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Guardar un aviso en la tabla notificaciones y empujarlo por socket a la persona.
 * Un fallo aquí nunca debe romper la acción principal, por eso solo se registra en consola.
 *
 * @param {number} usuarioId - Quien recibe el aviso.
 * @param {string} tipo
 * @param {string} titulo
 * @param {string} mensaje
 * @param {string} enlace
 * @returns {Promise<void>}
 */
async function avisar(usuarioId, tipo, titulo, mensaje, enlace) {
  try {
    const { rows: [aviso] } = await consulta(
      `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id, usuario_id, tipo, titulo, mensaje, enlace, leida, creado_en`,
      [usuarioId, tipo, titulo, mensaje, enlace],
    );
    emitirAUsuario(usuarioId, EVENTOS.aviso, aviso);
  } catch (error) {
    console.error('[impedimentos] No se pudo guardar el aviso:', error.message);
  }
}

/**
 * Pasar al Scrum Master los impedimentos abiertos cuyo responsable ya no es un integrante activo
 * del proyecto (dado de baja, desactivado o retirado), y avisarle.
 * Es seguro llamarla varias veces o desde varias peticiones a la vez: la fila se bloquea y,
 * una vez reasignada, ya no cumple la condición.
 *
 * @param {number} proyectoId
 * @returns {Promise<number>} Cuántos impedimentos se reasignaron.
 */
export async function reasignarDeBaja(proyectoId) {
  // Tanto el Scrum Master elegido como el responsable deben seguir en el equipo dueño del proyecto
  const { rows } = await consulta(
    `WITH sm AS (
       SELECT mp.usuario_id
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND mp.rol = 'scrum_master' AND u.activo = TRUE
        ORDER BY mp.usuario_id LIMIT 1
     ), huerfanos AS (
       SELECT i.id
         FROM impedimentos i
        WHERE i.proyecto_id = $1 AND i.estado = 'abierto'
          AND EXISTS (SELECT 1 FROM sm)
          AND NOT EXISTS (
            SELECT 1
              FROM miembros_proyecto mp
              JOIN usuarios u ON u.id = mp.usuario_id
              JOIN proyectos p ON p.id = mp.proyecto_id
              JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
             WHERE mp.proyecto_id = i.proyecto_id AND mp.usuario_id = i.responsable_id AND u.activo = TRUE)
          FOR UPDATE OF i
     )
     UPDATE impedimentos i SET responsable_id = (SELECT usuario_id FROM sm)
       FROM huerfanos h WHERE i.id = h.id
     RETURNING i.id, i.titulo, i.responsable_id`,
    [proyectoId],
  );

  for (const fila of rows) {
    await avisar(
      fila.responsable_id,
      'impedimento_reasignado',
      'Impedimento a tu cargo',
      `El impedimento «${fila.titulo}» quedó a tu cargo porque su responsable fue dado de baja.`,
      `/pages/impedimentos.html?proyecto=${proyectoId}`,
    );
    emitirAProyecto(proyectoId, EVENTOS.reasignado, {
      proyecto_id: proyectoId,
      impedimento_id: fila.id,
      responsable_id: fila.responsable_id,
    });
  }
  return rows.length;
}

/**
 * Listar los impedimentos del proyecto con lo que necesita la pantalla para registrar uno nuevo
 * (integrantes y tareas del sprint activo).
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{estado?: string, severidad?: string}} [filtros]
 * @returns {Promise<Object>} Ver docs/hu-10-11-daily-impedimentos.md.
 */
export async function listar(actor, proyectoId, { estado = 'todos', severidad = '' } = {}) {
  // Sin vínculo vigente con el proyecto responde 404, igual que si no existiera
  const rolActor = await exigirPermiso(
    actor,
    'proyecto.ver',
    leerId(proyectoId, 'El identificador del proyecto no es válido.'),
  );

  if (!ESTADOS_FILTRO.includes(estado)) lanzar(400, 'El estado no es válido. Usa abierto, resuelto o todos.');
  if (severidad && !SEVERIDADES.includes(severidad)) lanzar(400, 'La severidad no es válida. Usa baja, media o alta.');

  // Antes de listar, pasar al Scrum Master lo que quedó sin responsable. Si falla, la lista igual se muestra.
  try {
    await reasignarDeBaja(Number(proyectoId));
  } catch (error) {
    console.error('[impedimentos] No se pudo revisar las bajas:', error.message);
  }

  const condiciones = ['i.proyecto_id = $1'];
  const params = [proyectoId];
  if (estado !== 'todos') {
    params.push(estado);
    condiciones.push(`i.estado = $${params.length}`);
  }
  if (severidad) {
    params.push(severidad);
    condiciones.push(`i.severidad = $${params.length}`);
  }

  const [{ rows: impedimentos }, { rows: [conteo] }, { rows: miembros }, { rows: tareas }, { rows: [yo] }] = await Promise.all([
    consulta(
      `${SELECT_IMPEDIMENTO}
        WHERE ${condiciones.join(' AND ')}
        ORDER BY (i.estado = 'abierto') DESC,
                 CASE WHEN i.estado = 'abierto' THEN CASE i.severidad WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END END,
                 i.resuelto_en DESC NULLS LAST, i.creado_en ASC`,
      params,
    ),
    consulta(
      `SELECT COUNT(*) FILTER (WHERE estado = 'abierto')::int AS abiertos,
              COUNT(*) FILTER (WHERE estado = 'abierto' AND NOW() - creado_en > INTERVAL '${DIAS_PARA_ALERTA} days')::int AS vencidos,
              COUNT(*) FILTER (WHERE estado = 'resuelto')::int AS resueltos
         FROM impedimentos WHERE proyecto_id = $1`,
      [proyectoId],
    ),
    consulta(
      `SELECT u.id, u.nombre, mp.rol
         FROM miembros_proyecto mp
         JOIN usuarios u ON u.id = mp.usuario_id
         JOIN proyectos p ON p.id = mp.proyecto_id
         JOIN miembros_equipo me ON me.equipo_id = p.equipo_id AND me.usuario_id = mp.usuario_id
        WHERE mp.proyecto_id = $1 AND u.activo = TRUE ORDER BY u.nombre`,
      [proyectoId],
    ),
    consulta(
      `SELECT t.id, t.titulo
         FROM tareas t JOIN sprints s ON s.id = t.sprint_id
        WHERE t.proyecto_id = $1 AND s.estado = 'activo' ORDER BY t.titulo`,
      [proyectoId],
    ),
    // El rol de la persona ya viene validado contra el equipo en exigirPermiso (rolActor)
    consulta('SELECT u.id, u.nombre FROM usuarios u WHERE u.id = $1', [actor.id]),
  ]);

  return {
    impedimentos,
    resumen: conteo,
    miembros,
    tareas,
    yo: { ...(yo ?? { id: actor.id, nombre: '' }), rol: rolActor },
    diasParaAlerta: DIAS_PARA_ALERTA,
  };
}

/**
 * Registrar un impedimento nuevo (queda "abierto") y avisar al responsable.
 *
 * @param {{id: number}} actor
 * @param {number|string} proyectoId
 * @param {{titulo: string, severidad?: string, responsable_id: number, tarea_id?: number|null}} datos
 * @returns {Promise<Object>} El impedimento creado.
 * @throws {ErrorApp} 400 con `detalles` por campo si falta el título o el responsable, o no son válidos.
 */
export async function crear(actor, proyectoId, datos) {
  // Quien no tiene vínculo con el proyecto recibe 404; quien lo tiene pero no su rol alcanza, 403
  const idProyecto = leerId(proyectoId, 'El identificador del proyecto no es válido.');
  await exigirPermiso(actor, 'impedimento.gestionar', idProyecto);

  const { errores, valores } = validarImpedimento(datos);

  if (!errores.responsable_id) {
    // El responsable debe tener rol en el proyecto y seguir en el equipo dueño del proyecto
    const rolResponsable = await obtenerRolProyecto({ id: valores.responsable_id }, idProyecto);
    if (!rolResponsable) errores.responsable_id = 'El responsable debe ser un integrante activo del proyecto.';
  }
  if (valores.tarea_id && !errores.tarea_id) {
    const { rows } = await consulta('SELECT 1 FROM tareas WHERE id = $1 AND proyecto_id = $2', [valores.tarea_id, proyectoId]);
    if (!rows.length) errores.tarea_id = 'La tarea elegida no pertenece a este proyecto.';
  }
  if (Object.keys(errores).length) lanzar(400, 'Revisa los campos marcados.', errores);

  const { rows: [sprint] } = await consulta("SELECT id FROM sprints WHERE proyecto_id = $1 AND estado = 'activo'", [proyectoId]);
  const { rows: [nuevo] } = await consulta(
    `INSERT INTO impedimentos (proyecto_id, sprint_id, tarea_id, titulo, severidad, responsable_id, creado_por)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [proyectoId, sprint?.id ?? null, valores.tarea_id, valores.titulo, valores.severidad, valores.responsable_id, actor.id],
  );

  const impedimento = await obtenerUno(nuevo.id);
  emitirAProyecto(Number(proyectoId), EVENTOS.creado, { proyecto_id: Number(proyectoId), impedimento });

  if (valores.responsable_id !== actor.id) {
    await avisar(
      valores.responsable_id,
      'impedimento_asignado',
      'Nuevo impedimento asignado',
      `Te asignaron el impedimento «${valores.titulo}».`,
      `/pages/impedimentos.html?proyecto=${proyectoId}`,
    );
  }
  return impedimento;
}

/**
 * Marcar un impedimento como resuelto y guardar quién y cuándo (de ahí sale cuánto estuvo abierto).
 * Si otra persona lo resolvió primero, responde 409 con "Ya fue resuelto por X".
 *
 * @param {{id: number}} actor
 * @param {number|string} id - Identificador del impedimento.
 * @returns {Promise<Object>} El impedimento ya resuelto.
 * @throws {ErrorApp} 404 si no existe; 409 si ya estaba resuelto.
 */
export async function resolver(actor, id) {
  const impedimentoId = leerId(id, 'El identificador del impedimento no es válido.');

  // El proyecto se obtiene del propio impedimento: quien no tiene vínculo con él recibe el mismo 404 que si no existiera
  const { rows: [dueno] } = await consulta('SELECT proyecto_id FROM impedimentos WHERE id = $1', [impedimentoId]);
  if (!dueno) lanzar(404, MENSAJE_NO_ENCONTRADO);
  await exigirPermiso(actor, 'impedimento.gestionar', dueno.proyecto_id);

  const { rows: [afectado] } = await consulta(
    `UPDATE impedimentos SET estado = 'resuelto', resuelto_por = $2, resuelto_en = NOW()
      WHERE id = $1 AND estado = 'abierto' RETURNING id, proyecto_id`,
    [impedimentoId, actor.id],
  );

  if (!afectado) {
    const existente = await obtenerUno(impedimentoId);
    if (!existente) lanzar(404, MENSAJE_NO_ENCONTRADO);
    lanzar(409, mensajeYaResuelto(existente.resuelto_por_nombre), {
      resuelto_por: existente.resuelto_por_nombre ?? null,
      resuelto_en: existente.resuelto_en,
    });
  }

  const impedimento = await obtenerUno(afectado.id);
  emitirAProyecto(afectado.proyecto_id, EVENTOS.resuelto, { proyecto_id: afectado.proyecto_id, impedimento });
  return impedimento;
}