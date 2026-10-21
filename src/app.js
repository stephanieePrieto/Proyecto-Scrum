/**
 * @file app.js
 * @description Configuración principal de Express en ES Modules (HU-47).
 * Carga middlewares globales, archivos estáticos de /public y monta
 * automáticamente las rutas registradas dentro de /src/modulos/.
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { consulta } from './config/db.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { manejoErrores, noEncontrado } from './middlewares/manejoErrores.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const carpetaPublica = path.join(aqui, '..', 'public');

/**
 * Importa un archivo de forma dinámica solo si existe en el sistema de archivos.
 * Evita la interrupción si un módulo opcional aún no está desarrollado.
 *
 * @param {string} rutaAbsoluta - Ruta absoluta del archivo a importar.
 * @returns {Promise<Object>} Módulo importado o un objeto vacío si no existe.
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
 * Instancia y configura la aplicación Express.
 *
 * @returns {Promise<import('express').Express>} Servidor app configurado.
 */
export async function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // Cabeceras básicas de seguridad (HU-53)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // Middleware opcional para registro de peticiones (logs)
  const { registrarPeticiones } = await importarSiExiste(path.join(aqui, 'middlewares', 'registrarPeticiones.js'));
  if (typeof registrarPeticiones === 'function') app.use(registrarPeticiones);

  // Servir archivos estáticos del cliente desde la carpeta /public
  app.use(express.static(carpetaPublica));

  // Endpoint de verificación del estado del servidor y base de datos
  app.get(
    '/api/salud',
    asyncHandler(async (_req, res) => {
      const resultado = await consulta('SELECT NOW() AS ahora');
      res.json({ estado: 'ok', baseDeDatos: 'conectada', ahora: resultado.rows[0].ahora });
    }),
  );

  // Carga AUTOMÁTICA de los módulos de la carpeta /src/modulos/
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
      } else {
        console.warn(`[Aviso] Se omitió /api/${nombre} porque no expone 'export default router'`);
      }
    } catch (error) {
      console.error(`[Aviso] No se pudo montar /api/${nombre}: ${error.message}`);
    }
  }

  // Manejo de rutas /api no encontradas
  app.use('/api', noEncontrado);

  // Página 404 para vistas del frontend
  app.use((_req, res) => {
    res.status(404).sendFile(path.join(carpetaPublica, 'pages', '404.html'), (error) => {
      if (error) res.type('text').send('Página no encontrada');
    });
  });

  // Middleware global para manejo centralizado de errores
  app.use(manejoErrores);
  return app;
}