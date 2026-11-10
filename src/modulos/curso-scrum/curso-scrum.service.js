/**
 * ===========================================================================
 * SERVICIOS PARA EL MICROCURSO DE SCRUM
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Lecciones, Quizzes modulares, Quiz Final Integrador (20 preguntas) y Certificado (>= 9.5).
 * ===========================================================================
 */

import { consulta } from '../../config/db.js';
import { generarPDF } from '../../utils/pdf-generator.js';

// ===========================================================================
// BANCO DE 20 PREGUNTAS INTEGRADORAS PARA EL QUIZ FINAL
// ===========================================================================
/**
 * BANCO DE 20 PREGUNTAS INTEGRADORAS (TEORÍA OFICIAL DE SCRUM)
 */
/**
 * BANCO DE 20 PREGUNTAS INTEGRADORAS (DISTRIBUIDAS 5 POR MÓDULO DE ESTUDIO)
 */
export const PREGUNTAS_QUIZ_FINAL = [
  // --- MÓDULO 1: INTRODUCCIÓN A SCRUM Y TEORÍA EMPÍRICA (5 Preguntas) ---
  {
    id: 1,
    pregunta: "¿Qué es Scrum según la Guía Oficial?",
    opciones: { 0: "Un marco de trabajo (framework) ligero para generar valor a través de soluciones adaptativas a problemas complejos", 1: "Una metodología rígida de gestión de proyectos con etapas secuenciales", 2: "Un lenguaje de programación enfocado en el desarrollo ágil" },
    correcta: 0
  },
  {
    id: 2,
    pregunta: "¿En qué dos conceptos teóricos fundamentales se basa el marco de trabajo de Scrum?",
    opciones: { 0: "El empirismo y el pensamiento Lean", 1: "El modelo en cascada y el diagrama de Gantt", 2: "La programación orientada a objetos y la gestión financiera" },
    correcta: 0
  },
  {
    id: 3,
    pregunta: "¿Cuáles son los tres pilares del control de procesos empírico en Scrum?",
    opciones: { 0: "Transparencia, Inspección y Adaptación", 1: "Planificación, Calidad y Presupuesto", 2: "Velocidad, Compromiso y Entrega" },
    correcta: 0
  },
  {
    id: 4,
    pregunta: "¿Qué pilar exige que el proceso y el trabajo emergentes sean visibles tanto para quienes realizan el trabajo como para quienes lo reciben?",
    opciones: { 0: "Transparencia", 1: "Inspección", 2: "Adaptación" },
    correcta: 0
  },
  {
    id: 5,
    pregunta: "¿Cuáles son los cinco valores fundamentales sobre los cuales se fundamenta el trabajo del Scrum Team?",
    opciones: { 0: "Compromiso, Foco, Apertura, Respeto y Coraje", 1: "Calidad, Velocidad, Puntualidad, Orden y Control", 2: "Transparencia, Inspección, Adaptación, Diseño y Pruebas" },
    correcta: 0
  },

  // --- MÓDULO 2: EL EQUIPO SCRUM Y ROLES (5 Preguntas) ---
  {
    id: 6,
    pregunta: "¿Cómo está estructurado el modelo fundamental del Scrum Team?",
    opciones: { 0: "Es una unidad cohesionada formada por un Scrum Master, un Product Owner y Developers", 1: "Es un equipo dividido en sub-equipos de diseño, programación y pruebas con líderes independientes", 2: "Es un grupo coordinado por un Gerente de Proyecto con jefes directos" },
    correcta: 0
  },
  {
    id: 7,
    pregunta: "¿Quién es el único responsable de la gestión efectiva del Product Backlog y de maximizar el valor del producto?",
    opciones: { 0: "Product Owner", 1: "Scrum Master", 2: "Developers" },
    correcta: 0
  },
  {
    id: 8,
    pregunta: "¿Cuál es la responsabilidad principal del Scrum Master?",
    opciones: { 0: "Establecer Scrum según la Guía, eliminar impedimentos y servir como líder al equipo", 1: "Asignar las tareas diarias a cada desarrollador y evaluar su rendimiento personal", 2: "Definir el alcance comercial y los costos del proyecto" },
    correcta: 0
  },
  {
    id: 9,
    pregunta: "¿De qué son responsables los Developers dentro del Scrum Team?",
    opciones: { 0: "De crear el plan para el Sprint (Sprint Backlog) y entregar un Incremento utilizable que cumpla con la DoD", 1: "De aprobar el presupuesto y negociar con los patrocinadores", 2: "De definir la visión estratégica del producto a largo plazo" },
    correcta: 0
  },
  {
    id: 10,
    pregunta: "¿Cuál es el tamaño recomendado para un Scrum Team para mantener la agilidad y buena comunicación?",
    opciones: { 0: "Típicamente 10 personas o menos", 1: "Entre 15 y 25 personas obligatoriamente", 2: "No existe recomendación de tamaño" },
    correcta: 0
  },

  // --- MÓDULO 3: EVENTOS DE SCRUM Y LA CADENCIA DEL SPRINT (5 Preguntas) ---
  {
    id: 11,
    pregunta: "¿Cuál es la duración fija máxima definida para un Sprint?",
    opciones: { 0: "Un mes o menos", 1: "Seis meses", 2: "Tres meses" },
    correcta: 0
  },
  {
    id: 12,
    pregunta: "¿Cuáles son las tres preguntas clave que se abordan durante el Sprint Planning?",
    opciones: { 0: "¿Por qué es valioso este Sprint?, ¿Qué se puede hacer? y ¿Cómo se realizará el trabajo?", 1: "¿Cuánto costará el Sprint?, ¿Quién trabajará más? y ¿Cuándo se cobrará?", 2: "¿Qué falló en el proyecto?, ¿De quién fue el error? y ¿Cómo se sancionará?" },
    correcta: 0
  },
  {
    id: 13,
    pregunta: "¿Cuál es el objetivo principal del Daily Scrum y cuál es su tiempo límite (timebox)?",
    opciones: { 0: "Inspeccionar el progreso hacia el Sprint Goal y adaptar el Sprint Backlog en máximo 15 minutos", 1: "Dar un reporte detallado de horas trabajadas al Gerente de Proyecto en 1 hora", 2: "Revisar los costos y compras en 30 minutos" },
    correcta: 0
  },
  {
    id: 14,
    pregunta: "¿En qué evento el Scrum Team e interesados inspeccionan los resultados del Sprint para adaptar el Product Backlog?",
    opciones: { 0: "Sprint Review", 1: "Sprint Retrospective", 2: "Daily Scrum" },
    correcta: 0
  },
  {
    id: 15,
    pregunta: "¿Cuál es el propósito central de la Sprint Retrospective?",
    opciones: { 0: "Planificar formas de aumentar la calidad y la efectividad del Scrum Team inspeccionando procesos y relaciones", 1: "Presentar el software terminado al usuario final para su venta", 2: "Asignar el presupuesto del próximo mes" },
    correcta: 0
  },

  // --- MÓDULO 4: ARTEFACTOS DE SCRUM Y SUS COMPROMISOS (5 Preguntas) ---
  {
    id: 16,
    pregunta: "¿Qué compromiso obligatorio corresponde al artefacto del Product Backlog?",
    opciones: { 0: "El Objetivo del Producto (Product Goal)", 1: "El Objetivo del Sprint (Sprint Goal)", 2: "La Definición de Terminado (Definition of Done)" },
    correcta: 0
  },
  {
    id: 17,
    pregunta: "¿Cuáles son los tres componentes que integran el artefacto del Sprint Backlog?",
    opciones: { 0: "El Objetivo del Sprint (por qué), los elementos seleccionados (qué) y el plan accionable (cómo)", 1: "Las historias de usuario, los contratos y los diagramas UML", 2: "La lista de bugs, los requerimientos del cliente y las facturas" },
    correcta: 0
  },
  {
    id: 18,
    pregunta: "¿Qué compromiso garantiza la transparencia sobre los estándares de calidad de un Incremento?",
    opciones: { 0: "La Definición de Terminado (Definition of Done - DoD)", 1: "El Objetivo del Producto (Product Goal)", 2: "El Acta de Constitución" },
    correcta: 0
  },
  {
    id: 19,
    pregunta: "¿Cuándo se considera que un elemento del Product Backlog pasa a formar parte de un Incremento?",
    opciones: { 0: "Cuando satisface totalmente la Definición de Terminado (Definition of Done)", 1: "En cuanto un desarrollador comienza a escribir su código", 2: "Al momento de ser seleccionado en la reunión de Sprint Planning" },
    correcta: 0
  },
  {
    id: 20,
    pregunta: "¿Qué sucede con los elementos del Sprint Backlog que no se completan al finalizar el Sprint?",
    opciones: { 0: "Vuelven al Product Backlog para ser reestimados y priorizados en futuros Sprints", 1: "Se dan por concluidos automáticamente para no afectar las métricas", 2: "Se eliminan del sistema de forma definitiva" },
    correcta: 0
  }
];

