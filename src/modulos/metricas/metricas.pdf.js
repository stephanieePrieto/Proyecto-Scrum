/**
 * @file metricas.pdf.js
 * @description HU-36: Generador de PDF con diseño (encabezado, tarjetas de resumen, tablas con
 * filas alternadas, negritas, cursivas y pie de página) sin dependencias externas.
 * Usa las fuentes estándar del PDF: Helvetica (normal), Helvetica-Bold y Helvetica-Oblique.
 * @author Dana Carmona Santamaria
 */

// Medidas de la página A4 (puntos) y paleta de colores del reporte
const W = 595, H = 842, MARGEN = 40, ANCHO_UTIL = W - MARGEN * 2;
const COLOR = {
  primario: '#1e293b', acento: '#3b82f6', texto: '#1f2937', suave: '#64748b',
  zebra: '#f1f5f9', borde: '#cbd5e1', blanco: '#ffffff', tarjeta: '#eff6ff',
};

/** Convertir '#rrggbb' a los tres componentes (0-1) que usa PDF. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(' ');
}

/** Limpiar texto: sin saltos de línea, caracteres fuera de latin1 -> '?', y escapar ( ) \ para PDF. */
function limpiar(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/[^\x00-\xFF]/g, '?').replace(/[\\()]/g, '\\$&');
}

/** Ancho aproximado de un texto en Helvetica (suficiente para ajustar columnas sin tablas de métricas). */
const anchoTexto = (t, size, negrita = false) => String(t).length * size * (negrita ? 0.56 : 0.52);

/**
 * Partir un texto en renglones que quepan en el ancho dado (por palabras; corta las muy largas).
 *
 * @param {string} texto Texto de la celda.
 * @param {number} ancho Ancho disponible en puntos.
 * @param {number} size Tamaño de letra.
 * @returns {string[]} Renglones.
 */
function envolver(texto, ancho, size) {
  const max = Math.max(3, Math.floor(ancho / (size * 0.52)));
  const out = [];
  let actual = '';
  for (let palabra of String(texto ?? '').split(/\s+/)) {
    while (palabra.length > max) { // palabra más larga que la celda: cortarla
      if (actual) { out.push(actual); actual = ''; }
      out.push(palabra.slice(0, max));
      palabra = palabra.slice(max);
    }
    if (!actual) actual = palabra;
    else if ((actual + ' ' + palabra).length <= max) actual += ' ' + palabra;
    else { out.push(actual); actual = palabra; }
  }
  out.push(actual);
  return out;
}

/**
 * Construir un PDF con diseño a partir de secciones de datos.
 *
 * @param {object} reporte
 * @param {string} reporte.titulo Título principal (banda superior).
 * @param {string} [reporte.subtitulo] Texto bajo el título (proyecto, alcance, fecha).
 * @param {Array<{titulo: string, cabecera: string[], filas: Array[], tipo?: 'tarjetas'}>} reporte.secciones
 *        Cada sección es una tabla; con tipo 'tarjetas' se dibuja como tarjetas de indicadores.
 * @returns {Buffer} PDF listo para enviarse al navegador.
 */
