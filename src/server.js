import http from 'http';
import https from 'https';
import fs from 'fs';
import { env } from './config/env.js';
import { consulta } from './config/db.js';
import { crearApp } from './app.js';
import { iniciarSockets } from './sockets/index.js';
import { redirigirAHttps } from './middlewares/forzarHttps.js';

try {
  await consulta('SELECT 1');
} catch (error) {
  console.error('No se pudo conectar a PostgreSQL. Revisa DATABASE_URL en tu archivo .env');
  console.error(`Detalle: ${error.message}`);
  process.exit(1);
}

console.log('Cargando módulos...');
const app = await crearApp();

/**
 * Crea el servidor principal. Con HTTPS_ACTIVO=true usa TLS 1.2 como mínimo
 * (acepta 1.2 y 1.3, rechaza SSLv3, TLS 1.0 y 1.1).
 *
 * @returns {import('http').Server | import('https').Server}
 */
const crearServidorPrincipal = () => {
  if (!env.HTTPS_ACTIVO) return http.createServer(app);

  try {
    return https.createServer(
      {
        key: fs.readFileSync(env.SSL_KEY_PATH),
        cert: fs.readFileSync(env.SSL_CERT_PATH),
        minVersion: 'TLSv1.2',
      },
      app,
    );
  } catch (error) {
    console.error('No se pudieron leer los certificados TLS (SSL_KEY_PATH / SSL_CERT_PATH).');
    console.error(`Detalle: ${error.message}`);
    process.exit(1);
  }
};

const servidor = crearServidorPrincipal();
iniciarSockets(servidor);

if (env.HTTPS_ACTIVO) {
  servidor.listen(env.HTTPS_PUERTO, () => {
    console.log(`ScrumFlow listo en https://localhost:${env.HTTPS_PUERTO}`);
  });
  // Servidor HTTP mínimo cuyo único trabajo es redirigir a HTTPS
  http.createServer(redirigirAHttps).listen(env.PORT, () => {
    console.log(`Redirección HTTP -> HTTPS activa en el puerto ${env.PORT}`);
  });
} else {
  servidor.listen(env.PORT, () => {
    console.log(`ScrumFlow listo en http://localhost:${env.PORT}`);
    console.log(`Prueba de salud: http://localhost:${env.PORT}/api/salud`);
  });
}