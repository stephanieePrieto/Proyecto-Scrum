/**
 * @file github.service.test.js
 * @description Pruebas unitarias de conexión, commits y contribuciones de GitHub.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

let repoUrl;
const consultaMock = jest.fn();
const fetchOriginal = globalThis.fetch;

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: consultaMock,
}));

const servicio = await import('./github.service.js');

beforeEach(() => {
  repoUrl = null;
  consultaMock.mockImplementation(async () => ({ rows: [{ github_repo_url: repoUrl }] }));
  globalThis.fetch = jest.fn();
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  jest.clearAllMocks();
});

/** Crea una respuesta simulada con el formato usado por la API pública. */
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
  });

  test('no revela proyectos que no pertenecen a la persona', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [] });
    await expect(servicio.obtenerActividad(7, { id: 12 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
