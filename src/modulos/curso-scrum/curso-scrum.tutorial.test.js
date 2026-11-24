/**
 * @file curso-scrum.tutorial.test.js
 * @description Pruebas de la guía por rol y del tutorial teórico (4 lecciones), separado del certificado.
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

  test('una guía omitida NO cuenta como completada', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [{ rol: 'developer', estado: 'omitido' }] });

    await expect(servicio.obtenerEstadoTutorial(12, '7'))
      .resolves.toEqual({ rolEnProyecto: 'developer', tutorialCompletado: false });
  });

  test('una guía completada sí cuenta como completada', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [{ rol: 'developer', estado: 'completado' }] });

    await expect(servicio.obtenerEstadoTutorial(12, '7'))
      .resolves.toEqual({ rolEnProyecto: 'developer', tutorialCompletado: true });
  });
});

describe('tutorial teórico (4 lecciones) separado del certificado', () => {
  const leccionesCon = (completadas) => [1, 2, 3, 4].map(id => ({
    id, orden: id, titulo: `L${id}`, contenido: '', seccion: '',
    completada: id <= completadas, posicion_scroll: 0, calificacion_quiz: 0, quiz_aprobado: false,
  }));

  // Orden de consultas dentro de obtenerTemarioYProgreso:
  // rol, lecciones, quizzes, certificado, tutorial, quiz final (y equipo si es SM/PO)
  const prepararTemario = ({ rol = 'developer', completadas = 4, quizFinal = { calificacion: 0, aprobado: false }, certificado = [], equipo = [] } = {}) => {
    consultaMock
      .mockResolvedValueOnce({ rows: [{ rol }] })
      .mockResolvedValueOnce({ rows: leccionesCon(completadas) })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: certificado })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: quizFinal.calificacion !== undefined ? [quizFinal] : [] });
    if (rol === 'scrum_master' || rol === 'product_owner') {
      consultaMock.mockResolvedValueOnce({ rows: equipo });
    }
  };

  test('4/4 lecciones sin quizzes ni quiz final marca el tutorial teórico como finalizado', async () => {
    prepararTemario({ completadas: 4 });
    const r = await servicio.obtenerTemarioYProgreso(12, 7);
    expect(r.tutorialTeoricoCompletado).toBe(true);
    expect(r.leccionesCompletadas).toBe(4);
    expect(r.totalLecciones).toBe(4);
    expect(r.certificado.tieneCertificado).toBe(false);
  });

  test('3/4 lecciones deja el tutorial teórico sin finalizar', async () => {
    prepararTemario({ completadas: 3 });
    const r = await servicio.obtenerTemarioYProgreso(12, 7);
    expect(r.tutorialTeoricoCompletado).toBe(false);
    expect(r.leccionesCompletadas).toBe(3);
  });

  test('4/4 lecciones con quiz final por debajo de 95% : tutorial sí, certificado no', async () => {
    prepararTemario({ completadas: 4, quizFinal: { calificacion: 90, aprobado: false } });
    const r = await servicio.obtenerTemarioYProgreso(12, 7);
    expect(r.tutorialTeoricoCompletado).toBe(true);
    expect(r.quizFinal.aprobado).toBe(false);
    expect(r.certificado.tieneCertificado).toBe(false);
  });

  test('verificarCompletacionCurso sigue exigiendo el quiz final aprobado para el certificado', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [{ calificacion: 90, aprobado: false }] });
    await expect(servicio.verificarCompletacionCurso(12)).resolves.toEqual({ completado: false });
  });

  test('el progreso del equipo indica tutorial teórico finalizado por integrante', async () => {
    prepararTemario({
      rol: 'scrum_master',
      completadas: 4,
      equipo: [
        { usuario_id: 1, nombre: 'A', correo: 'a@x', rol: 'developer', total_lecciones: 4, lecciones_completadas: 4, quizzes_aprobados: 0, tiene_certificado: false },
        { usuario_id: 2, nombre: 'B', correo: 'b@x', rol: 'developer', total_lecciones: 4, lecciones_completadas: 2, quizzes_aprobados: 0, tiene_certificado: false },
      ],
    });
    const r = await servicio.obtenerTemarioYProgreso(12, 7);
    expect(r.progresoEquipo.map(i => i.tutorial_teorico_completado)).toEqual([true, false]);
  });
});

describe('guardado de progreso de lección', () => {
  test('lección inexistente responde 404 sin intentar el INSERT (antes era 500 por FK)', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [] });
    await expect(servicio.guardarProgresoLectura(12, 9999, true, 0))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(consultaMock).toHaveBeenCalledTimes(1);
  });

  test('leccionId no numérico responde 400 antes de consultar la base de datos', async () => {
    await expect(servicio.guardarProgresoLectura(12, 'abc', true, 0))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(consultaMock).not.toHaveBeenCalled();
  });

  test('completada debe ser booleana', async () => {
    await expect(servicio.guardarProgresoLectura(12, 1, 'si', 0))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(consultaMock).not.toHaveBeenCalled();
  });

  test('lección existente guarda el progreso con el id normalizado', async () => {
    consultaMock
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] });
    await servicio.guardarProgresoLectura(12, '1', true, 147.83);
    expect(consultaMock).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO curso_progreso_lecciones'),
      [12, 1, true, 148]
    );
  });
});

describe('calificar quiz modular', () => {
  test('lección inexistente responde 404 y no se aprueba por defecto', async () => {
    consultaMock.mockResolvedValueOnce({ rows: [] });
    await expect(servicio.calificarQuiz(12, 9999, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
