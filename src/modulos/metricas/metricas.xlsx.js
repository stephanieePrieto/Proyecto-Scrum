/**
 * @file metricas.xlsx.js
 * @description Generar el reporte de métricas como libro de Excel (.xlsx) con el mismo
 * diseño del PDF (metricas.pdf.js): banda de título oscura, títulos de sección con
 * acento azul y tablas con cabecera oscura y filas alternadas.
 *
 * Se usa ExcelJS porque permite dar estilo a las celdas (rellenos, fuentes, bordes y
 * anchos de columna); la edición comunitaria de SheetJS no guarda estilos.
 *
 * @author Dana Carmona Santamaria
 */

import ExcelJS from 'exceljs';

/** Misma paleta del reporte PDF. */
const COLOR = {
  primario: '1E293B',
  acento: '3B82F6',
  texto: '1F2937',
  suave: '64748B',
  zebra: 'F1F5F9',
  borde: 'CBD5E1',
  blanco: 'FFFFFF',
  tarjeta: 'EFF6FF',
};

const RELLENO = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
const BORDE_FINO = {
  top: { style: 'thin', color: { argb: `FF${COLOR.borde}` } },
  left: { style: 'thin', color: { argb: `FF${COLOR.borde}` } },
  bottom: { style: 'thin', color: { argb: `FF${COLOR.borde}` } },
  right: { style: 'thin', color: { argb: `FF${COLOR.borde}` } },
};

/** Ancho de columna según el texto más largo, entre 12 y 50 caracteres. */
function anchoColumna(textos) {
  const max = Math.max(12, ...textos.map((t) => String(t ?? '').length));
  return Math.min(50, max + 2);
}

/**
 * Generar el libro de Excel del reporte.
 *
 * @param {Object} datos
 * @param {string} datos.titulo Título del reporte.
 * @param {string} [datos.subtitulo] Subtítulo con proyecto, alcance y fecha.
 * @param {Array<{titulo: string, cabecera: string[], filas: Array[]}>} datos.secciones
 *   Las mismas secciones que reciben el CSV y el PDF.
 * @returns {Promise<Buffer>} Contenido del archivo .xlsx.
 */
export async function generarXlsx({ titulo, subtitulo = '', secciones }) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'ScrumFlow';
  libro.created = new Date();
  const hoja = libro.addWorksheet('Reporte', {
    properties: { tabColor: { argb: `FF${COLOR.acento}` } },
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  // El ancho de la hoja lo manda la tabla más ancha
  const columnas = Math.max(2, ...secciones.map((s) => s.cabecera.length));
  hoja.views = [{ state: 'frozen', ySplit: 3 }];

  // 1. Banda de título (igual que la del PDF: fondo oscuro, título blanco)
  hoja.mergeCells(1, 1, 1, columnas);
  const celdaTitulo = hoja.getCell(1, 1);
  celdaTitulo.value = titulo;
  celdaTitulo.font = { size: 16, bold: true, color: { argb: `FF${COLOR.blanco}` } };
  celdaTitulo.fill = RELLENO(COLOR.primario);
  celdaTitulo.alignment = { vertical: 'middle' };
  hoja.getRow(1).height = 30;

  // 2. Subtítulo
  hoja.mergeCells(2, 1, 2, columnas);
  const celdaSubtitulo = hoja.getCell(2, 1);
  celdaSubtitulo.value = subtitulo;
  celdaSubtitulo.font = { size: 11, italic: true, color: { argb: `FF${COLOR.suave}` } };
  celdaSubtitulo.alignment = { vertical: 'middle' };
  hoja.getRow(2).height = 20;

  let fila = 4;
  for (const sec of secciones) {
    // 3. Título de la sección, con la barra de acento a la izquierda
    hoja.mergeCells(fila, 1, fila, columnas);
    const celdaSeccion = hoja.getCell(fila, 1);
    celdaSeccion.value = sec.titulo;
    celdaSeccion.font = { size: 13, bold: true, color: { argb: `FF${COLOR.primario}` } };
    celdaSeccion.fill = RELLENO(COLOR.tarjeta);
    celdaSeccion.border = {
      ...BORDE_FINO,
      left: { style: 'medium', color: { argb: `FF${COLOR.acento}` } },
    };
    celdaSeccion.alignment = { vertical: 'middle' };
    hoja.getRow(fila).height = 22;
    fila += 1;

    // 4. Cabecera de la tabla: fondo oscuro, texto blanco en negrita
    const filaCabecera = hoja.getRow(fila);
    sec.cabecera.forEach((texto, i) => {
      const celda = filaCabecera.getCell(i + 1);
      celda.value = texto;
      celda.font = { size: 11, bold: true, color: { argb: `FF${COLOR.blanco}` } };
      celda.fill = RELLENO(COLOR.primario);
      celda.border = BORDE_FINO;
      celda.alignment = { vertical: 'middle', wrapText: true };
    });
    filaCabecera.height = 22;
    fila += 1;

    // 5. Filas de datos: números como números (para poder operar en Excel) y
    //    filas alternadas con el mismo gris del PDF
    sec.filas.forEach((f, indice) => {
      const filaDatos = hoja.getRow(fila);
      f.forEach((valor, i) => {
        const celda = filaDatos.getCell(i + 1);
        // ExcelJS guarda los textos como cadenas, no como fórmulas: un valor que
        // empiece por "=" se muestra como texto y no se ejecuta.
        celda.value = valor ?? '';
        celda.font = { size: 11, color: { argb: `FF${COLOR.texto}` } };
        celda.border = BORDE_FINO;
        celda.alignment = {
          vertical: 'middle',
          horizontal: typeof valor === 'number' ? 'right' : 'left',
        };
      });
      if (indice % 2 === 1) {
        filaDatos.eachCell((celda) => { celda.fill = RELLENO(COLOR.zebra); });
      }
      fila += 1;
    });

    fila += 1; // Aire entre secciones
  }

  // 6. Pie del reporte
  hoja.mergeCells(fila, 1, fila, columnas);
  const celdaPie = hoja.getCell(fila, 1);
  celdaPie.value = 'ScrumFlow - Reporte generado automáticamente';
  celdaPie.font = { size: 9, italic: true, color: { argb: `FF${COLOR.suave}` } };

  // 7. Anchos de columna según el contenido
  for (let i = 1; i <= columnas; i += 1) {
    const textos = [];
    hoja.eachRow((r) => {
      const valor = r.getCell(i).value;
      if (valor !== null && valor !== undefined) textos.push(valor);
    });
    hoja.getColumn(i).width = anchoColumna(textos);
  }

  return libro.xlsx.writeBuffer();
}
