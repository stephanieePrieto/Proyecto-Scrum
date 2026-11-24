/**
 * @file github.service.js
 * @description Consulta commits y contribuciones de repositorios de GitHub con autenticación.
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { analizarRepositorioGitHub, crearEncabezadosGitHub } from '../../utils/github.js';
import { env } from '../../config/env.js';

const BASE_API = 'https://api.github.com';
const TIEMPO_LIMITE_MS = 8000;
const CACHE_MS = 5 * 60 * 1000;
const cacheActividad = new Map();

function exigirTokenGitHub() {
  if (!crearEncabezadosGitHub(env.GITHUB_TOKEN)) {
    throw new ErrorApp('La integración con GitHub requiere configurar GITHUB_TOKEN en el servidor.', 503);
  }
}

/**
 * Solicita una página de GitHub usando el token configurado en el servidor.
 *
 * @param {string} ruta Ruta relativa de api.github.com.
 * @returns {Promise<Array<Object>>} Registros de la respuesta.
 */
async function consultarGitHub(ruta) {
  const headers = crearEncabezadosGitHub(env.GITHUB_TOKEN);
  if (!headers) {
    throw new ErrorApp('La integración con GitHub requiere configurar GITHUB_TOKEN en el servidor.', 503);
  }
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
  let respuesta;
  try {
    respuesta = await fetch(`${BASE_API}${ruta}`, {
      headers,
      signal: controlador.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ErrorApp('GitHub tardó demasiado en responder. Inténtalo de nuevo.', 504);
    }
    throw new ErrorApp('No se pudo conectar con GitHub. Revisa tu conexión e inténtalo de nuevo.', 502);
  } finally {
    clearTimeout(temporizador);
  }

  if (respuesta.status === 204 || respuesta.status === 409) return [];
  if (!respuesta.ok) {
    if (respuesta.status === 429 ||
      (respuesta.status === 403 && respuesta.headers.get('x-ratelimit-remaining') === '0')) {
      const error = new ErrorApp('GitHub alcanzó el límite temporal de consultas.', 503);
      error.code = 'GITHUB_RATE_LIMIT';
      throw error;
    }
    if (respuesta.status === 404) {
      throw new ErrorApp('No se encontró el repositorio. Comprueba el enlace y los permisos de lectura del token.', 404);
    }
    throw new ErrorApp('GitHub no pudo entregar los datos del repositorio. Inténtalo de nuevo más tarde.', 502);
  }

  const datos = await respuesta.json();
  if (!Array.isArray(datos)) {
    throw new ErrorApp('GitHub devolvió un formato de datos inesperado.', 502);
  }
  return datos;
}

async function completarCommitsPorContribuyente(rutaBase, commits, contribuciones) {
  const autoresVisibles = new Set(
    commits.map((commit) => commit.author?.login?.toLocaleLowerCase('en')).filter(Boolean),
  );
  const autoresFaltantes = contribuciones
    .map((persona) => persona.login)
    .filter((login) => login && !autoresVisibles.has(login.toLocaleLowerCase('en')));
  const commitsCompletos = [...commits];

  for (let indice = 0; indice < autoresFaltantes.length; indice += 5) {
    const grupo = autoresFaltantes.slice(indice, indice + 5);
    const resultados = await Promise.all(grupo.map((login) =>
      consultarGitHub(`${rutaBase}/commits?author=${encodeURIComponent(login)}&per_page=1`),
    ));
    resultados.forEach((resultado) => commitsCompletos.push(...resultado));
  }

  return [...new Map(commitsCompletos.map((commit) => [commit.sha, commit])).values()]
    .sort((a, b) => Date.parse(b.commit?.author?.date || b.commit?.committer?.date || '') -
      Date.parse(a.commit?.author?.date || a.commit?.committer?.date || ''));
}

async function consultarParticipacionApp(proyectoId) {
  const { rows } = await consulta(
    `SELECT u.id, u.nombre, mp.rol,
            (SELECT COUNT(*)::int FROM historias h WHERE h.proyecto_id = $1 AND h.creada_por = u.id) AS historias,
            (SELECT COUNT(*)::int FROM registros_horas r JOIN tareas t ON t.id = r.tarea_id
              WHERE t.proyecto_id = $1 AND r.usuario_id = u.id) AS horas,
            (SELECT COUNT(*)::int FROM impedimentos i WHERE i.proyecto_id = $1 AND i.creado_por = u.id) AS impedimentos,
            (SELECT COUNT(*)::int FROM eventos_calendario e
              WHERE e.proyecto_id = $1 AND e.origen = 'reunion' AND e.creado_por = u.id) AS reuniones,
            (SELECT COUNT(*)::int FROM tareas t WHERE t.proyecto_id = $1 AND t.responsable_id = u.id) AS tareas
       FROM miembros_proyecto mp
       JOIN usuarios u ON u.id = mp.usuario_id
      WHERE mp.proyecto_id = $1
      ORDER BY u.nombre, u.id`,
    [proyectoId],
  );
  return rows.map((fila) => ({
    usuarioId: fila.id,
    usuario: fila.nombre,
    rol: fila.rol,
    historias: Number(fila.historias) || 0,
    horas: Number(fila.horas) || 0,
    impedimentos: Number(fila.impedimentos) || 0,
    reuniones: Number(fila.reuniones) || 0,
    tareas: Number(fila.tareas) || 0,
  }));
}

/**
 * Devuelve commits recientes y contribuciones del proyecto para sus integrantes.
 *
 * @param {number|string} proyectoId Identificador del proyecto.
 * @param {{id: number}} usuario Usuario autenticado.
 * @returns {Promise<Object>} Estado de conexión, commits y contribuciones.
 */
export async function obtenerActividad(proyectoId, usuario) {
  const { rows } = await consulta(
    `SELECT p.github_repo_url
       FROM proyectos p
       JOIN miembros_proyecto mp ON mp.proyecto_id = p.id
      WHERE p.id = $1 AND mp.usuario_id = $2`,
    [proyectoId, usuario.id],
  );
  if (!rows.length) throw new ErrorApp('Proyecto no encontrado.', 404);

  const repositorio = analizarRepositorioGitHub(rows[0].github_repo_url);
  if (!repositorio) {
    return {
      conectado: false,
      mensaje: 'Este proyecto todavía no tiene un repositorio público de GitHub conectado.',
      commits: [],
      contribuciones: [],
    };
  }

  exigirTokenGitHub();

  const rutaBase = `/repos/${encodeURIComponent(repositorio.owner)}/${encodeURIComponent(repositorio.repo)}`;
  const claveCache = `${repositorio.owner}/${repositorio.repo}`;
  const cache = cacheActividad.get(claveCache);
  let datosGitHub;
  let aviso = null;
  let consultadoEn;
  if (cache && cache.expiraEn > Date.now()) {
    datosGitHub = cache.datos;
    consultadoEn = cache.consultadoEn;
  } else {
    try {
      const [commitsRecientes, contribucionesRaw] = await Promise.all([
        consultarGitHub(`${rutaBase}/commits?per_page=100`),
        consultarGitHub(`${rutaBase}/contributors?per_page=100`),
      ]);
      const commitsRaw = await completarCommitsPorContribuyente(rutaBase, commitsRecientes, contribucionesRaw);
      datosGitHub = { commitsRaw, contribucionesRaw };
      consultadoEn = new Date().toISOString();
      cacheActividad.set(claveCache, {
        datos: datosGitHub,
        consultadoEn,
        expiraEn: Date.now() + CACHE_MS,
      });
    } catch (error) {
      if (error?.code !== 'GITHUB_RATE_LIMIT' || !cache) throw error;
      datosGitHub = cache.datos;
      consultadoEn = cache.consultadoEn;
      aviso = 'GitHub alcanzó temporalmente su límite de consultas. Se muestran los commits guardados anteriormente.';
    }
  }
  const participacionApp = await consultarParticipacionApp(Number(proyectoId));

  return {
    conectado: true,
    repositorio: repositorio.url,
    consultadoEn,
    aviso,
    commits: datosGitHub.commitsRaw.map((commit) => ({
      sha: commit.sha,
      autor: commit.author?.login || commit.commit?.author?.name || 'Autor desconocido',
      avatar: commit.author?.avatar_url || null,
      fecha: commit.commit?.author?.date || commit.commit?.committer?.date || null,
      mensaje: String(commit.commit?.message || '').split('\n')[0],
      url: commit.html_url,
    })),
    contribuciones: datosGitHub.contribucionesRaw.map((persona) => ({
      usuario: persona.login || persona.name || 'Sin asociar',
      avatar: persona.avatar_url || null,
      url: persona.html_url || null,
      commits: Number(persona.contributions) || 0,
    })),
    participacionApp,
  };
}
