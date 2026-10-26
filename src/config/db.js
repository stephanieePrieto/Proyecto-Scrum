/**
 * @file db.js
 * @description Conexión a PostgreSQL mediante pool y función de consulta parametrizada.
 */
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Función genérica para ejecutar consultas SQL parametrizadas.
 * @param {string} text - Sentencia SQL con placeholders ($1, $2...)
 * @param {Array} params - Arreglo de parámetros
 */
export const consulta = (text, params) => pool.query(text, params);

export default pool;