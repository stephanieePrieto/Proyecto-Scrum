/**
 * ===========================================================================
 * MICROCURSO DE SCRUM - SERVICIOS
 * ===========================================================================
 */

import { consulta } from '../../config/db.js';
import { generarPDF } from '../../utils/pdf-generator.js'; // Para generación de PDF

// ===========================================================================
// FUNCIONES PRINCIPALES
// ===========================================================================

/**
 * Obtiene el temario del curso y el progreso del usuario en un proyecto.
 * @param {number} usuarioId - ID del usuario autenticado.
 * @param {number} proyectoId - ID del proyecto actual.
 * @returns {Promise<Object>} - Objeto con lecciones, quizzes, progreso del equipo (si es SM/PO), certificado y % de avance.
 */
export async function obtenerTemarioYProgreso(usuarioId, proyectoId) {
  // Verificar rol del usuario en el proyecto actual
  const rolRes = await consulta(
    'SELECT rol FROM miembros_proyecto WHERE usuario_id = $1 AND proyecto_id = $2',
    [usuarioId, proyectoId]
  );
  const rolEnProyecto = rolRes.rows[0]?.rol || null;

  // Obtener lecciones con su progreso y quizzes
  const leccionesRes = await consulta(`
    SELECT
      l.id, l.orden, l.titulo, l.contenido, l.seccion,
      COALESCE(p.completada, FALSE) AS completada,
      COALESCE(p.posicion_scroll, 0) AS posicion_scroll,
      COALESCE(q_intento.calificacion, 0) AS calificacion_quiz,
      COALESCE(q_intento.aprobado, FALSE) AS quiz_aprobado
    FROM curso_lecciones l
    LEFT JOIN curso_progreso_lecciones p
      ON p.leccion_id = l.id AND p.usuario_id = $1
    LEFT JOIN curso_intentos_quizzes q_intento
      ON q_intento.leccion_id = l.id AND q_intento.usuario_id = $1
    ORDER BY l.orden ASC;
  `, [usuarioId]);

  // Obtener preguntas de quizzes
  const quizzesRes = await consulta(`
    SELECT id, leccion_id, pregunta, opciones
    FROM curso_quizzes
    ORDER BY leccion_id, id;
  `);

  // Verificar si el usuario tiene certificado
  const certificadoRes = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );
  const tieneCertificado = certificadoRes.rows.length > 0;
  const certificadoData = tieneCertificado ? certificadoRes.rows[0] : null;

  // Calcular porcentaje de avance
  const totalLecciones = leccionesRes.rows.length;
  const leccionesCompletadas = leccionesRes.rows.filter(l => l.completada).length;
  const quizzesAprobados = leccionesRes.rows.filter(l => l.quiz_aprobado).length;

  // Fórmula: (lecciones_completadas + quizzes_aprobados) / (total_lecciones * 2) * 100
  const porcentajeAvance = totalLecciones > 0
    ? Math.round(((leccionesCompletadas + quizzesAprobados) / (totalLecciones * 2)) * 100)
    : 0;

  // Si es Scrum Master o Product Owner, obtener el progreso global del equipo
  let progresoEquipo = [];
  if (rolEnProyecto === 'scrum_master' || rolEnProyecto === 'product_owner') {
    const equipoRes = await consulta(`
      SELECT
        mp.usuario_id, u.nombre, u.correo, mp.rol,
        COUNT(DISTINCT l.id) AS total_lecciones,
        COUNT(DISTINCT p.leccion_id) FILTER (WHERE p.completada = TRUE) AS lecciones_completadas,
        COUNT(DISTINCT q.leccion_id) FILTER (WHERE q.aprobado = TRUE) AS quizzes_aprobados,
        CASE WHEN c.id IS NOT NULL THEN TRUE ELSE FALSE END AS tiene_certificado,
        c.emitido_en AS certificado_emitido_en
      FROM miembros_proyecto mp
      JOIN usuarios u ON u.id = mp.usuario_id
      CROSS JOIN curso_lecciones l
      LEFT JOIN curso_progreso_lecciones p
        ON p.leccion_id = l.id AND p.usuario_id = mp.usuario_id AND p.completada = TRUE
      LEFT JOIN curso_intentos_quizzes q
        ON q.leccion_id = l.id AND q.usuario_id = mp.usuario_id AND q.aprobado = TRUE
      LEFT JOIN curso_certificados c ON c.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1
      GROUP BY mp.usuario_id, u.nombre, u.correo, mp.rol, c.id, c.emitido_en
    `, [proyectoId]);
    progresoEquipo = equipoRes.rows;
  }

  return {
    rolEnProyecto,
    lecciones: leccionesRes.rows,
    quizzes: quizzesRes.rows,
    progresoEquipo,
    certificado: {
      tieneCertificado,
      ...certificadoData
    },
    porcentajeAvance,
    estadisticas: {
      totalLecciones,
      leccionesCompletadas,
      quizzesAprobados
    }
  };
}

