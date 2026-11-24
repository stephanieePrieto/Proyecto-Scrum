/**
 * @file github.test.js
 * @description Pruebas de validación y normalización de URL de repositorios públicos.
 */
import { describe, expect, test } from '@jest/globals';
import { analizarRepositorioGitHub, crearEncabezadosGitHub } from './github.js';

describe('analizarRepositorioGitHub', () => {
  test('normaliza enlaces HTTPS de repositorios públicos', () => {
    expect(analizarRepositorioGitHub(' https://github.com/equipo/proyecto.git/ ')).toEqual({
      owner: 'equipo',
      repo: 'proyecto',
      url: 'https://github.com/equipo/proyecto',
    });
  });

  describe('crearEncabezadosGitHub', () => {
    test('crea encabezados con token y rechaza consultas sin autenticación', () => {
      expect(crearEncabezadosGitHub(' token-seguro ')).toMatchObject({
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer token-seguro',
      });
      expect(crearEncabezadosGitHub('')).toBeNull();
      expect(crearEncabezadosGitHub(null)).toBeNull();
    });
  });

  test.each([
    '',
    'no es una URL',
    'http://github.com/equipo/proyecto',
    'https://github.com.ejemplo.com/equipo/proyecto',
    'https://github.com/equipo/proyecto/issues',
    'https://usuario:clave@github.com/equipo/proyecto',
    'https://github.com/equipo/proyecto?tab=readme',
  ])('rechaza URL inválida o fuera del formato de repositorio: %s', (valor) => {
    expect(analizarRepositorioGitHub(valor)).toBeNull();
  });
});