export async function obtenerTemarioYProgreso(usuarioId, proyectoId) {
  const rolRes = await consulta(
    'SELECT rol FROM miembros_proyecto WHERE usuario_id = $1 AND proyecto_id = $2',
    [usuarioId, proyectoId]
  );
  const rolEnProyecto = rolRes.rows[0]?.rol || null;

  // Filtrar para que la lección ficticia 999 NO aparezca en la lista del temario
  const leccionesRes = await consulta(`
    SELECT 
      l.id, l.orden, l.titulo, l.contenido, l.seccion,
      COALESCE(p.completada, FALSE) AS completada,
      COALESCE(p.posicion_scroll, 0) AS posicion_scroll,
      COALESCE(q_intento.calificacion, 0) AS calificacion_quiz,
      COALESCE(q_intento.aprobado, FALSE) AS quiz_aprobado
    FROM curso_lecciones l
    LEFT JOIN curso_progreso_lecciones p ON p.leccion_id = l.id AND p.usuario_id = $1
    LEFT JOIN curso_intentos_quizzes q_intento ON q_intento.leccion_id = l.id AND q_intento.usuario_id = $1
    WHERE l.id != 999
    ORDER BY l.orden ASC;
  `, [usuarioId]);

  const quizzesRes = await consulta(`
    SELECT id, leccion_id, pregunta, opciones FROM curso_quizzes WHERE leccion_id != 999 ORDER BY leccion_id, id;
  `);

  const certificadoRes = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );
  const tieneCertificado = certificadoRes.rows.length > 0;
  const certificadoData = tieneCertificado ? certificadoRes.rows[0] : null;

  // Obtener Intento de Quiz Final Integrador
  const quizFinalRes = await consulta(
    'SELECT calificacion, aprobado FROM curso_intentos_quizzes WHERE leccion_id = 999 AND usuario_id = $1',
    [usuarioId]
  );
  const quizFinalInfo = quizFinalRes.rows[0] || { calificacion: 0, aprobado: false };

  const totalLecciones = leccionesRes.rows.length; // Ahora es estrictamente 4
  const leccionesCompletadas = leccionesRes.rows.filter(l => l.completada).length;
  const quizzesAprobados = leccionesRes.rows.filter(l => l.quiz_aprobado).length;

  // Avance global considerando las 4 lecciones reales (40% lecciones, 40% quizzes modulares, 20% quiz final)
  const porcentajeAvance = totalLecciones > 0
    ? Math.round(
        ((leccionesCompletadas / totalLecciones) * 40) +
        ((quizzesAprobados / totalLecciones) * 40) +
        (quizFinalInfo.aprobado ? 20 : (quizFinalInfo.calificacion / 100) * 20)
      )
    : 0;

  let progresoEquipo = [];
  if (rolEnProyecto === 'scrum_master' || rolEnProyecto === 'product_owner') {
    const equipoRes = await consulta(`
      SELECT 
        mp.usuario_id, u.nombre, u.correo, mp.rol,
        COUNT(DISTINCT l.id) FILTER (WHERE l.id != 999) AS total_lecciones,
        COUNT(DISTINCT p.leccion_id) FILTER (WHERE p.completada = TRUE AND p.leccion_id != 999) AS lecciones_completadas,
        COUNT(DISTINCT q.leccion_id) FILTER (WHERE q.aprobado = TRUE AND q.leccion_id != 999) AS quizzes_aprobados,
        CASE WHEN c.id IS NOT NULL THEN TRUE ELSE FALSE END AS tiene_certificado
      FROM miembros_proyecto mp
      JOIN usuarios u ON u.id = mp.usuario_id
      CROSS JOIN curso_lecciones l
      LEFT JOIN curso_progreso_lecciones p ON p.leccion_id = l.id AND p.usuario_id = mp.usuario_id AND p.completada = TRUE
      LEFT JOIN curso_intentos_quizzes q ON q.leccion_id = l.id AND q.usuario_id = mp.usuario_id
      LEFT JOIN curso_certificados c ON c.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1 AND l.id != 999
      GROUP BY mp.usuario_id, u.nombre, u.correo, mp.rol, c.id
    `, [proyectoId]);
    progresoEquipo = equipoRes.rows;
  }

  return {
    rolEnProyecto,
    lecciones: leccionesRes.rows,
    quizzes: quizzesRes.rows,
    quizFinal: {
      preguntas: PREGUNTAS_QUIZ_FINAL.map(p => ({ id: p.id, pregunta: p.pregunta, opciones: p.opciones })),
      calificacion: Number(quizFinalInfo.calificacion),
      aprobado: quizFinalInfo.aprobado
    },
    progresoEquipo,
    certificado: {
      tieneCertificado,
      ...certificadoData
    },
    porcentajeAvance
  };
}

