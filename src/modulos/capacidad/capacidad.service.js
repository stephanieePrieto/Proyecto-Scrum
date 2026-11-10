// Responsable: Diego - HU-44: reglas, SQL y avisos por socket (horas por dia y ausencias)
/**
 * Aplicar las reglas de la capacidad individual: guardar horas por día y ausencias,
 * y calcular la capacidad del equipo en un sprint.
 *
 * Tablas (database/schema.sql): usuarios, miembros_equipo, capacidad_usuarios y ausencias.
 *
 * Permisos (no hay administrador global; el rol vive dentro de cada proyecto):
 *   - Ver o editar la capacidad de una persona: ella misma, o quien administra un equipo que comparten
 *     (creó el equipo o es Scrum Master de alguno de sus proyectos). El resto del equipo no ve la ajena.
 *   - Ver la capacidad de todo el equipo: solo quien lo administra (Scrum Master).
 *   - Capacidad de un proyecto por sprint: solo el Scrum Master del proyecto (permiso capacidad.equipo.ver).
 *
 * Los datos son reales (PostgreSQL). Solo con MODO_DEMO=true (pruebas automáticas) se usan los de capacidad.demo.js.
 */
import pool from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { esAdminEquipo, puedeVerEquipo, MENSAJE_NO_ENCONTRADO } from '../../utils/permisos.js';
import { esModoDemo, repo as repoDemo } from './capacidad.demo.js';
import { validarCapacidad, fusionarAusencias, capacidadEquipo, leerDia } from './capacidad.calculo.js';

/**
 * Representar un error con código HTTP para que el controller responda con el estado correcto.
 * Extiende ErrorApp, así que el manejador global también lo entiende.
 */
export class ErrorCapacidad extends ErrorApp {
  /**
   * @param {number} estado - Código HTTP (400, 403...).
   * @param {string} mensaje - Texto para mostrar al usuario.
   * @param {Array<{campo: string, mensaje: string}>} [errores] - Detalle por campo.
   */
  constructor(estado, mensaje, errores = []) {
    super(mensaje, estado);
    this.estado = estado;
    this.errores = errores;
  }
}

/**
 * Ejecutar una consulta SQL parametrizada y devolver sus filas.
 * Usar siempre parámetros ($1, $2...) para prevenir inyección SQL.
 *
 * @param {string} sql - Consulta con marcadores $1, $2...
 * @param {Array} [params] - Valores de los marcadores.
 * @returns {Promise<Array<Object>>} Filas resultantes.
 */
