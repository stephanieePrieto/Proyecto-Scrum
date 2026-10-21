import dotenv from 'dotenv';

// Cargar las variables definidas en el archivo .env a process.env
dotenv.config();

/**
 * @file env.js
 * @description Módulo centralizado para lectura y validación de variables de entorno (HU-47).
 * Centraliza las claves secretas y parámetros de red requeridos por el servidor y la BD.
 * @author Stephanie Elizdeth Hernández Prieto (Tracker / Programadora XP)
 */

/**
 * Configuración central de variables de entorno del servidor.
 * @type {Object}
 * @property {number|string} PORT - Puerto donde escuchará el servidor HTTP (por defecto 3000).
 * @property {string|undefined} DATABASE_URL - Cadena de conexión a la base de datos PostgreSQL.
 * @property {string} JWT_SECRET - Clave secreta para firmar y verificar tokens de sesión.
 */
export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'clave_secreta_default',
};