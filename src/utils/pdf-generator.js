/**
 * ===========================================================================
 * GENERADOR DE PDF PARA CERTIFICADOS - ScrumFlow
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Generación de certificados en PDF elegantes con maquetación limpia.
 * ===========================================================================
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fontPath = join(__dirname, '../fonts/Roboto-Regular.ttf');

export async function generarPDF(nombre, fechaEmision) {
  // Crear documento A4 horizontal (842 x 595 puntos)
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); 
  const { width, height } = page.getSize();

  // Intentar cargar fuente personalizada o Helvetica por defecto
  let font, fontBold;
  try {
    const fontBytes = await readFile(fontPath);
    font = await pdfDoc.embedFont(fontBytes);
    fontBold = font;
  } catch (e) {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  // Paleta de colores elegante (Azul Marino + Dorado Elegante + Slate)
  const colors = {
    background: rgb(0.99, 0.99, 1.0),
    primary: rgb(0.09, 0.15, 0.28),     // Navy / Azul Marino
    secondary: rgb(0.35, 0.42, 0.52),   // Slate
    accent: rgb(0.12, 0.18, 0.32),      // Dark Slate
    gold: rgb(0.82, 0.62, 0.16),        // Dorado elegante
    goldLight: rgb(0.96, 0.92, 0.8),    // Dorado muy suave
    borderDark: rgb(0.15, 0.2, 0.3),
  };

  // 1. Fondo completo
  page.drawRectangle({
    x: 0,
    y: 0,
    width,
    height,
    color: colors.background,
  });

  // 2. Marco exterior e interior elegante (Doble borde)
  page.drawRectangle({
    x: 25,
    y: 25,
    width: width - 50,
    height: height - 50,
    borderColor: colors.gold,
    borderWidth: 2,
    color: colors.background,
  });

  page.drawRectangle({
    x: 32,
    y: 32,
    width: width - 64,
    height: height - 64,
    borderColor: colors.borderDark,
    borderWidth: 1,
    color: colors.background,
  });

  // Función auxiliar para centrar texto
  const dibujarTextoCentrado = (texto, yPos, tam, color, usazBold = false) => {
    const fuente = usazBold ? fontBold : font;
    const textoLimpio = String(texto || '');
    const textoAncho = fuente.widthOfTextAtSize(textoLimpio, tam);
    const xPos = (width - textoAncho) / 2;
    page.drawText(textoLimpio, {
      x: xPos,
      y: yPos,
      size: tam,
      font: fuente,
      color
    });
  };

  // 3. Encabezado e Isotipo superior
  dibujarTextoCentrado('S C R U M F L O W', height - 85, 14, colors.gold, true);
  dibujarTextoCentrado('CERTIFICADO DE FINALIZACION', height - 125, 26, colors.primary, true);
  dibujarTextoCentrado('CURSO DE CAPACITACION PRACTICA EN SCRUM', height - 150, 12, colors.secondary, false);

  // Línea divisoria decorativa bajo el título
  page.drawLine({
    start: { x: width / 2 - 80, y: height - 170 },
    end: { x: width / 2 + 80, y: height - 170 },
    thickness: 1.5,
    color: colors.gold,
  });

  // 4. Otorgado a
  dibujarTextoCentrado('Este certificado se otorga a:', height - 215, 13, colors.secondary, false);

  // Nombre del Estudiante (Destacado y Grande)
  const nombreEstudiante = (nombre || 'Stephanie Elizdeth Hernandez Prieto').toUpperCase();
  dibujarTextoCentrado(nombreEstudiante, height - 260, 26, colors.primary, true);

  // Línea sutil bajo el nombre
  page.drawLine({
    start: { x: width / 2 - 180, y: height - 275 },
    end: { x: width / 2 + 180, y: height - 275 },
    thickness: 1,
    color: colors.gold,
  });

  // 5. Detalles de la certificación y fecha
  const fecha = fechaEmision ? new Date(fechaEmision) : new Date();
  const fechaFormateada = fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  dibujarTextoCentrado(
    'Por haber demostrado dominio satisfactorio de los fundamentos, roles, artefactos y eventos de Scrum,',
    height - 315,
    12,
    colors.secondary,
    false
  );
  dibujarTextoCentrado(
    `completando el 100% de las lecciones y evaluaciones el ${fechaFormateada}.`,
    height - 335,
    12,
    colors.secondary,
    false
  );

  // 6. Sello Oficial en la Esquina Inferior Derecha (No centrado encima del texto)
  const selloX = width - 120;
  const selloY = 115;

  page.drawCircle({
    x: selloX,
    y: selloY,
    radius: 30,
    borderColor: colors.gold,
    borderWidth: 2,
    color: colors.background,
  });

  // Checkmark vectorial dentro del sello
  page.drawLine({
    start: { x: selloX - 10, y: selloY - 1 },
    end: { x: selloX - 3, y: selloY - 8 },
    thickness: 3,
    color: colors.gold,
  });

  page.drawLine({
    start: { x: selloX - 3, y: selloY - 8 },
    end: { x: selloX + 11, y: selloY + 7 },
    thickness: 3,
    color: colors.gold,
  });

  // Texto bajo el sello
  const textoSello = 'VERIFICADO';
  const anchoSelloTxt = fontBold.widthOfTextAtSize(textoSello, 8);
  page.drawText(textoSello, {
    x: selloX - (anchoSelloTxt / 2),
    y: selloY - 45,
    size: 8,
    font: fontBold,
    color: colors.gold,
  });

  // 7. Firma Institucional (Esquina Inferior Izquierda)
  const firmaX = 140;
  const firmaY = 100;

  page.drawLine({
    start: { x: firmaX - 60, y: firmaY + 20 },
    end: { x: firmaX + 60, y: firmaY + 20 },
    thickness: 1,
    color: colors.secondary,
  });

  const textoFirma = 'Plataforma ScrumFlow';
  const anchoFirma = font.widthOfTextAtSize(textoFirma, 10);
  page.drawText(textoFirma, {
    x: firmaX - (anchoFirma / 2),
    y: firmaY,
    size: 10,
    font,
    color: colors.primary,
  });

  const textoCargo = 'Sistema de Gestion y Capacitacion';
  const anchoCargo = font.widthOfTextAtSize(textoCargo, 8);
  page.drawText(textoCargo, {
    x: firmaX - (anchoCargo / 2),
    y: firmaY - 14,
    size: 8,
    font,
    color: colors.secondary,
  });

  // 8. Pie de Página con Código de Verificación
  const textoPie = 'Este documento digital acredita la finalización del curso en la plataforma ScrumFlow.';
  page.drawText(textoPie, {
    x: 45,
    y: 42,
    size: 9,
    font,
    color: colors.secondary,
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}