async function consultar(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Convertir una columna DATE a texto en SQL para evitar desfases por zona horaria.
 *
 * @param {string} columna - Nombre de la columna.
 * @returns {string} Expresión SQL.
 */
const fechaSql = (columna) => `to_char(${columna}, 'YYYY-MM-DD')`;

/**
 * Acceso a PostgreSQL. Expone la misma interfaz que el repositorio demo.
 */
const repoPg = {
  async obtenerPerfil(usuarioId) {
    const [fila] = await consultar(
      'SELECT horas_por_dia, notas FROM capacidad_usuarios WHERE usuario_id = $1',
      [usuarioId],
    );
    return fila ? { horasPorDia: Number(fila.horas_por_dia), notas: fila.notas ?? '' } : null;
  },

  async listarAusencias(usuarioId) {
    const filas = await consultar(
      `SELECT id, tipo, ${fechaSql('fecha_inicio')} AS "fechaInicio", ${fechaSql('fecha_fin')} AS "fechaFin"
         FROM ausencias
        WHERE usuario_id = $1
        ORDER BY fecha_inicio ASC`,
      [usuarioId],
    );
    return filas;
  },

  /**
   * Guardar perfil y ausencias en una sola transacción: o se guarda todo o nada.
   */
  async guardarTodo(usuarioId, { horasPorDia, notas, ausencias }) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(
        `INSERT INTO capacidad_usuarios (usuario_id, horas_por_dia, notas, actualizado_en)
              VALUES ($1, $2, $3, NOW())
         ON CONFLICT (usuario_id)
           DO UPDATE SET horas_por_dia = EXCLUDED.horas_por_dia, notas = EXCLUDED.notas, actualizado_en = NOW()`,
        [usuarioId, horasPorDia, notas],
      );
      await cliente.query('DELETE FROM ausencias WHERE usuario_id = $1', [usuarioId]);
      for (const a of ausencias) {
        await cliente.query(
          'INSERT INTO ausencias (usuario_id, tipo, fecha_inicio, fecha_fin) VALUES ($1, $2, $3::date, $4::date)',
          [usuarioId, a.tipo, a.fechaInicio, a.fechaFin],
        );
      }
      await cliente.query('COMMIT');
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }
  },

  async listarMiembros(equipoId, proyectoId = null) {
    const miembros = await consultar(
      `SELECT u.id AS "usuarioId", u.nombre, c.horas_por_dia
         FROM miembros_equipo em
         JOIN usuarios u ON u.id = em.usuario_id
    LEFT JOIN capacidad_usuarios c ON c.usuario_id = u.id
        WHERE em.equipo_id = $1 AND u.activo = TRUE
          AND ($2::int IS NULL OR EXISTS (SELECT 1 FROM miembros_proyecto mp WHERE mp.proyecto_id = $2 AND mp.usuario_id = u.id))
        ORDER BY u.nombre`,
      [equipoId, proyectoId],
    );
    if (miembros.length === 0) return [];

    // Traer todas las ausencias del equipo en una sola consulta
    const ausencias = await consultar(
      `SELECT usuario_id, tipo, ${fechaSql('fecha_inicio')} AS "fechaInicio", ${fechaSql('fecha_fin')} AS "fechaFin"
         FROM ausencias
        WHERE usuario_id = ANY($1::int[])`,
      [miembros.map((m) => m.usuarioId)],
    );
    return miembros.map((m) => ({
      usuarioId: m.usuarioId,
      nombre: m.nombre,
      horasPorDia: m.horas_por_dia === null ? null : Number(m.horas_por_dia),
      ausencias: ausencias.filter((a) => a.usuario_id === m.usuarioId),
    }));
  },
};

/**
 * Elegir el acceso a datos según el modo.
 *
 * @returns {typeof repoPg}
 */
const elegirRepo = () => (esModoDemo() ? repoDemo : repoPg);

/**
 * Obtener la capacidad guardada de una persona.
 * Devolver horasPorDia null cuando aún no la captura.
 *
 * @param {number} usuarioId
 * @returns {Promise<{usuarioId: number, horasPorDia: number|null, notas: string, ausencias: Array}>}
 */
export async function obtenerCapacidad(usuarioId) {
  const repo = elegirRepo();
  const [perfil, ausencias] = await Promise.all([repo.obtenerPerfil(usuarioId), repo.listarAusencias(usuarioId)]);
  return { usuarioId, horasPorDia: perfil?.horasPorDia ?? null, notas: perfil?.notas ?? '', ausencias };
}

/**
 * Indicar si el actor puede ver o editar la capacidad de una persona: la propia, o la de alguien
 * de un equipo que el actor administra (Scrum Master). En modo demo solo cuenta la propia (o el rol "Admin" de prueba).
 *
 * @param {{id: number, rol?: string}|null} actor - Usuario autenticado (req.user).
 * @param {number} usuarioId - Persona dueña de la capacidad.
 * @returns {Promise<boolean>}
 */
async function puedeAccederCapacidad(actor, usuarioId) {
  if (!actor) return esModoDemo();
  if (actor.id === usuarioId) return true;
  if (esModoDemo()) return actor.rol === 'Admin';
  const compartidos = await consultar(
    `SELECT a.equipo_id FROM miembros_equipo a JOIN miembros_equipo b ON b.equipo_id = a.equipo_id
      WHERE a.usuario_id = $1 AND b.usuario_id = $2`,
    [usuarioId, actor.id],
  );
  for (const { equipo_id: equipoId } of compartidos) {
    if (await esAdminEquipo(actor, equipoId)) return true;
  }
  return false;
}