export function generarPdf({ titulo, subtitulo = '', secciones }) {
  const paginas = [];
  let ops;       // Comandos de dibujo de la página actual
  let y;         // Posición vertical actual medida desde ARRIBA de la página

  // ---- Primitivas de dibujo (y se da desde arriba; PDF mide desde abajo) ----
  const texto = (x, yArriba, t, size, { negrita = false, cursiva = false, color = COLOR.texto, derecha = false, ancho = 0 } = {}) => {
    const fuente = negrita ? 'F2' : cursiva ? 'F3' : 'F1';
    const px = derecha ? x + ancho - anchoTexto(t, size, negrita) : x;
    ops.push(`BT /${fuente} ${size} Tf ${rgb(color)} rg ${px.toFixed(1)} ${(H - yArriba).toFixed(1)} Td (${limpiar(t)}) Tj ET`);
  };
  const rect = (x, yArriba, w, h, color) => {
    ops.push(`${rgb(color)} rg ${x.toFixed(1)} ${(H - yArriba - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  };
  const linea = (x1, y1, x2, color, grosor = 0.6) => {
    ops.push(`${rgb(color)} RG ${grosor} w ${x1} ${(H - y1).toFixed(1)} m ${x2} ${(H - y1).toFixed(1)} l S`);
  };

  const nuevaPagina = () => { ops = []; paginas.push(ops); y = MARGEN; };

  // ---- Encabezado de la primera página ----
  nuevaPagina();
  rect(0, 0, W, 90, COLOR.primario);
  rect(0, 90, W, 4, COLOR.acento);
  texto(MARGEN, 48, titulo, 22, { negrita: true, color: COLOR.blanco });
  if (subtitulo) texto(MARGEN, 70, subtitulo, 10, { cursiva: true, color: '#cbd5e1' });
  y = 118;

  // ---- Secciones ----
  for (const sec of secciones) {
    if (y > H - 140) nuevaPagina(); // evitar títulos huérfanos al final de la página

    // Título de la sección con barra de acento
    rect(MARGEN, y - 12, 4, 16, COLOR.acento);
    texto(MARGEN + 12, y, sec.titulo, 13, { negrita: true, color: COLOR.primario });
    y += 16;

    // Tarjetas de indicadores (resumen)
    if (sec.tipo === 'tarjetas') {
      const n = sec.filas.length, hueco = 12;
      const w = (ANCHO_UTIL - hueco * (n - 1)) / n;
      sec.filas.forEach(([etiqueta, valor], i) => {
        const x = MARGEN + i * (w + hueco);
        rect(x, y, w, 56, COLOR.tarjeta);
        rect(x, y, 3, 56, COLOR.acento);
        texto(x + 14, y + 20, etiqueta, 9, { color: COLOR.suave });
        texto(x + 14, y + 44, valor, 20, { negrita: true, color: COLOR.primario });
      });
      y += 56 + 26;
      continue;
    }

    // Anchos de columna proporcionales al contenido (mínimo 6, máximo 28 caracteres de peso)
    const pesos = sec.cabecera.map((c, i) => {
      const mayor = Math.max(String(c).length, ...sec.filas.map((f) => String(f[i] ?? '').length));
      return Math.min(28, Math.max(6, mayor));
    });
    const suma = pesos.reduce((a, b) => a + b, 0);
    const anchos = pesos.map((p) => (ANCHO_UTIL * p) / suma);
    // Columnas numéricas (números o porcentajes) se alinean a la derecha
    const numerica = sec.cabecera.map((_, i) => sec.filas.every((f) => /^-?[\d.,]+%?$/.test(String(f[i] ?? '').trim())));

    // Dibuja la fila de encabezado de la tabla (se repite al cambiar de página)
    const encabezado = () => {
      rect(MARGEN, y, ANCHO_UTIL, 22, COLOR.primario);
      let x = MARGEN;
      sec.cabecera.forEach((c, i) => {
        texto(x + 6, y + 15, c, 9, { negrita: true, color: COLOR.blanco, derecha: numerica[i], ancho: anchos[i] - 12 });
        x += anchos[i];
      });
      y += 22;
    };
    encabezado();

    // Filas con fondo alternado; la altura depende del texto envuelto más largo de la fila
    sec.filas.forEach((fila, r) => {
      const celdas = fila.map((v, i) => envolver(v, anchos[i] - 12, 9));
      const alto = Math.max(...celdas.map((c) => c.length)) * 12 + 8;
      if (y + alto > H - 60) { nuevaPagina(); encabezado(); }
      if (r % 2 === 0) rect(MARGEN, y, ANCHO_UTIL, alto, COLOR.zebra);
      let x = MARGEN;
      celdas.forEach((lineas, i) => {
        lineas.forEach((l, k) => texto(x + 6, y + 13 + k * 12, l, 9, { derecha: numerica[i], ancho: anchos[i] - 12 }));
        x += anchos[i];
      });
      y += alto;
    });
    linea(MARGEN, y, W - MARGEN, COLOR.borde);
    y += 28;
  }

  // ---- Pie de página con numeración (ya se conoce el total) ----
  paginas.forEach((p, i) => {
    ops = p;
    linea(MARGEN, H - 38, W - MARGEN, COLOR.borde);
    texto(MARGEN, H - 26, 'ScrumFlow - Reporte generado automaticamente', 8, { cursiva: true, color: COLOR.suave });
    texto(MARGEN, H - 26, `Pagina ${i + 1} de ${paginas.length}`, 8, { color: COLOR.suave, derecha: true, ancho: ANCHO_UTIL });
  });

  // ---- Ensamblar el archivo PDF ----
  let out = '%PDF-1.4\n';
  const offs = [];
  const add = (id, cuerpo) => {
    offs[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${cuerpo}\nendobj\n`;
  };
  const kids = paginas.map((_, i) => `${7 + 2 * i} 0 R`).join(' ');
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`);
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
  const recursos = '<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >>';
  paginas.forEach((p, i) => {
    const flujo = p.join('\n');
    add(6 + 2 * i, `<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`);
    add(7 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${6 + 2 * i} 0 R /Resources ${recursos} >>`);
  });
  const total = 6 + 2 * paginas.length;
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) out += `${String(offs[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}