export async function calificarQuizFinal(usuarioId, respuestasUsuario) {
  let correctas = 0;
  PREGUNTAS_QUIZ_FINAL.forEach(p => {
    if (Number(respuestasUsuario[p.id]) === Number(p.correcta)) {
      correctas++;
    }
  });

  const calificacion = Number(((correctas / PREGUNTAS_QUIZ_FINAL.length) * 100).toFixed(2));
  const aprobado = calificacion >= 95; // Mínimo 9.5 (95%) para aprobar el Quiz Final

  // Usamos el ID ficticio 999 para almacenar el intento del Quiz Final
  await consulta(`
    INSERT INTO curso_intentos_quizzes (usuario_id, leccion_id, calificacion, aprobado, intentos, actualizado_en)
    VALUES ($1, 999, $2, $3, 1, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET 
      calificacion = GREATEST(curso_intentos_quizzes.calificacion, EXCLUDED.calificacion),
      aprobado = CASE WHEN EXCLUDED.aprobado THEN TRUE ELSE curso_intentos_quizzes.aprobado END,
      intentos = curso_intentos_quizzes.intentos + 1,
      actualizado_en = NOW();
  `, [usuarioId, calificacion, aprobado]);

  if (aprobado) {
    try {
      await otorgarCertificado(usuarioId);
    } catch (e) {}
  }

  return { calificacion, aprobado, correctas, total: PREGUNTAS_QUIZ_FINAL.length };
}