/**
 * Guardar las horas por día, las notas y las ausencias de una persona.
 * Permitir editar solo a la propia persona o a quien administra su equipo. Validar los datos,
 * fusionar las ausencias que se traslapan y avisar cuántas se fusionaron.
 * Si no llegan horas (o notas) y ya había guardadas, se conservan.
 * En modo demo, aceptar peticiones sin sesión.
 *
 * @param {{id: number, rol?: string}|null} actor - Usuario autenticado (req.user).
 * @param {number} usuarioId - Persona cuya capacidad se guarda.
 * @param {Object} datos - { horasPorDia, notas, ausencias }.
 * @returns {Promise<Object>} Capacidad guardada más { fusionadas, mensaje }.
 * @throws {ErrorCapacidad} 403 sin permiso, 400 si los datos no son válidos.
 */
export async function guardarCapacidad(actor, usuarioId, datos = {}) {
  if (!(await puedeAccederCapacidad(actor, usuarioId))) {
    throw new ErrorCapacidad(403, 'Solo puedes editar tu propia capacidad.');
  }

  // La pantalla limpia sus campos tras guardar: un campo vacío conserva lo que ya estaba guardado
  const actual = await obtenerCapacidad(usuarioId);
  const sinHoras = datos.horasPorDia === undefined || datos.horasPorDia === null || String(datos.horasPorDia).trim() === '';
  const horasPorDia = sinHoras && actual.horasPorDia !== null ? actual.horasPorDia : datos.horasPorDia;

  const errores = validarCapacidad({ ...datos, horasPorDia });
  if (errores.length) throw new ErrorCapacidad(400, 'Revisa los campos marcados.', errores);

  const { ausencias, fusionadas } = fusionarAusencias(datos.ausencias ?? []);
  await elegirRepo().guardarTodo(usuarioId, {
    horasPorDia: Number(horasPorDia),
    notas: datos.notas?.trim() || actual.notas || null,
    ausencias,
  });

  return {
    ...(await obtenerCapacidad(usuarioId)),
    fusionadas,
    mensaje: fusionadas > 0
      ? `Guardado. Fusionamos ${fusionadas} ${fusionadas === 1 ? 'ausencia que se traslapaba' : 'ausencias que se traslapaban'}.`
      : 'Capacidad guardada.',
  };
}

/**
 * Consultar la capacidad de una persona comprobando que el actor puede verla (lo usa la ruta):
 * la propia, o la de su equipo si es Scrum Master.
 *
 * @param {{id: number}|null} actor
 * @param {number} usuarioId
 * @returns {Promise<Object>}
 * @throws {ErrorCapacidad} 403 si no es la propia y el actor no administra el equipo.
 */
export async function verCapacidad(actor, usuarioId) {
  if (!(await puedeAccederCapacidad(actor, usuarioId))) {
    throw new ErrorCapacidad(403, 'Solo puedes ver tu propia capacidad.');
  }
  return obtenerCapacidad(usuarioId);
}

/**
 * Consultar la capacidad de un equipo comprobando que el actor lo administra (Scrum Master). Lo usa la ruta
 * y la pantalla de sprints al planificar. Responde 404 si no pertenece al equipo, para no revelar que existe (HU-43),
 * y 403 si es integrante pero no lo administra.
 *
 * @param {{id: number}|null} actor
 * @param {number} equipoId
 * @param {{inicio: string, fin: string}} rango
 * @returns {Promise<Object>}
 */
export async function verCapacidadEquipo(actor, equipoId, rango) {
  if (!esModoDemo() && !(await esAdminEquipo(actor, equipoId))) {
    if (!(await puedeVerEquipo(actor, equipoId))) throw new ErrorCapacidad(404, MENSAJE_NO_ENCONTRADO);
    throw new ErrorCapacidad(403, 'Solo el Scrum Master puede ver la capacidad del equipo.');
  }
  return obtenerCapacidadEquipo(equipoId, rango);
}

