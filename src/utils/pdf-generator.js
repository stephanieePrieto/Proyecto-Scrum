/**
 * ===========================================================================
 * GENERADOR DE PDF PARA CERTIFICADOS
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Genera certificados en PDF para usuarios que completan el curso.
 * Dependencia: pdf-lib (npm install pdf-lib)
 * ===========================================================================
 */

import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ruta a la fuente (opcional: descargar Roboto o usar fuente por defecto)
const fontPath = join(__dirname, '../fonts/Roboto-Regular.ttf');

/**
 * Genera un certificado en PDF para un usuario.
 * @param {string} nombre - Nombre del usuario.
 * @param {Date|string} fechaEmision - Fecha de emisión del certificado.
 * @returns {Promise<Uint8Array>} - Buffer del PDF generado.
 */
export async function generarPDF(nombre, fechaEmision) {
  // Crear documento PDF
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 450]); // Tamaño A5 horizontal
  const { width, height } = page.getSize();

  // Cargar fuente (si no existe, usar la por defecto)
  let font;
  try {
    const fontBytes = await readFile(fontPath);
    font = await pdfDoc.embedFont(fontBytes);
  } catch (e) {
    // Si no se encuentra la fuente, usar la fuente por defecto de pdf-lib
    font = await pdfDoc.embedFont(PDFDocument.load(new Uint8Array()));
  }

  // ===========================================================================
  // ESTILOS
  // ===========================================================================
  const colors = {
    background: rgb(0.98, 0.98, 0.98), // Blanco casi puro
    primary: rgb(0.1, 0.1, 0.1),      // Negro
    secondary: rgb(0.3, 0.3, 0.3),    // Gris oscuro
    accent: rgb(0.2, 0.4, 0.6),       // Azul oscuro
    gold: rgb(0.85, 0.65, 0.13),      // Dorado para el sello
    border: rgb(0.7, 0.7, 0.7)        // Gris para bordes
  };

  const styles = {
    title: { size: 28, color: colors.accent, font },
    subtitle: { size: 20, color: colors.secondary, font },
    body: { size: 16, color: colors.primary, font },
    small: { size: 12, color: colors.secondary, font },
    gold: { size: 14, color: colors.gold, font }
  };

  // ===========================================================================
  // FONDO Y BORDE
  // ===========================================================================
  // Fondo claro
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: colors.background,
  });

  // Borde decorativo
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: colors.border,
    borderWidth: 1,
    color: colors.background,
  });

  // ===========================================================================
  // TÍTULO PRINCIPAL
  // ===========================================================================
  page.drawText('CERTIFICADO DE FINALIZACIÓN', {
    x: width / 2 - 120,
    y: height - 60,
    size: styles.title.size,
    font: font,
    color: colors.accent,
    textAlign: 'center',
  });

  // ===========================================================================
  // SUBTÍTULO
  // ===========================================================================
  page.drawText('Curso de Scrum', {
    x: width / 2 - 80,
    y: height - 100,
    size: styles.subtitle.size,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  // ===========================================================================
  // CUERPO: NOMBRE DEL USUARIO
  // ===========================================================================
  page.drawText('OTORGADO A:', {
    x: width / 2 - 100,
    y: height - 160,
    size: styles.body.size,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  // Nombre en negrita (simulado con tamaño mayor)
  page.drawText(nombre.toUpperCase(), {
    x: width / 2 - 150,
    y: height - 190,
    size: styles.title.size - 4,
    font: font,
    color: colors.primary,
    textAlign: 'center',
  });

  // ===========================================================================
  // DETALLES DEL CERTIFICADO
  // ===========================================================================
  const fecha = new Date(fechaEmision);
  const fechaFormateada = fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  page.drawText(`Ha completado satisfactoriamente el curso de Scrum`, {
    x: width / 2 - 180,
    y: height - 240,
    size: styles.body.size,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  page.drawText(`el día ${fechaFormateada}.`, {
    x: width / 2 - 180,
    y: height - 265,
    size: styles.body.size,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  // ===========================================================================
  // SELLO Y FIRMA
  // ===========================================================================
  // Sello dorado (círculo)
  page.drawCircle({
    x: width / 2,
    y: height - 320,
    radius: 30,
    borderColor: colors.gold,
    borderWidth: 2,
    color: colors.background,
  });

  page.drawText('✓', {
    x: width / 2 - 5,
    y: height - 330,
    size: 24,
    font: font,
    color: colors.gold,
    textAlign: 'center',
  });

  // Texto de validación
  page.drawText('ScrumFlow', {
    x: width / 2 - 40,
    y: height - 350,
    size: styles.small.size,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  page.drawText('Certificado Digital', {
    x: width / 2 - 60,
    y: height - 370,
    size: styles.small.size - 2,
    font: font,
    color: colors.secondary,
    textAlign: 'center',
  });

  // ===========================================================================
  // PIE DE PÁGINA
  // ===========================================================================
  page.drawText('Este certificado es válido y verificable en el sistema ScrumFlow.', {
    x: 20,
    y: 20,
    size: styles.small.size,
    font: font,
    color: colors.secondary,
  });

  // Guardar y devolver el PDF
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}