/**
 * @file github.js
 * @description Validación y normalización de enlaces a repositorios públicos de GitHub.
 */

/**
 * Analiza una URL de repositorio público de GitHub y devuelve sus datos canónicos.
 *
 * @param {*} valor URL ingresada por el usuario.
 * @returns {{owner: string, repo: string, url: string}|null} Repositorio válido o null.
 */
export function analizarRepositorioGitHub(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null;

  let url;
  try {
    url = new URL(valor.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port ||
    url.username || url.password || url.search || url.hash) return null;

  const partes = url.pathname.split('/').filter(Boolean);
  if (partes.length !== 2) return null;

  const [owner, segmentoRepo] = partes;
  const repo = segmentoRepo.endsWith('.git') ? segmentoRepo.slice(0, -4) : segmentoRepo;
  const patronNombre = /^[A-Za-z0-9_.-]+$/;
  if (!patronNombre.test(owner) || !patronNombre.test(repo) || owner === '.' || owner === '..' ||
    repo === '.' || repo === '..') return null;

  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}
