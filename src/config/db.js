// BASE (no modificar sin avisar al equipo) - HU-47: conexion a PostgreSQL (pool de pg) y funcion query para los services
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

/**
 * Ejecuta una consulta SQL en la base de datos PostgreSQL.
 * @param {string} textoSql - Consulta SQL a ejecutar.
 * @param {Array} parametros - Parámetros de la consulta.
 * @returns {Promise<import('pg').QueryResult>}
 */
export const consulta = (textoSql, parametros) => pool.query(textoSql, parametros);


/**
 * Alias de compatibilidad para módulos que importan 'query' en lugar de 'consulta'.
 */
export const query = consulta;

export default pool;