export async function guardarProgresoLectura(usuarioId, leccionId, completada, posicionScroll) {
  // Asegurar que el scroll sea un número válido y no exceda el límite numérico de la BD (máx 999.99)
  const scrollSeguro = Math.min(Math.max(0, parseFloat(posicionScroll) || 0), 999.99);

  await consulta(`
    INSERT INTO curso_progreso_lecciones (usuario_id, leccion_id, completada, posicion_scroll, actualizado_en)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET 
      completada = EXCLUDED.completada,
      posicion_scroll = GREATEST(curso_progreso_lecciones.posicion_scroll, EXCLUDED.posicion_scroll),
      actualizado_en = NOW();
  `, [usuarioId, leccionId, completada, scrollSeguro]);
}

export async function calificarQuiz(usuarioId, leccionId, respuestasUsuario) {
  const quizzesRes = await consulta('SELECT id, respuesta_correcta FROM curso_quizzes WHERE leccion_id = $1', [leccionId]);
  const quizzes = quizzesRes.rows;

  if (quizzes.length === 0) return { calificacion: 100, aprobado: true };

  let correctas = 0;
  quizzes.forEach(q => {
    if (Number(respuestasUsuario[q.id]) === Number(q.respuesta_correcta)) {
      correctas++;
    }
  });

  const calificacion = Number(((correctas / quizzes.length) * 100).toFixed(2));
  const aprobado = calificacion >= 100;

  await consulta(`
    INSERT INTO curso_intentos_quizzes (usuario_id, leccion_id, calificacion, aprobado, intentos, actualizado_en)
    VALUES ($1, $2, $3, $4, 1, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET 
      calificacion = GREATEST(curso_intentos_quizzes.calificacion, EXCLUDED.calificacion),
      aprobado = CASE WHEN EXCLUDED.aprobado THEN TRUE ELSE curso_intentos_quizzes.aprobado END,
      intentos = curso_intentos_quizzes.intentos + 1,
      actualizado_en = NOW();
  `, [usuarioId, leccionId, calificacion, aprobado]);

  return { calificacion, aprobado };
}

