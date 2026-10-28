/**
 * @file server.js
 * @description Punto de entrada que inicia el servidor HTTPS con soporte TLS 1.2+ y redirección.
 * @author Stephanie Elizdeth Hernández Prieto
 */
import fs from 'fs';
import https from 'https';
import http from 'http';
import { env } from './config/env.js';
import { consulta } from './config/db.js';
import { crearApp } from './app.js';
import { iniciarSockets } from './sockets/index.js';

try {
  await consulta('SELECT 1');
} catch (error) {
  console.error('No se pudo conectar a PostgreSQL. Revisa DATABASE_URL en tu archivo .env');
  console.error(`Detalle: ${error.message}`);
  process.exit(1);
}

console.log('Cargando módulos...');
const app = await crearApp();

// Configuración de certificados SSL para HTTPS y TLS 1.2+
let opcionesHttps = {};
try {
  opcionesHttps = {
    key: fs.readFileSync(env.SSL_KEY_PATH || './certs/localhost-key.pem'),
    cert: fs.readFileSync(env.SSL_CERT_PATH || './certs/localhost.pem'),
    // Exigir estrictamente TLS 1.2 o superior según requerimiento de seguridad
    minVersion: 'TLSv1.2',
  };
} catch (error) {
  console.warn('[Aviso de Seguridad] No se encontraron los certificados SSL en ./certs/. Asegúrate de generarlos.');
}

// Crear servidor seguro HTTPS
const servidor = https.createServer(opcionesHttps, app);
iniciarSockets(servidor);

const puertoHttps = env.HTTPS_PUERTO || env.PORT || 3000;

servidor.listen(puertoHttps, () => {
  console.log(`ScrumFlow seguro listo en https://localhost:${puertoHttps} (TLS 1.2+)`);
  console.log(`Prueba de salud: https://localhost:${puertoHttps}/api/salud`);
});

// Servidor HTTP opcional para redirección automática a HTTPS (si está habilitado)
if (env.FORZAR_HTTPS === 'true' || env.HTTPS_ACTIVO === 'true') {
  const puertoHttp = env.PORT && env.PORT !== puertoHttps ? env.PORT : 80;
  http.createServer((req, res) => {
    const host = req.headers.host ? req.headers.host.replace(/:\d+$/, '') : 'localhost';
    res.writeHead(301, { Location: `https://${host}:${puertoHttps}${req.url}` });
    res.end();
  }).listen(puertoHttp, () => {
    console.log(`Redirección HTTP a HTTPS activa en puerto ${puertoHttp}`);
  });
}