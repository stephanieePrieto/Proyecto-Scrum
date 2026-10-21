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
const servidor = http.createServer(app);
iniciarSockets(servidor);

servidor.listen(env.PORT, () => {
  console.log(`ScrumFlow listo en http://localhost:${env.PORT}`);
  console.log(`Prueba de salud: http://localhost:${env.PORT}/api/salud`);
});