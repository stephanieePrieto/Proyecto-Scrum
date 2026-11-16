/**
 * @file metricas.xlsx.test.js
 * @description Pruebas del generador de Excel (.xlsx) del reporte de métricas (HU-36).
 * Genera el libro con secciones de ejemplo y lo vuelve a leer con ExcelJS para
 * comprobar título, cabeceras con estilo y que los números queden como números.
 */

import { describe, test, expect } from '@jest/globals';
import ExcelJS from 'exceljs';
import { generarXlsx } from './metricas.xlsx.js';

/** Cargar un libro desde el buffer generado. */
async function leerLibro(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  return libro;
}

const SECCIONES = [
  {
    titulo: 'Resumen',
    tipo: 'tarjetas',
    cabecera: ['Indicador', 'Valor'],
    filas: [['Avance global', '80%'], ['Desviación (hrs)', 5]],
  },
  {
    titulo: 'Avance por integrante',
    cabecera: ['Nombre', 'Rol', 'Tareas', 'Horas asignadas', 'Horas hechas', 'Avance (%)'],
    filas: [['Dana Carmona', 'developer', 3, 10, 8, 80]],
  },
];

describe('generarXlsx', () => {
  test('arma una hoja Reporte con el título y las secciones', async () => {
    const libro = await leerLibro(await generarXlsx({
      titulo: 'Reporte del proyecto',
      subtitulo: 'Proyecto 1 - Todo el reporte - Generado el 2026-11-15',
      secciones: SECCIONES,
    }));
    const hoja = libro.getWorksheet('Reporte');
    expect(hoja).toBeDefined();
    expect(hoja.getCell('A1').value).toBe('Reporte del proyecto');
    expect(hoja.getCell('A2').value).toContain('Proyecto 1');
    // Las secciones aparecen como títulos en la hoja
    const textos = [];
    hoja.eachRow((fila) => fila.eachCell((c) => { if (typeof c.value === 'string') textos.push(c.value); }));
    expect(textos).toContain('Resumen');
    expect(textos).toContain('Avance por integrante');
  });

  test('la cabecera de la tabla lleva el fondo oscuro del reporte y texto blanco', async () => {
    const libro = await leerLibro(await generarXlsx({
      titulo: 'Reporte del proyecto',
      secciones: SECCIONES,
    }));
    const hoja = libro.getWorksheet('Reporte');
    // Fila 5: cabecera de la primera sección (1 título, 2 subtítulo, 3 aire, 4 título sección, 5 cabecera)
    const celda = hoja.getCell(5, 1);
    expect(celda.value).toBe('Indicador');
    expect(celda.fill.fgColor.argb).toBe('FF1E293B');
    expect(celda.font.bold).toBe(true);
    expect(celda.font.color.argb).toBe('FFFFFFFF');
  });

  test('los números quedan como números para poder operar en Excel', async () => {
    const libro = await leerLibro(await generarXlsx({
      titulo: 'Reporte del proyecto',
      secciones: SECCIONES,
    }));
    const hoja = libro.getWorksheet('Reporte');
    // Fila 7: segunda fila de datos del Resumen; la desviación (5) es número
    const celdaNumero = hoja.getCell(7, 2);
    expect(celdaNumero.value).toBe(5);
    expect(celdaNumero.type).toBe(ExcelJS.ValueType.Number);
    // El porcentaje del avance (80) también es número (fila 11, última columna)
    const celdaAvance = hoja.getCell(11, 6);
    expect(celdaAvance.value).toBe(80);
    expect(celdaAvance.type).toBe(ExcelJS.ValueType.Number);
  });
});
