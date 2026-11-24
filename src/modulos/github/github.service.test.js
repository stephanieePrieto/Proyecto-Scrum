/**
 * @file github.service.test.js
 * @description Pruebas unitarias de conexión, commits y contribuciones de GitHub.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

let repoUrl;
const consultaMock = jest.fn();
const fetchOriginal = globalThis.fetch;
const { env } = await import('../../config/env.js');
const tokenOriginal = env.GITHUB_TOKEN;

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: consultaMock,
}));

const servicio = await import('./github.service.js');

beforeEach(() => {
  repoUrl = null;
  env.GITHUB_TOKEN = 'token-de-prueba';
  consultaMock.mockImplementation(async () => ({ rows: [{ github_repo_url: repoUrl }] }));
  globalThis.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = fetchOriginal;
  env.GITHUB_TOKEN = tokenOriginal;
  jest.clearAllMocks();
});

/** Crea una respuesta simulada con el formato usado por GitHub. */
function respuestaGitHub(datos) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => datos,
  };
}

describe('obtenerActividad', () => {
  test('informa cuando el proyecto todavía no conecta un repositorio', async () => {
    const resultado = await servicio.obtenerActividad(7, { id: 12 });

    expect(resultado).toMatchObject({
      conectado: false,
      commits: [],
      contribuciones: [],
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('resume commits recientes y el número de contribuciones', async () => {
    repoUrl = 'https://github.com/equipo/proyecto';
    globalThis.fetch
      .mockResolvedValueOnce(respuestaGitHub([{
        sha: 'abcdef123456',
        author: { login: 'camila' },
        commit: { author: { date: '2026-11-20T12:00:00Z' }, message: 'Actualiza módulo\nDetalle' },
        html_url: 'https://github.com/equipo/proyecto/commit/abcdef123456',
      }]))
      .mockResolvedValueOnce(respuestaGitHub([{
        login: 'camila',
        avatar_url: 'https://avatars.githubusercontent.com/u/1',
        html_url: 'https://github.com/camila',
        contributions: 4,
      }]));

    const resultado = await servicio.obtenerActividad(7, { id: 12 });

    expect(resultado).toMatchObject({
      conectado: true,
      repositorio: 'https://github.com/equipo/proyecto',
      commits: [{
        sha: 'abcdef123456',
        autor: 'camila',
        fecha: '2026-11-20T12:00:00Z',
        mensaje: 'Actualiza módulo',
      }],
      contribuciones: [{ usuario: 'camila', commits: 4 }],
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-de-prueba');
  });

  test('incluye al menos el commit más reciente de cada contribuyente', async () => {
    repoUrl = 'https://github.com/equipo/proyecto-completo';
    globalThis.fetch
      .mockResolvedValueOnce(respuestaGitHub([{
        sha: 'alice-sha',
        author: { login: 'alice' },
        commit: { author: { date: '2026-11-20T12:00:00Z' }, message: 'Commit de Alice' },
      }]))
      .mockResolvedValueOnce(respuestaGitHub([
        { login: 'alice', contributions: 3 },
        { login: 'bob', contributions: 2 },
      ]))
      .mockResolvedValueOnce(respuestaGitHub([{
        sha: 'bob-sha',
        author: { login: 'bob' },
        commit: { author: { date: '2026-11-19T12:00:00Z' }, message: 'Commit de Bob' },
      }]));

    const resultado = await servicio.obtenerActividad(7, { id: 12 });

    expect(resultado.commits.map((commit) => commit.autor)).toEqual(['alice', 'bob']);
    expect(resultado.commits[1]).toMatchObject({
      sha: 'bob-sha',
      fecha: '2026-11-19T12:00:00Z',
      mensaje: 'Commit de Bob',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  test('no consulta GitHub sin token configurado', async () => {
    repoUrl = 'https://github.com/equipo/proyecto';
    env.GITHUB_TOKEN = '';

    await expect(servicio.obtenerActividad(7, { id: 12 }))
      .rejects.toMatchObject({ statusCode: 503 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('informa el límite temporal de GitHub cuando responde 429', async () => {
    repoUrl = 'https://github.com/equipo/proyecto-limite';
    const respuestaLimite = {
      ok: false,
      status: 429,
      headers: { get: () => null },
    };
    globalThis.fetch.mockResolvedValue(respuestaLimite);

    await expect(servicio.obtenerActividad(7, { id: 12 }))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  test('sirve commits guardados y un aviso claro si GitHub limita una actualización', async () => {
    repoUrl = 'https://github.com/equipo/proyecto-cache-limite';
    globalThis.fetch
      .mockResolvedValueOnce(respuestaGitHub([{
        sha: 'cache-sha',
        author: { login: 'camila' },
        commit: { author: { date: '2026-11-20T12:00:00Z' }, message: 'Commit guardado' },
      }]))
      .mockResolvedValueOnce(respuestaGitHub([{ login: 'camila', contributions: 1 }]));

    const primeraConsulta = await servicio.obtenerActividad(7, { id: 12 });
    const ahora = Date.now();
    jest.useFakeTimers();
    jest.setSystemTime(ahora + 6 * 60 * 1000);
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
    });

    const resultadoLimitado = await servicio.obtenerActividad(7, { id: 12 });

    expect(resultadoLimitado.commits).toEqual(primeraConsulta.commits);
    expect(resultadoLimitado.consultadoEn).toBe(primeraConsulta.consultadoEn);
    expect(resultadoLimitado.aviso).toMatch(/límite de consultas/i);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  test('no revela proyectos que no pertenecen a la persona', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [] });
    await expect(servicio.obtenerActividad(7, { id: 12 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
