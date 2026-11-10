/**
 * ===========================================================================
 * GENERADOR DE PDF PARA CERTIFICADOS - ScrumFlow
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Certificado de Diplomado en Azul Marino y Dorado con sello
 *              emblema institucional de excelencia (sin círculo azul).
 * ===========================================================================
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fontPath = join(__dirname, '../fonts/Roboto-Regular.ttf');

export async function generarPDF(nombre, fechaEmision, usuarioId = 1, calificacion = 9.8) {
  // Crear documento A4 horizontal (842 x 595 puntos)
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); 
  const { width, height } = page.getSize();

  // Cargar fuentes
  let font, fontBold;
  try {
    const fontBytes = await readFile(fontPath);
    font = await pdfDoc.embedFont(fontBytes);
    fontBold = font;
  } catch (e) {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  // Paleta de colores ejecutiva
  const colors = {
    background: rgb(0.99, 0.99, 1.0),
    navyDark: rgb(0.06, 0.09, 0.16),     // #0F172A - Azul Marino Profundo
    navyMedium: rgb(0.12, 0.16, 0.23),   // #1E293B
    goldPrimary: rgb(0.85, 0.47, 0.02),  // #D97706 - Dorado Cálido
    goldDark: rgb(0.70, 0.33, 0.03),     // #B45309 - Dorado Intenso
    goldLight: rgb(0.98, 0.94, 0.84),    // Fondo sutil dorado
    textMuted: rgb(0.40, 0.45, 0.52),    // Slate Gris
    borderDark: rgb(0.82, 0.85, 0.90),
    white: rgb(1.0, 1.0, 1.0)
  };

  // 1. Fondo completo
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: colors.background,
  });

  // 2. Franja Superior Decorativa en Azul Marino
  page.drawRectangle({
    x: 0,
    y: height - 12,
    width,
    height: 12,
    color: colors.navyDark,
  });

  // Línea Dorada fina bajo la franja superior
  page.drawLine({
    start: { x: 0, y: height - 12 },
    end: { x: width, y: height - 12 },
    thickness: 2,
    color: colors.goldPrimary,
  });

  // 3. Doble Marco Elegante
  const m = 30; // Margen exterior
  page.drawRectangle({
    x: m,
    y: m,
    width: width - (m * 2),
    height: height - (m * 2) - 10,
    borderColor: colors.goldPrimary,
    borderWidth: 1.5,
    color: colors.background,
  });

  page.drawRectangle({
    x: m + 5,
    y: m + 5,
    width: width - ((m + 5) * 2),
    height: height - ((m + 5) * 2) - 10,
    borderColor: colors.navyMedium,
    borderWidth: 0.8,
    color: colors.background,
  });

  // 4. Folio en Esquina Superior Derecha
  const idFormateado = String(usuarioId).padStart(4, '0');
  const folio = `SCRUM-2026-${idFormateado}`;

  page.drawText(`FOLIO: ${folio}`, {
    x: width - 190,
    y: height - 55,
    size: 9,
    font: fontBold,
    color: colors.navyDark,
  });

  const centroX = width / 2;

  // 5. Encabezado de la Plataforma
  const textBrand = 'S C R U M F L O W';
  const wBrand = fontBold.widthOfTextAtSize(textBrand, 11);
  page.drawText(textBrand, {
    x: centroX - (wBrand / 2),
    y: height - 75,
    size: 11,
    font: fontBold,
    color: colors.goldPrimary,
  });

  // 6. Título Principal
  const textTitle = 'CERTIFICADO DE ACREDITACIÓN';
  const wTitle = fontBold.widthOfTextAtSize(textTitle, 24);
  page.drawText(textTitle, {
    x: centroX - (wTitle / 2),
    y: height - 110,
    size: 24,
    font: fontBold,
    color: colors.navyDark,
  });

  // Línea divisoria bajo el título
  page.drawLine({
    start: { x: centroX - 80, y: height - 122 },
    end: { x: centroX + 80, y: height - 122 },
    thickness: 1.5,
    color: colors.goldPrimary,
  });

  // 7. Otorgado a
  const textOtorgado = 'Este certificado se otorga a:';
  const wOtorgado = font.widthOfTextAtSize(textOtorgado, 11);
  page.drawText(textOtorgado, {
    x: centroX - (wOtorgado / 2),
    y: height - 165,
    size: 11,
    font,
    color: colors.textMuted,
  });

  // Nombre del Estudiante
  const nombreEstudiante = String(nombre || 'STEPHANIE PRIETO').toUpperCase();
  const wNombre = fontBold.widthOfTextAtSize(nombreEstudiante, 24);
  page.drawText(nombreEstudiante, {
    x: centroX - (wNombre / 2),
    y: height - 205,
    size: 24,
    font: fontBold,
    color: colors.navyDark,
  });

  // Línea decorativa bajo el nombre
  page.drawLine({
    start: { x: centroX - 170, y: height - 218 },
    end: { x: centroX + 170, y: height - 218 },
    thickness: 0.8,
    color: colors.borderDark,
  });

  // 8. Texto del Logro del Curso
  const fecha = fechaEmision ? new Date(fechaEmision) : new Date();
  const fechaFormateada = fecha.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const desc1 = 'Por haber demostrado dominio satisfactorio de los fundamentos, roles, artefactos y eventos';
  const wDesc1 = font.widthOfTextAtSize(desc1, 10);
  page.drawText(desc1, {
    x: centroX - (wDesc1 / 2),
    y: height - 255,
    size: 10,
    font,
    color: colors.textMuted,
  });

  const desc2 = `del Marco de Trabajo Scrum, completando el curso con una calificación final de ${calificacion}/10.`;
  const wDesc2 = fontBold.widthOfTextAtSize(desc2, 10);
  page.drawText(desc2, {
    x: centroX - (wDesc2 / 2),
    y: height - 273,
    size: 10,
    font: fontBold,
    color: colors.navyDark,
  });

  // 9. Badges de Métricas
  const badgeY = height - 335;
  const badgeW = 150;
  const badgeH = 36;

  // Badge 1: Avance Global
  page.drawRectangle({
    x: centroX - 165,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: colors.goldLight,
    borderColor: colors.goldPrimary,
    borderWidth: 1,
  });
  page.drawText('AVANCE GLOBAL', { x: centroX - 132, y: badgeY + 22, size: 7.5, font: fontBold, color: colors.goldDark });
  page.drawText('100% Completado', { x: centroX - 138, y: badgeY + 8, size: 9.5, font: fontBold, color: colors.navyDark });

  // Badge 2: Duración Académica
  page.drawRectangle({
    x: centroX + 15,
    y: badgeY,
    width: badgeW,
    height: badgeH,
    color: colors.goldLight,
    borderColor: colors.goldPrimary,
    borderWidth: 1,
  });
  page.drawText('DURACIÓN ACADÉMICA', { x: centroX + 40, y: badgeY + 22, size: 7.5, font: fontBold, color: colors.goldDark });
  page.drawText('40 Horas Prácticas', { x: centroX + 42, y: badgeY + 8, size: 9.5, font: fontBold, color: colors.navyDark });

  // 10. Sección de Firma (Esquina Inferior Izquierda)
  const firmaX = 200;
  const firmaY = 90;

  // Rúbrica manuscrita trazada vectorialmente
  page.drawLine({ start: { x: firmaX - 40, y: firmaY + 35 }, end: { x: firmaX - 10, y: firmaY + 48 }, thickness: 1.8, color: colors.navyDark });
  page.drawLine({ start: { x: firmaX - 10, y: firmaY + 48 }, end: { x: firmaX + 15, y: firmaY + 28 }, thickness: 1.8, color: colors.navyDark });
  page.drawLine({ start: { x: firmaX + 15, y: firmaY + 28 }, end: { x: firmaX + 35, y: firmaY + 52 }, thickness: 1.5, color: colors.navyDark });
  page.drawLine({ start: { x: firmaX - 25, y: firmaY + 38 }, end: { x: firmaX + 40, y: firmaY + 36 }, thickness: 1.5, color: colors.navyDark });

  // Línea de firma
  page.drawLine({
    start: { x: firmaX - 65, y: firmaY + 18 },
    end: { x: firmaX + 65, y: firmaY + 18 },
    thickness: 0.8,
    color: colors.borderDark,
  });

  const txtFirma = 'Dirección de Capacitación Ágil';
  const wFirma = fontBold.widthOfTextAtSize(txtFirma, 9);
  page.drawText(txtFirma, { x: firmaX - (wFirma / 2), y: firmaY + 4, size: 9, font: fontBold, color: colors.navyDark });

  const txtSub = 'Plataforma ScrumFlow';
  const wSub = font.widthOfTextAtSize(txtSub, 8);
  page.drawText(txtSub, { x: firmaX - (wSub / 2), y: firmaY - 8, size: 8, font, color: colors.textMuted });

  // 11. NUEVO SELLO DISTINTIVO EMBLEMA EN DORADO (Esquina Inferior Derecha)
  const emblemaX = width - 210;
  const emblemaY = 85;
  const emblemaW = 140;
  const emblemaH = 45;

  // Caja rectangular con bordes dorados e interior dorado suave
  page.drawRectangle({
    x: emblemaX,
    y: emblemaY,
    width: emblemaW,
    height: emblemaH,
    color: colors.goldLight,
    borderColor: colors.goldPrimary,
    borderWidth: 1.2,
  });

  // Línea interna dorada
  page.drawRectangle({
    x: emblemaX + 3,
    y: emblemaY + 3,
    width: emblemaW - 6,
    height: emblemaH - 6,
    borderColor: colors.goldDark,
    borderWidth: 0.6,
  });

  // Estrella / Checkmark de excelencia (trazado vectorial)
  page.drawLine({ start: { x: emblemaX + 15, y: emblemaY + 22 }, end: { x: emblemaX + 21, y: emblemaY + 16 }, thickness: 2, color: colors.goldDark });
  page.drawLine({ start: { x: emblemaX + 21, y: emblemaY + 16 }, end: { x: emblemaX + 30, y: emblemaY + 28 }, thickness: 2, color: colors.goldDark });

  // Textos del sello de excelencia
  page.drawText('ACREDITACIÓN OFICIAL', {
    x: emblemaX + 36,
    y: emblemaY + 26,
    size: 7.5,
    font: fontBold,
    color: colors.goldDark,
  });

  page.drawText('SCRUMFLOW VERIFIED', {
    x: emblemaX + 36,
    y: emblemaY + 14,
    size: 7,
    font: fontBold,
    color: colors.navyDark,
  });

  // 12. Pie de Página Institucional
  const textPie = `Emitido en Xalapa, Veracruz el ${fechaFormateada} · Válido y expedido digitalmente por la plataforma ScrumFlow.`;
  const wPie = font.widthOfTextAtSize(textPie, 8);
  page.drawText(textPie, {
    x: centroX - (wPie / 2),
    y: 45,
    size: 8,
    font,
    color: colors.textMuted,
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}