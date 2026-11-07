/**
 * @file app.js
 * @description Configuración central de Express con ES Modules y middlewares de seguridad integrados (XSS y CSRF).
 *
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
import { registrarPeticiones } from './middlewares/registrarPeticiones.js';
import { configurarSwagger } from './config/swagger.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const carpetaPublica = path.join(aqui, '..', 'public');

/**
 * Importa un módulo si el archivo existe.
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
 * Middleware de cabeceras de seguridad con CSP mejorado para el curso
 * Permite Google Fonts, Font Awesome y recursos externos necesarios
 */
export function cabecerasSeguridad(req, res, next) {
  // Configuración de CSP que permite:
  // - Google Fonts (fuentes)
  // - Font Awesome (iconos)
  // - Estilos y scripts locales
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "frame-src 'none'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'"
  );

  // Otras cabeceras de seguridad (Helmet, CSP restrictiva, HSTS)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  next();
}

/**
 * Crea y configura la aplicación de Express.
 */
export async function crearApp() {
  const app = express();
  app.disable('x-powered-by');

  // Aplicar cabeceras de seguridad HTTP (Helmet, CSP restrictiva, HSTS)
  app.use(cabecerasSeguridad);
  app.use(cors());

  // Registrar logs solo en modo debug
  if (process.env.DEBUG_PETICIONES === 'true') {
    app.use(registrarPeticiones);
  }

  // Middlewares
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(sanitizarEntrada);
  app.use(proteccionCsrf);

  // Swagger
  configurarSwagger(app);

  // Archivos estáticos del frontend
  app.use(express.static(carpetaPublica));

  /**
   * @openapi
   * /api/salud:
   *   get:
   *     summary: Comprobar estado del servidor y la base de datos
   *     responses:
   *       200:
   *         description: Servidor y PostgreSQL funcionando correctamente.
   */
  app.get(
    '/api/salud',
    asyncHandler(async (_req, res) => {
      const resultado = await consulta('SELECT NOW() AS ahora');
      res.json({ estado: 'ok', baseDeDatos: 'conectada', ahora: resultado.rows[0].ahora });
    }),
  );

  // Cargar módulos automáticamente
  const carpetaModulos = path.join(aqui, 'modulos');
  const modulos = fs.existsSync(carpetaModulos)
    ? fs.readdirSync(carpetaModulos, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  for (const nombre of modulos) {
    try {
      const rutas = await importarSiExiste(path.join(carpetaModulos, nombre, `${nombre}.routes.js`));
      if (typeof rutas.default === 'function') {
        app.use(`/api/${nombre}`, rutas.default);
      }
    } catch (error) {
      console.error(`[Aviso] No se pudo montar /api/${nombre}: ${error.message}`);
    }
  }

  app.use('/api', noEncontrado);

  /**
   * HU-43: Responder con la página 404.html (y estado 404) a cualquier otra ruta GET del frontend.
   * Se omiten las rutas con extensión distinta de .html (css, js, imágenes) para no devolver HTML
   * donde el navegador espera otro tipo de archivo.
   */
  app.use((req, res, next) => {
    const extension = path.extname(req.path);
    if (req.method !== 'GET' || (extension && extension !== '.html')) return next();
    res.status(404).sendFile(path.join(carpetaPublica, 'pages', '404.html'));
  });

  app.use(manejoErrores);

  return app;
}