export async function verificarCompletacionCurso(usuarioId) {
  const quizFinalRes = await consulta(
    'SELECT calificacion, aprobado FROM curso_intentos_quizzes WHERE leccion_id = 999 AND usuario_id = $1',
    [usuarioId]
  );
  const aprobadoFinal = quizFinalRes.rows[0]?.aprobado || false;
  return { completado: aprobadoFinal };
}

export async function otorgarCertificado(usuarioId) {
  const { completado } = await verificarCompletacionCurso(usuarioId);

  if (!completado) {
    throw new Error('Debes aprobar el Quiz Final con mínimo 9.5 (95%) para obtener el certificado');
  }

  const existenteRes = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );

  if (existenteRes.rows.length > 0) {
    return { yaTieneCertificado: true, certificadoId: existenteRes.rows[0].id, emitidoEn: existenteRes.rows[0].emitido_en };
  }

  const resultado = await consulta(
    'INSERT INTO curso_certificados (usuario_id) VALUES ($1) RETURNING id, emitido_en',
    [usuarioId]
  );

  return { otorgado: true, certificadoId: resultado.rows[0].id, emitidoEn: resultado.rows[0].emitido_en };
}

export async function tieneCertificado(usuarioId) {
  const resultado = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );
  return resultado.rows.length > 0 ? resultado.rows[0] : null;
}

export async function generarCertificadoPDF(usuarioId) {
  let certificado = await tieneCertificado(usuarioId);

  if (!certificado) {
    const { completado } = await verificarCompletacionCurso(usuarioId);
    if (!completado) {
      throw new Error('Debes aprobar el Quiz Final con mínimo 9.5 (95%) para descargar el certificado.');
    }
    await otorgarCertificado(usuarioId);
    certificado = await tieneCertificado(usuarioId);
  }

  const usuarioRes = await consulta('SELECT nombre FROM usuarios WHERE id = $1', [usuarioId]);
  const nombre = usuarioRes.rows[0]?.nombre || 'Usuario';

  return await generarPDF(nombre, certificado.emitido_en);
}