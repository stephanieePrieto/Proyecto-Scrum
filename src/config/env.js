import dotenv from 'dotenv';

// Cargar las variables definidas en el archivo .env a process.env
dotenv.config();

const ES_PRODUCCION = process.env.NODE_ENV === 'production';
const SECRETOS_INSEGUROS = ['', 'clave_secreta_default', 'refresh_secreta_default'];

/**
 * Lee un secreto desde el entorno. En producción exige un valor aleatorio
 * de al menos 32 caracteres y detiene el arranque si no existe.
 *
 * @param {string} nombre - Nombre de la variable de entorno.
 * @param {string} valorDesarrollo - Valor de respaldo, solo para desarrollo.
 * @returns {string} Secreto a usar.
 * @throws {Error} Si estamos en producción y el secreto es débil o no existe.
 */
const leerSecreto = (nombre, valorDesarrollo) => {
  const valor = process.env[nombre];
  if (ES_PRODUCCION && (!valor || SECRETOS_INSEGUROS.includes(valor) || valor.length < 32)) {
    throw new Error(`[Seguridad] ${nombre} debe tener al menos 32 caracteres aleatorios en producción.`);
  }
  return valor || valorDesarrollo;
};

/**
 * @file env.js
 * @description Módulo centralizado para lectura y validación de variables de entorno.
 * Centraliza las claves secretas y parámetros de red requeridos por el servidor y la BD.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */
export const env = {
  ES_PRODUCCION,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: leerSecreto('JWT_SECRET', 'clave_secreta_default'),
  JWT_REFRESH_SECRET: leerSecreto('JWT_REFRESH_SECRET', 'refresh_secreta_default'),
  JWT_ACCESO_MINUTOS: parseInt(process.env.JWT_ACCESO_MINUTOS, 10) || 15,
  JWT_RENOVACION_MINUTOS: parseInt(process.env.JWT_RENOVACION_MINUTOS, 10) || 30,
  RECUPERACION_MINUTOS: parseInt(process.env.RECUPERACION_MINUTOS, 10) || 30,
  MAX_INTENTOS_CORREO: parseInt(process.env.MAX_INTENTOS_CORREO, 10) || 10,
  MAX_INTENTOS_IP: parseInt(process.env.MAX_INTENTOS_IP, 10) || 30,
  BLOQUEO_MINUTOS: parseInt(process.env.BLOQUEO_MINUTOS, 10) || 15,
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  CONFIAR_PROXY: process.env.CONFIAR_PROXY === 'true',
  // --- Seguridad HTTPS ---
  HTTPS_ACTIVO: process.env.HTTPS_ACTIVO === 'true',
  HTTPS_PUERTO: parseInt(process.env.HTTPS_PUERTO, 10) || 3443,
  SSL_KEY_PATH: process.env.SSL_KEY_PATH || './certs/localhost-key.pem',
  SSL_CERT_PATH: process.env.SSL_CERT_PATH || './certs/localhost.pem',
  FORZAR_HTTPS: process.env.FORZAR_HTTPS === 'true',
  CSP_SOLO_REPORTE: process.env.CSP_SOLO_REPORTE === 'true',
  // --- Correo ---
  CORREO_MODO: process.env.CORREO_MODO || 'consola',
  CORREO_REMITENTE: process.env.CORREO_REMITENTE || 'ScrumFlow <no-responder@scrumflow.test>',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SEGURO: process.env.SMTP_SEGURO === 'true',
  SMTP_USUARIO: process.env.SMTP_USUARIO || '',
  SMTP_CLAVE: process.env.SMTP_CLAVE || ''
};