/**
 * Guarda el progreso de lectura de una lección.
 * @param {number} usuarioId - ID del usuario.
 * @param {number} leccionId - ID de la lección.
 * @param {boolean} completada - Si la lección fue completada.
 * @param {number} posicionScroll - Posición del scroll (0-100).
 */
export async function guardarProgresoLectura(usuarioId, leccionId, completada, posicionScroll) {
  await consulta(`
    INSERT INTO curso_progreso_lecciones
      (usuario_id, leccion_id, completada, posicion_scroll, actualizado_en)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET
      completada = EXCLUDED.completada,
      posicion_scroll = GREATEST(curso_progreso_lecciones.posicion_scroll, EXCLUDED.posicion_scroll),
      actualizado_en = NOW();
  `, [usuarioId, leccionId, completada, posicionScroll]);

  // Verificar si el usuario completó el curso y otorgar certificado automáticamente
  const { completado } = await verificarCompletacionCurso(usuarioId);
  if (completado) {
    await otorgarCertificado(usuarioId);
  }
}

/**
 * Califica un quiz y registra el intento.
 * @param {number} usuarioId - ID del usuario.
 * @param {number} leccionId - ID de la lección.
 * @param {Object} respuestasUsuario - Objeto con las respuestas del usuario (ej: {1: 0, 2: 1}).
 * @returns {Promise<Object>} - Objeto con calificacion y aprobado.
 */
export async function calificarQuiz(usuarioId, leccionId, respuestasUsuario) {
  const quizzesRes = await consulta(
    'SELECT id, respuesta_correcta FROM curso_quizzes WHERE leccion_id = $1',
    [leccionId]
  );
  const quizzes = quizzesRes.rows;

  // Si no hay quizzes para esta lección, aprobar automáticamente
  if (quizzes.length === 0) {
    await consulta(`
      INSERT INTO curso_intentos_quizzes
        (usuario_id, leccion_id, calificacion, aprobado, intentos, actualizado_en)
      VALUES ($1, $2, 100, TRUE, 1, NOW())
      ON CONFLICT (usuario_id, leccion_id)
      DO UPDATE SET
        calificacion = GREATEST(curso_intentos_quizzes.calificacion, EXCLUDED.calificacion),
        aprobado = TRUE,
        intentos = curso_intentos_quizzes.intentos + 1,
        actualizado_en = NOW();
    `, [usuarioId, leccionId]);

    // Verificar si completó el curso
    const { completado } = await verificarCompletacionCurso(usuarioId);
    if (completado) {
      await otorgarCertificado(usuarioId);
    }

    return { calificacion: 100, aprobado: true };
  }

  // Calificar respuestas
  let correctas = 0;
  quizzes.forEach(q => {
    if (Number(respuestasUsuario[q.id]) === Number(q.respuesta_correcta)) {
      correctas++;
    }
  });

  const calificacion = Number(((correctas / quizzes.length) * 100).toFixed(2));
  const aprobado = calificacion >= 100; // 100% para aprobar

  // Guardar intento
  await consulta(`
    INSERT INTO curso_intentos_quizzes
      (usuario_id, leccion_id, calificacion, aprobado, intentos, actualizado_en)
    VALUES ($1, $2, $3, $4, 1, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET
      calificacion = GREATEST(curso_intentos_quizzes.calificacion, EXCLUDED.calificacion),
      aprobado = CASE WHEN EXCLUDED.aprobado THEN TRUE ELSE curso_intentos_quizzes.aprobado END,
      intentos = curso_intentos_quizzes.intentos + 1,
      actualizado_en = NOW();
  `, [usuarioId, leccionId, calificacion, aprobado]);

  // Verificar si completó el curso y otorgar certificado automáticamente
  const { completado } = await verificarCompletacionCurso(usuarioId);
  if (completado) {
    await otorgarCertificado(usuarioId);
  }

  return { calificacion, aprobado };
}

// ===========================================================================
// FUNCIONES DE CERTIFICADO Y REINICIO
// ===========================================================================

/**
 * Verifica si el usuario ha completado el curso (100% lecciones + 100% quizzes).
 * @param {number} usuarioId - ID del usuario.
 * @returns {Promise<Object>} - Objeto con completado, porcentaje, leccionesCompletadas, quizzesAprobados, totalLecciones.
 */
