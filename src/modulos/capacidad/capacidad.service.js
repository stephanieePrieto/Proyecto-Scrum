// Responsable: Diego - HU-44: reglas, SQL y avisos por socket (horas por dia y ausencias)

/**
 * Aplicar las reglas de la capacidad individual: guardar horas por día y ausencias,
 * y calcular la capacidad del equipo en un sprint.
 *
 * SUPUESTOS (ajustar nombres de tablas y columnas a database/schema.sql):
 *   usuarios              (id, nombre)
 *   equipo_miembros     (equipo_id, usuario_id)
 *   capacidad_usuarios  (usuario_id PK, horas_por_dia NUMERIC, notas TEXT, actualizado_en)
 *   ausencias           (id, usuario_id, tipo TEXT 'ausencia'|'vacaciones', fecha_inicio DATE, fecha_fin DATE)
 * Las dos últimas están en database/capacidad.sql.
 *
 * SUPUESTO DE DRIVER: librería "pg". config/db.js debe exportar un Pool (CommonJS):
 *   module.exports = new Pool({ connectionString: process.env.DATABASE_URL });
 * Con pg, db.query(sql, params) devuelve { rows } y los marcadores son $1, $2, ...
 *
 * MODO DEMO: si no hay DATABASE_URL (o MODO_DEMO=true) usar los datos de capacidad.demo.js.
 */

import { esModoDemo, repo as repoDemo } from './capacidad.demo.js';
import {
  validarCapacidad,
  fusionarAusencias,
  capacidadEquipo,
  leerDia,
} from './capacidad.calculo.js';

/**
 * Representar un error con código HTTP para que el controller responda con el estado correcto.
 */
class ErrorCapacidad extends Error {
  /**
   * @param {number} estado Código HTTP (400, 403...).
   * @param {string} mensaje Texto para mostrar al usuario.
   * @param {Array<{campo: string, mensaje: string}>} [errores] Detalle por campo.
   */
  constructor(estado, mensaje, errores = []) {
    super(mensaje);
    this.estado = estado;
    this.errores = errores;
  }
}

// Guardar el pool de conexiones una vez cargado (carga diferida)
let db;

/**
 * Obtener el pool de conexiones a PostgreSQL cargando config/db.js solo cuando se necesita.
 * Evitar así que el modo demo dependa de ese archivo.
 *
 * @returns {Promise<import('pg').Pool>} Pool de conexiones.
 */
async function obtenerDb() {
  if (!db) {
    const modulo = await import('../../config/db.js');
    db = modulo.default || modulo;
  }
  return db;
}

/**
 * Ejecutar una consulta SQL parametrizada y devolver sus filas.
 * Usar siempre parámetros ($1, $2...) para prevenir inyección SQL.
 *
 * @param {string} sql Consulta con marcadores $1, $2...
 * @param {Array} [params] Valores de los marcadores.
 * @returns {Promise<Array<Object>>} Filas resultantes.
 */
async function consultar(sql, params = []) {
  const pool = await obtenerDb();
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Convertir una columna DATE a texto en SQL para evitar desfases por zona horaria.
 *
 * @param {string} columna Nombre de la columna.
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
    const pool = await obtenerDb();
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

  async listarMiembros(equipoId) {
    const miembros = await consultar(
      `SELECT u.id AS "usuarioId", u.nombre, c.horas_por_dia
         FROM equipo_miembros em
         JOIN usuarios u ON u.id = em.usuario_id
    LEFT JOIN capacidad_usuarios c ON c.usuario_id = u.id
        WHERE em.equipo_id = $1
        ORDER BY u.nombre`,
      [equipoId],
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
async function obtenerCapacidad(usuarioId) {
  const repo = elegirRepo();
  const [perfil, ausencias] = await Promise.all([repo.obtenerPerfil(usuarioId), repo.listarAusencias(usuarioId)]);
  return { usuarioId, horasPorDia: perfil?.horasPorDia ?? null, notas: perfil?.notas ?? '', ausencias };
}

/**
 * Guardar las horas por día, las notas y las ausencias de una persona.
 * Permitir editar solo a la propia persona o a un Admin. Validar los datos,
 * fusionar las ausencias que se traslapan y avisar cuántas se fusionaron.
 * En modo demo, aceptar peticiones sin sesión.
 *
 * @param {{id: number, rol: string}|null} actor Usuario autenticado (req.user).
 * @param {number} usuarioId Persona cuya capacidad se guarda.
 * @param {Object} datos { horasPorDia, notas, ausencias }.
 * @returns {Promise<Object>} Capacidad guardada más { fusionadas, mensaje }.
 * @throws {ErrorCapacidad} 403 sin permiso, 400 si los datos no son válidos.
 */
async function guardarCapacidad(actor, usuarioId, datos = {}) {
  const esDueno = Boolean(actor) && (actor.id === usuarioId || actor.rol === 'Admin');
  const demoSinSesion = esModoDemo() && !actor;
  if (!esDueno && !demoSinSesion) {
    throw new ErrorCapacidad(403, 'Solo puedes editar tu propia capacidad.');
  }

  const errores = validarCapacidad(datos);
  if (errores.length) throw new ErrorCapacidad(400, 'Revisa los campos marcados.', errores);

  const { ausencias, fusionadas } = fusionarAusencias(datos.ausencias ?? []);
  await elegirRepo().guardarTodo(usuarioId, {
    horasPorDia: Number(datos.horasPorDia),
    notas: datos.notas?.trim() || null,
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
 * Calcular la capacidad total de un equipo dentro de un rango de fechas (un sprint).
 * Recalcular en cada consulta, de modo que cualquier cambio en horas o ausencias se refleje al instante.
 *
 * @param {number} equipoId
 * @param {{inicio: string, fin: string}} sprint Fechas "AAAA-MM-DD".
 * @returns {Promise<{miembros: Array, totalHoras: number, sinCapacidad: boolean}>}
 * @throws {ErrorCapacidad} 400 si las fechas no son válidas.
 */
async function obtenerCapacidadEquipo(equipoId, sprint) {
  const inicio = leerDia(sprint?.inicio);
  const fin = leerDia(sprint?.fin);
  if (inicio === null || fin === null || fin < inicio) {
    throw new ErrorCapacidad(400, 'Indica un rango de fechas válido (inicio y fin).');
  }
  const miembros = await elegirRepo().listarMiembros(equipoId);
  return capacidadEquipo(miembros, sprint);
}

export { ErrorCapacidad, obtenerCapacidad, guardarCapacidad, obtenerCapacidadEquipo };