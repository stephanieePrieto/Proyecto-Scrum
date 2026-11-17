/**
 * @file publicar-aviso-privacidad.js
 * @description Publica una nueva versión del aviso de privacidad y notifica por correo a las cuentas activas.
 * La operación la realiza una persona ajena al proyecto, desde una terminal con acceso a la base de datos.
 * El contenido de la versión queda guardado de forma inmutable; si el texto cambia, se publica otra versión.
 *
 * Uso:
 *   node scripts/publicar-aviso-privacidad.js --version v1.1 --archivo ruta/aviso.txt --url https://dominio/pages/privacidad.html
 *   node scripts/publicar-aviso-privacidad.js --version v1.1 --archivo ruta/aviso.txt --url https://dominio/pages/privacidad.html --sin-correo
 *
 * Opciones:
 *   --version   Identificador de la versión con formato vN o vN.N (por ejemplo v1.1). Obligatorio.
 *   --archivo   Ruta de un archivo de texto con el contenido completo del aviso. Obligatorio.
 *   --url       Enlace a la página del aviso que se incluye en el correo. Obligatorio salvo con --sin-correo.
 *   --sin-correo No envía correos; solo publica la versión.
 *
 * @author Citlaly Morales Viveros
 */

import { readFile } from 'fs/promises';
import '../src/config/env.js';
import { pool } from '../src/config/db.js';
import { enviarCorreo } from '../src/utils/correo.js';

const PATRON_VERSION = /^v[0-9]+(\.[0-9]+)*$/;
const LIMITE_CONTENIDO = 100000;

/**
 * Convierte los argumentos de línea de comandos en un objeto.
 *
 * @param {string[]} argumentos Argumentos sin el ejecutable ni el script.
 * @returns {{version?: string, archivo?: string, url?: string, sinCorreo: boolean}}
 */
export const leerArgumentos = (argumentos) => {
  const opciones = { sinCorreo: false };
  for (let i = 0; i < argumentos.length; i += 1) {
    const argumento = argumentos[i];
    if (argumento === '--sin-correo') {
      opciones.sinCorreo = true;
    } else if (['--version', '--archivo', '--url'].includes(argumento)) {
      const valor = argumentos[i + 1];
      if (!valor || valor.startsWith('--')) {
        throw new Error(`Falta el valor de ${argumento}.`);
      }
      opciones[argumento.slice(2)] = valor;
      i += 1;
    } else {
      throw new Error(`Opción no reconocida: ${argumento}`);
    }
  }
  return opciones;
};

/**
 * Valida las opciones antes de tocar la base de datos.
 *
 * @param {{version?: string, archivo?: string, url?: string, sinCorreo: boolean}} opciones
 * @throws {Error} Si falta alguna opción obligatoria o el formato de la versión no es válido.
 */
export const validarOpciones = (opciones) => {
  if (!opciones.version || !PATRON_VERSION.test(opciones.version)) {
    throw new Error('La versión es obligatoria y debe tener el formato vN o vN.N, por ejemplo v1.1.');
  }
  if (!opciones.archivo) {
    throw new Error('Indica el archivo con el contenido del aviso (--archivo).');
  }
  if (!opciones.sinCorreo && !opciones.url) {
    throw new Error('Indica el enlace a la página del aviso (--url), o usa --sin-correo.');
  }
};

/**
 * Escapa texto para insertarlo en el cuerpo HTML del correo.
 *
 * @param {string} texto
 * @returns {string}
 */
const escaparHtml = (texto) => String(texto)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * Arma el correo que avisa de la nueva versión.
 *
 * @param {string} nombre Nombre de la persona destinataria.
 * @param {string} version Versión publicada.
 * @param {string} url Enlace a la página del aviso.
 * @returns {string} Cuerpo HTML.
 */
export const construirCorreo = (nombre, version, url) => `
  <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
    <h2 style="color: #055651;">Hola, ${escaparHtml(nombre)}</h2>
    <p>Publicamos una nueva versión del aviso de privacidad de <strong>ScrumFlow</strong> (${escaparHtml(version)}).</p>
    <p>Al iniciar sesión te pediremos revisarla y aceptarla para seguir usando la plataforma.</p>
    <p><a href="${escaparHtml(url)}" style="color: #055651;">Leer el aviso de privacidad</a></p>
    <p style="color: #666; font-size: 0.9rem;">Equipo de ScrumFlow</p>
  </div>
`;

/**
 * Publica la versión en una sola transacción. Si el INSERT falla (por ejemplo, la versión ya existe),
 * no queda ninguna versión a medias.
 *
 * @param {string} version Identificador de la versión.
 * @param {string} contenido Texto completo del aviso.
 * @returns {Promise<void>}
 */
const publicarVersion = async (version, contenido) => {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      'INSERT INTO avisos_privacidad (version, contenido) VALUES ($1, $2)',
      [version, contenido]
    );
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
};

/**
 * Obtiene las cuentas que deben recibir el aviso: activas, no eliminadas y con contraseña definida.
 * Las cuentas de invitación que todavía no definen contraseña lo verán al definirla.
 *
 * @returns {Promise<Array<{id: number, nombre: string, correo: string}>>}
 */
const cuentasDestinatarias = async () => {
  const { rows } = await pool.query(
    `SELECT id, nombre, correo FROM usuarios
     WHERE activo = TRUE AND eliminado_en IS NULL AND password_hash IS NOT NULL
     ORDER BY id`
  );
  return rows;
};

/**
 * Punto de entrada. Publica la versión y envía los correos uno por uno, registrando los resultados.
 *
 * @returns {Promise<number>} Código de salida del proceso.
 */
const main = async () => {
  const opciones = leerArgumentos(process.argv.slice(2));
  validarOpciones(opciones);

  const contenido = (await readFile(opciones.archivo, 'utf-8')).trim();
  if (!contenido) {
    throw new Error('El archivo del aviso está vacío.');
  }
  if (contenido.length > LIMITE_CONTENIDO) {
    throw new Error(`El aviso supera el límite de ${LIMITE_CONTENIDO} caracteres.`);
  }

  await publicarVersion(opciones.version, contenido);
  console.log(`Versión ${opciones.version} publicada.`);

  if (opciones.sinCorreo) {
    console.log('Correos no enviados (--sin-correo).');
    return 0;
  }

  const destinatarios = await cuentasDestinatarias();
  let enviados = 0;
  const fallidos = [];

  for (const cuenta of destinatarios) {
    try {
      await enviarCorreo({
        para: cuenta.correo,
        asunto: `Nuevo aviso de privacidad de ScrumFlow (${opciones.version})`,
        html: construirCorreo(cuenta.nombre, opciones.version, opciones.url),
      });
      enviados += 1;
    } catch (error) {
      fallidos.push(cuenta.id);
      console.error(`No se pudo enviar el correo a la cuenta ${cuenta.id}: ${error.message}`);
    }
  }

  console.log(`Correos enviados: ${enviados} de ${destinatarios.length}.`);
  if (fallidos.length > 0) {
    console.log(`Cuentas sin correo (revisar y reenviar): ${fallidos.join(', ')}`);
    return 1;
  }
  return 0;
};

if (process.argv[1] && process.argv[1].endsWith('publicar-aviso-privacidad.js')) {
  main()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