/**
 * Datos de la sesión para la pantalla: quién es la persona y a qué equipos pertenece.
 * Sustituye lo que antes se leía de localStorage ("usuario", "equipoActivo").
 *
 * @param {{id: number}|null} actor
 * @returns {Promise<{usuario: {id: number, nombre: string}, equipos: Array<{id: number, nombre: string}>}>}
 */
export async function contextoActual(actor) {
  if (!actor && esModoDemo()) {
    return { usuario: { id: 1, nombre: 'Laura Méndez' }, equipos: [{ id: 1, nombre: 'Equipo demo' }] };
  }
  const [usuario] = await consultar('SELECT id, nombre FROM usuarios WHERE id = $1 AND activo = TRUE', [actor?.id]);
  if (!usuario) throw new ErrorCapacidad(401, 'Tu cuenta ya no está activa. Inicia sesión de nuevo.');
  const equipos = await consultar(
    `SELECT e.id, e.nombre FROM equipos e JOIN miembros_equipo m ON m.equipo_id = e.id
      WHERE m.usuario_id = $1 ORDER BY e.nombre`,
    [actor.id],
  );
  return { usuario, equipos };
}

/**
 * Calcular la capacidad total de un equipo dentro de un rango de fechas (un sprint).
 * Recalcular en cada consulta, de modo que cualquier cambio en horas o ausencias se refleje al instante.
 *
 * @param {number} equipoId
 * @param {{inicio: string, fin: string}} sprint - Fechas "AAAA-MM-DD".
 * @param {number|null} [proyectoId] - Si se indica, solo cuentan los integrantes de ese proyecto.
 * @returns {Promise<{miembros: Array, totalHoras: number, sinCapacidad: boolean}>}
 * @throws {ErrorCapacidad} 400 si las fechas no son válidas.
 */
export async function obtenerCapacidadEquipo(equipoId, sprint, proyectoId = null) {
  const inicio = leerDia(sprint?.inicio);
  const fin = leerDia(sprint?.fin);
  if (inicio === null || fin === null || fin < inicio) {
    throw new ErrorCapacidad(400, 'Indica un rango de fechas válido (inicio y fin).');
  }
  const miembros = await elegirRepo().listarMiembros(equipoId, proyectoId);
  return capacidadEquipo(miembros, sprint);
}

/**
 * Capacidad del equipo de un proyecto en un sprint (la ruta ya comprobó el permiso capacidad.equipo.ver).
 * Las fechas salen del propio sprint, así que la pantalla solo elige el sprint. Sin sprint indicado se
 * propone el activo, si no el siguiente planificado y, si no, el último.
 *
 * @param {number} proyectoId
 * @param {number|null} [sprintId] - Sprint elegido; si es null se propone uno.
 * @returns {Promise<{sprints: Array, sprint: Object|null, capacidad: Object|null}>}
 * @throws {ErrorCapacidad} 404 si el sprint no existe en el proyecto.
 */
export async function obtenerCapacidadPorSprint(proyectoId, sprintId = null) {
  const sprints = await consultar(
    `SELECT id, nombre, estado, ${fechaSql('fecha_inicio')} AS "fechaInicio", ${fechaSql('fecha_fin')} AS "fechaFin"
       FROM sprints WHERE proyecto_id = $1 ORDER BY fecha_inicio, id`,
    [proyectoId],
  );
  const sprint = sprintId
    ? sprints.find((s) => s.id === sprintId)
    : sprints.find((s) => s.estado === 'activo') ?? sprints.find((s) => s.estado === 'planificado') ?? sprints.at(-1);
  if (sprintId && !sprint) throw new ErrorCapacidad(404, MENSAJE_NO_ENCONTRADO);
  if (!sprint) return { sprints, sprint: null, capacidad: null };

  const [proyecto] = await consultar('SELECT equipo_id FROM proyectos WHERE id = $1', [proyectoId]);
  const capacidad = await obtenerCapacidadEquipo(proyecto.equipo_id, { inicio: sprint.fechaInicio, fin: sprint.fechaFin }, proyectoId);
  return { sprints, sprint, capacidad };
}

