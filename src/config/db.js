/**
 * @file db.js
 * @description Conexión a PostgreSQL mediante pool con conmutación automática a réplica de solo lectura
 * y detección de caída de base de datos primaria.
 * 
 * @author Citlaly Morales Viveros
 * @author Camila Mariné Crespo Zurita
 * @author Stephanie Elizdeth Hernández Prieto
 */
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Pool opcional de réplica en modo solo lectura (si existe DATABASE_REPLICA_URL en .env)
export const poolReplica = process.env.DATABASE_REPLICA_URL
  ? new Pool({ connectionString: process.env.DATABASE_REPLICA_URL })
  : null;

export let estadoBaseDatos = {
  primariaActiva: true,
  enModoLecturaReplica: false,
  ultimoError: null,
  ultimaVerificacion: new Date().toISOString(),
};

const CODIGOS_FALLO_CONEXION = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08006', // connection_failure
]);

export function esErrorCaidaBD(error) {
  if (!error) return false;
  if (CODIGOS_FALLO_CONEXION.has(error.code)) return true;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('connect econnrefused') ||
    msg.includes('connection terminated') ||
    msg.includes('timeout expired') ||
    msg.includes('the database system is starting up')
  );
}

/**
 * Función genérica para ejecutar consultas SQL parametrizadas.
 * Si la primaria cae y existe réplica configurada, conmuta consultas SELECT a modo lectura.
 */
export const consulta = async (text, params) => {
  try {
    const resultado = await pool.query(text, params);
    estadoBaseDatos = {
      primariaActiva: true,
      enModoLecturaReplica: false,
      ultimoError: null,
      ultimaVerificacion: new Date().toISOString(),
    };
    return resultado;
  } catch (error) {
    if (esErrorCaidaBD(error)) {
      estadoBaseDatos = {
        primariaActiva: false,
        enModoLecturaReplica: Boolean(poolReplica),
        ultimoError: error.message,
        ultimaVerificacion: new Date().toISOString(),
      };

      const esLectura = /^\s*(SELECT|WITH)\b/i.test(text);
      if (poolReplica && esLectura) {
        console.warn('[Conmutación BD] Primaria caída. Sirviendo consulta en modo solo lectura desde réplica.');
        return await poolReplica.query(text, params);
      }

      error.esCaidaBD = true;
    }
    throw error;
  }
};

export default pool;