export async function verificarCompletacionCurso(usuarioId) {
  const leccionesRes = await consulta('SELECT id FROM curso_lecciones');
  const totalLecciones = leccionesRes.rows.length;

  if (totalLecciones === 0) {
    return { completado: false, porcentaje: 0, leccionesCompletadas: 0, quizzesAprobados: 0, totalLecciones: 0 };
  }

  const completadasRes = await consulta(`
    SELECT COUNT(*) AS count
    FROM curso_progreso_lecciones
    WHERE usuario_id = $1 AND completada = TRUE
  `, [usuarioId]);
  const leccionesCompletadas = parseInt(completadasRes.rows[0].count);

  const aprobadosRes = await consulta(`
    SELECT COUNT(*) AS count
    FROM curso_intentos_quizzes
    WHERE usuario_id = $1 AND aprobado = TRUE
  `, [usuarioId]);
  const quizzesAprobados = parseInt(aprobadosRes.rows[0].count);

  const porcentaje = Math.round(
    ((leccionesCompletadas + quizzesAprobados) / (totalLecciones * 2)) * 100
  );

  const completado = leccionesCompletadas === totalLecciones &&
                     quizzesAprobados === totalLecciones;

  return {
    completado,
    porcentaje,
    leccionesCompletadas,
    quizzesAprobados,
    totalLecciones
  };
}

/**
 * Otorga un certificado a un usuario si ha completado el curso.
 * @param {number} usuarioId - ID del usuario.
 * @returns {Promise<Object>} - Objeto con otorgado, certificadoId, emitidoEn o yaTieneCertificado.
 * @throws {Error} - Si el usuario no ha completado el curso.
 */
export async function otorgarCertificado(usuarioId) {
  const { completado } = await verificarCompletacionCurso(usuarioId);

  if (!completado) {
    throw new Error('El usuario no ha completado el curso');
  }

  // Verificar si ya tiene certificado
  const existenteRes = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );

  if (existenteRes.rows.length > 0) {
    return {
      yaTieneCertificado: true,
      certificadoId: existenteRes.rows[0].id,
      emitidoEn: existenteRes.rows[0].emitido_en
    };
  }

  // Crear nuevo certificado
  const resultado = await consulta(
    'INSERT INTO curso_certificados (usuario_id) VALUES ($1) RETURNING id, emitido_en',
    [usuarioId]
  );

  return {
    otorgado: true,
    certificadoId: resultado.rows[0].id,
    emitidoEn: resultado.rows[0].emitido_en
  };
}

/**
 * Verifica si un usuario tiene certificado.
 * @param {number} usuarioId - ID del usuario.
 * @returns {Promise<Object|null>} - Datos del certificado o null.
 */
export async function tieneCertificado(usuarioId) {
  const resultado = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );
  return resultado.rows.length > 0 ? resultado.rows[0] : null;
}

/**
 * Genera un PDF del certificado para un usuario.
 * @param {number} usuarioId - ID del usuario.
 * @returns {Promise<Uint8Array>} - Buffer del PDF generado.
 * @throws {Error} - Si el usuario no tiene certificado.
 */
