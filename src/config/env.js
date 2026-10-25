import dotenv from 'dotenv';

// Cargar las variables definidas en el archivo .env a process.env
dotenv.config();

/**
 * @file env.js
 * @description Módulo centralizado para lectura y validación de variables de entorno.
 * Centraliza las claves secretas y parámetros de red requeridos por el servidor y la BD.
 * @author Citlaly Morales Viveros
 * @author Stephanie Elizdeth Hernández Prieto
 */
export const env = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'clave_secreta_default',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'refresh_secreta_default',
  JWT_ACCESO_MINUTOS: parseInt(process.env.JWT_ACCESO_MINUTOS, 10) || 15,
  JWT_RENOVACION_MINUTOS: parseInt(process.env.JWT_RENOVACION_MINUTOS, 10) || 30,
  RECUPERACION_MINUTOS: parseInt(process.env.RECUPERACION_MINUTOS, 10) || 30,
  MAX_INTENTOS_CORREO: parseInt(process.env.MAX_INTENTOS_CORREO, 10) || 10,
  MAX_INTENTOS_IP: parseInt(process.env.MAX_INTENTOS_IP, 10) || 30,
  BLOQUEO_MINUTOS: parseInt(process.env.BLOQUEO_MINUTOS, 10) || 15,
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  CONFIAR_PROXY: process.env.CONFIAR_PROXY === 'true',
  CORREO_MODO: process.env.CORREO_MODO || 'consola',
  CORREO_REMITENTE: process.env.CORREO_REMITENTE || 'ScrumFlow <no-responder@scrumflow.test>',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_SEGURO: process.env.SMTP_SEGURO === 'true',
  SMTP_USUARIO: process.env.SMTP_USUARIO || '',
  SMTP_CLAVE: process.env.SMTP_CLAVE || ''
};