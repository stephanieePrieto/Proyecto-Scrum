/**
 * @file github.service.js
 * @description Consulta commits y contribuciones de repositorios públicos de GitHub.
 */
import { consulta } from '../../config/db.js';
import { ErrorApp } from '../../utils/ErrorApp.js';
import { analizarRepositorioGitHub } from '../../utils/github.js';

const BASE_API = 'https://api.github.com';
const TIEMPO_LIMITE_MS = 8000;

/**
 * Solicita una página de la API pública de GitHub.
 *
 * @param {string} ruta Ruta relativa de api.github.com.
 * @returns {Promise<Array<Object>>} Registros de la respuesta.
 */
async function consultarGitHub(ruta) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
  let respuesta;
  try {
    respuesta = await fetch(`${BASE_API}${ruta}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ScrumFlow',
      },
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
    if (respuesta.status === 403 && respuesta.headers.get('x-ratelimit-remaining') === '0') {
      throw new ErrorApp('GitHub alcanzó el límite temporal de consultas. Inténtalo más tarde.', 503);
    }
    if (respuesta.status === 404) {
      throw new ErrorApp('No se encontró el repositorio público. Comprueba el enlace guardado en la configuración del proyecto.', 404);
    }
    throw new ErrorApp('GitHub no pudo entregar los datos del repositorio. Inténtalo de nuevo más tarde.', 502);
  }

  const datos = await respuesta.json();
  if (!Array.isArray(datos)) {
    throw new ErrorApp('GitHub devolvió un formato de datos inesperado.', 502);
  }
  return datos;
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

  const rutaBase = `/repos/${encodeURIComponent(repositorio.owner)}/${encodeURIComponent(repositorio.repo)}`;
  const [commitsRaw, contribucionesRaw] = await Promise.all([
    consultarGitHub(`${rutaBase}/commits?per_page=100`),
    consultarGitHub(`${rutaBase}/contributors?per_page=100`),
  ]);

  return {
    conectado: true,
    repositorio: repositorio.url,
    commits: commitsRaw.map((commit) => ({
      sha: commit.sha,
      autor: commit.author?.login || commit.commit?.author?.name || 'Autor desconocido',
      avatar: commit.author?.avatar_url || null,
      fecha: commit.commit?.author?.date || commit.commit?.committer?.date || null,
      mensaje: String(commit.commit?.message || '').split('\n')[0],
      url: commit.html_url,
    })),
    contribuciones: contribucionesRaw.map((persona) => ({
      usuario: persona.login || persona.name || 'Sin asociar',
      avatar: persona.avatar_url || null,
      url: persona.html_url || null,
      commits: Number(persona.contributions) || 0,
    })),
  };
}