export async function generarCertificadoPDF(usuarioId) {
  const certificado = await tieneCertificado(usuarioId);
  if (!certificado) {
    throw new Error('El usuario no tiene certificado');
  }

  const usuarioRes = await consulta(
    'SELECT nombre FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  const nombre = usuarioRes.rows[0]?.nombre || 'Usuario';

  const pdfBuffer = await generarPDF(nombre, certificado.emitido_en);
  return pdfBuffer;
}

/**
 * Reinicia el progreso del curso para un usuario (sin eliminar el certificado).
 * @param {number} usuarioId - ID del usuario.
 * @returns {Promise<Object>} - Objeto con reiniciado: true.
 */
export async function reiniciarProgresoCurso(usuarioId) {
  // Eliminar progreso de lecciones
  await consulta('DELETE FROM curso_progreso_lecciones WHERE usuario_id = $1', [usuarioId]);

  // Eliminar intentos de quizzes
  await consulta('DELETE FROM curso_intentos_quizzes WHERE usuario_id = $1', [usuarioId]);

  // NO eliminamos el certificado para mantener historial
  return { reiniciado: true };
}

// ===========================================================================
// FUNCIONES ADMIN (CRUD de contenido)
// ===========================================================================

/**
 * Obtiene todos los módulos/lecciones del curso.
 * @returns {Promise<Array>} - Lista de módulos.
 */
export async function obtenerTodosLosModulos() {
  const resultado = await consulta(`
    SELECT id, orden, titulo, contenido, seccion, creado_en
    FROM curso_lecciones
    ORDER BY orden ASC
  `);
  return resultado.rows;
}

/**
 * Crea un nuevo módulo/lección.
 * @param {number} orden - Orden del módulo.
 * @param {string} titulo - Título del módulo.
 * @param {string} contenido - Contenido HTML del módulo.
 * @param {string} seccion - Sección a la que pertenece.
 * @returns {Promise<Object>} - Módulo creado.
 */
export async function crearModulo(orden, titulo, contenido, seccion) {
  const resultado = await consulta(`
    INSERT INTO curso_lecciones (orden, titulo, contenido, seccion)
    VALUES ($1, $2, $3, $4)
    RETURNING id, orden, titulo, contenido, seccion, creado_en
  `, [orden, titulo, contenido, seccion]);
  return resultado.rows[0];
}

/**
 * Actualiza un módulo existente.
 * @param {number} id - ID del módulo.
 * @param {number} orden - Nuevo orden.
 * @param {string} titulo - Nuevo título.
 * @param {string} contenido - Nuevo contenido.
 * @param {string} seccion - Nueva sección.
 * @returns {Promise<Object>} - Módulo actualizado.
 */
export async function actualizarModulo(id, orden, titulo, contenido, seccion) {
  const resultado = await consulta(`
    UPDATE curso_lecciones
    SET orden = $2, titulo = $3, contenido = $4, seccion = $5
    WHERE id = $1
    RETURNING id, orden, titulo, contenido, seccion, creado_en
  `, [id, orden, titulo, contenido, seccion]);
  return resultado.rows[0];
}

/**
 * Elimina un módulo.
 * @param {number} id - ID del módulo.
 * @returns {Promise<Object>} - Objeto con eliminado: true.
 */
export async function eliminarModulo(id) {
  await consulta('DELETE FROM curso_lecciones WHERE id = $1', [id]);
  return { eliminado: true };
}

/**
 * Reordena los módulos según el nuevo orden proporcionado.
 * @param {Array} nuevosOrdenes - Array de objetos {id, nuevoOrden}.
 * @returns {Promise<Object>} - Objeto con reordenado: true.
 */
export async function reordenarModulos(nuevosOrdenes) {
  for (const { id, nuevoOrden } of nuevosOrdenes) {
    await consulta(
      'UPDATE curso_lecciones SET orden = $2 WHERE id = $1',
      [id, nuevoOrden]
    );
  }
  return { reordenado: true };
}

/**
 * Obtiene todos los quizzes de una lección.
 * @param {number} leccionId - ID de la lección.
 * @returns {Promise<Array>} - Lista de quizzes.
 */
export async function obtenerQuizzesPorLeccion(leccionId) {
  const resultado = await consulta(`
    SELECT id, leccion_id, pregunta, opciones, respuesta_correcta
    FROM curso_quizzes
    WHERE leccion_id = $1
    ORDER BY id ASC
  `, [leccionId]);
  return resultado.rows;
}

/**
 * Crea un nuevo quiz.
 * @param {number} leccionId - ID de la lección.
 * @param {string} pregunta - Texto de la pregunta.
 * @param {Object} opciones - Objeto con las opciones (ej: {0: "Opción A", 1: "Opción B"}).
 * @param {number} respuestaCorrecta - Índice de la respuesta correcta.
 * @returns {Promise<Object>} - Quiz creado.
 */
export async function crearQuiz(leccionId, pregunta, opciones, respuestaCorrecta) {
  const resultado = await consulta(`
    INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta)
    VALUES ($1, $2, $3, $4)
    RETURNING id, leccion_id, pregunta, opciones, respuesta_correcta
  `, [leccionId, pregunta, JSON.stringify(opciones), respuestaCorrecta]);
  return resultado.rows[0];
}

/**
 * Actualiza un quiz existente.
 * @param {number} id - ID del quiz.
 * @param {string} pregunta - Nueva pregunta.
 * @param {Object} opciones - Nuevas opciones.
 * @param {number} respuestaCorrecta - Nuevo índice de la respuesta correcta.
 * @returns {Promise<Object>} - Quiz actualizado.
 */
export async function actualizarQuiz(id, pregunta, opciones, respuestaCorrecta) {
  const resultado = await consulta(`
    UPDATE curso_quizzes
    SET pregunta = $2, opciones = $3, respuesta_correcta = $4
    WHERE id = $1
    RETURNING id, leccion_id, pregunta, opciones, respuesta_correcta
  `, [id, pregunta, JSON.stringify(opciones), respuestaCorrecta]);
  return resultado.rows[0];
}

/**
 * Elimina un quiz.
 * @param {number} id - ID del quiz.
 * @returns {Promise<Object>} - Objeto con eliminado: true.
 */
export async function eliminarQuiz(id) {
  await consulta('DELETE FROM curso_quizzes WHERE id = $1', [id]);
  return { eliminado: true };
}