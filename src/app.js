/**
 * @file app.js
 * @description Configuración central de Express con ES Modules y middlewares de seguridad integrados (XSS y CSRF).
 * @author Citlaly Morales Viveros
 */

import cookieParser from 'cookie-parser';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { consulta } from './config/db.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { manejoErrores, noEncontrado } from './middlewares/manejoErrores.js';
import { sanitizarEntrada } from './middlewares/seguridad.js';
import { proteccionCsrf } from './middlewares/csrf.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const carpetaPublica = path.join(aqui, '..', 'public');

/**
 * Importa un módulo si el archivo existe. Si la carga falla, registra el error y devuelve un objeto vacío.
 *
 * @param {string} rutaAbsoluta - Ruta absoluta del archivo a importar.
 * @returns {Promise<Object>} Exportaciones del módulo o un objeto vacío.
 */
async function importarSiExiste(rutaAbsoluta) {
  if (!fs.existsSync(rutaAbsoluta)) return {};
  try {
    return await import(pathToFileURL(rutaAbsoluta).href);
  } catch (error) {
    console.error(`[Error de carga] No se pudo importar ${rutaAbsoluta}: ${error.message}`);
    return {};
  }
}

/**
 * Crea y configura la aplicación de Express. Cada carpeta de src/modulos con un archivo
 * <nombre>.routes.js se monta automáticamente en /api/<nombre>.
 *
 * @returns {Promise<import('express').Express>} Aplicación configurada.
 */
export async function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());

  // Leer las cookies antes de validar el token CSRF
  app.use(cookieParser());

  // 1. Lectura de cuerpos de petición
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 2. Sanitización anti-XSS en el req.body
  app.use(sanitizarEntrada);

  // 3. Protección CSRF (Double-Submit Cookie)
  app.use(proteccionCsrf);

  // Archivos estáticos del frontend
  app.use(express.static(carpetaPublica));

  app.get(
    '/api/salud',
    asyncHandler(async (_req, res) => {
      const resultado = await consulta('SELECT NOW() AS ahora');
      res.json({ estado: 'ok', baseDeDatos: 'conectada', ahora: resultado.rows[0].ahora });
    }),
  );

  const carpetaModulos = path.join(aqui, 'modulos');
  const modulos = fs.existsSync(carpetaModulos)
    ? fs.readdirSync(carpetaModulos, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];

  for (const nombre of modulos) {
    try {
      const rutas = await importarSiExiste(path.join(carpetaModulos, nombre, `${nombre}.routes.js`));
      if (typeof rutas.default === 'function') {
        app.use(`/api/${nombre}`, rutas.default);
        console.log(`Módulo cargado: /api/${nombre}`);
      }
    } catch (error) {
      console.error(`[Aviso] No se pudo montar /api/${nombre}: ${error.message}`);
    }
  }

  app.use('/api', noEncontrado);
  app.use(manejoErrores);

  return app;
}