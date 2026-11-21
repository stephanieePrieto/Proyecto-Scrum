/**
 * @file curso-scrum.tutorial.test.js
 * @description Pruebas del guardado y consulta de finalización de la guía por rol.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const consultaMock = jest.fn();

jest.unstable_mockModule('../../config/db.js', () => ({
  consulta: consultaMock,
}));

const servicio = await import('./curso-scrum.service.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('progreso de la guía por rol', () => {
  test('registra una guía completada para un integrante del proyecto', async () => {
    consultaMock
      .mockResolvedValueOnce({ rows: [{ miembro: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(servicio.registrarEstadoTutorial(12, '7', 'completado'))
      .resolves.toEqual({ estado: 'completado' });
    expect(consultaMock).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO curso_tutorial_progreso'),
      [12, 7, 'completado']
    );
  });

  test('rechaza resultados no admitidos antes de consultar la base de datos', async () => {
    await expect(servicio.registrarEstadoTutorial(12, 7, 'en_progreso'))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(consultaMock).not.toHaveBeenCalled();
  });

  test('no guarda progreso cuando la persona no pertenece al proyecto', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [] });

    await expect(servicio.registrarEstadoTutorial(12, 7, 'omitido'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(consultaMock).toHaveBeenCalledTimes(1);
  });

  test('consulta el rol y reconoce una guía ya omitida', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [{ rol: 'developer', estado: 'omitido' }] });

    await expect(servicio.obtenerEstadoTutorial(12, '7'))
      .resolves.toEqual({ rolEnProyecto: 'developer', tutorialCompletado: true });
  });
});
