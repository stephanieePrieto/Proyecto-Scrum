/**
 * ===========================================================================
 * SERVICIOS PARA EL MICROCURSO DE SCRUM
 * Autor: Stephanie Elizdeth Hernández Prieto
 * Descripción: Manejo de lecciones, quizzes, seguimiento de progreso y certificados.
 * ===========================================================================
 */

import { consulta } from '../../config/db.js';
import { generarPDF } from '../../utils/pdf-generator.js';

// ===========================================================================
// FUNCIONES PRINCIPALES
// ===========================================================================

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
    LEFT JOIN curso_progreso_lecciones p ON p.leccion_id = l.id AND p.usuario_id = $1
    LEFT JOIN curso_intentos_quizzes q_intento ON q_intento.leccion_id = l.id AND q_intento.usuario_id = $1
    ORDER BY l.orden ASC;
  `, [usuarioId]);

  // Obtener preguntas de quizzes
  const quizzesRes = await consulta(`
    SELECT id, leccion_id, pregunta, opciones FROM curso_quizzes ORDER BY leccion_id, id;
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
        CASE WHEN c.id IS NOT NULL THEN TRUE ELSE FALSE END AS tiene_certificado
      FROM miembros_proyecto mp
      JOIN usuarios u ON u.id = mp.usuario_id
      CROSS JOIN curso_lecciones l
      LEFT JOIN curso_progreso_lecciones p ON p.leccion_id = l.id AND p.usuario_id = mp.usuario_id AND p.completada = TRUE
      LEFT JOIN curso_intentos_quizzes q ON q.leccion_id = l.id AND q.usuario_id = mp.usuario_id AND q.aprobado = TRUE
      LEFT JOIN curso_certificados c ON c.usuario_id = mp.usuario_id
      WHERE mp.proyecto_id = $1
      GROUP BY mp.usuario_id, u.nombre, u.correo, mp.rol, c.id
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
    porcentajeAvance
  };
}

export async function guardarProgresoLectura(usuarioId, leccionId, completada, posicionScroll) {
  await consulta(`
    INSERT INTO curso_progreso_lecciones (usuario_id, leccion_id, completada, posicion_scroll, actualizado_en)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (usuario_id, leccion_id)
    DO UPDATE SET 
      completada = EXCLUDED.completada,
      posicion_scroll = GREATEST(curso_progreso_lecciones.posicion_scroll, EXCLUDED.posicion_scroll),
      actualizado_en = NOW();
  `, [usuarioId, leccionId, completada, posicionScroll]);

  // Verificar si completó el curso para emitir certificado automáticamente
  const { completado } = await verificarCompletacionCurso(usuarioId);
  if (completado) {
    try {
      await otorgarCertificado(usuarioId);
    } catch (e) {
      // Si ya lo tiene emitido no rompe la ejecución
    }
  }
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
  const aprobado = calificacion >= 100; // 100% para aprobar

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

  // Verificar si completó el curso para emitir certificado automáticamente
  const { completado } = await verificarCompletacionCurso(usuarioId);
  if (completado) {
    try {
      await otorgarCertificado(usuarioId);
    } catch (e) {
      // Si ya lo tiene emitido no rompe la ejecución
    }
  }

  return { calificacion, aprobado };
}

// ===========================================================================
// FUNCIONES DE CERTIFICADO Y REINICIO
// ===========================================================================

export async function verificarCompletacionCurso(usuarioId) {
  const leccionesRes = await consulta('SELECT id FROM curso_lecciones');
  const totalLecciones = leccionesRes.rows.length;

  if (totalLecciones === 0) return { completado: false, porcentaje: 0, leccionesCompletadas: 0, quizzesAprobados: 0, totalLecciones: 0 };

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

  return { completado, porcentaje, leccionesCompletadas, quizzesAprobados, totalLecciones };
}

export async function otorgarCertificado(usuarioId) {
  const { completado } = await verificarCompletacionCurso(usuarioId);

  if (!completado) {
    throw new Error('El usuario no ha completado el curso');
  }

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

export async function tieneCertificado(usuarioId) {
  const resultado = await consulta(
    'SELECT id, emitido_en FROM curso_certificados WHERE usuario_id = $1',
    [usuarioId]
  );
  return resultado.rows.length > 0 ? resultado.rows[0] : null;
}

/**
 * Genera un PDF del certificado para un usuario.
 * Emite automáticamente el registro en la base de datos si el usuario ya completó el curso.
 */
export async function generarCertificadoPDF(usuarioId) {
  let certificado = await tieneCertificado(usuarioId);

  if (!certificado) {
    const { completado } = await verificarCompletacionCurso(usuarioId);
    if (!completado) {
      throw new Error('El usuario no ha completado el curso');
    }
    // Forzar la creación de la fila en curso_certificados
    await otorgarCertificado(usuarioId);
    certificado = await tieneCertificado(usuarioId);
  }

  const usuarioRes = await consulta(
    'SELECT nombre FROM usuarios WHERE id = $1',
    [usuarioId]
  );
  const nombre = usuarioRes.rows[0]?.nombre || 'Usuario';

  const pdfBuffer = await generarPDF(nombre, certificado.emitido_en);
  return pdfBuffer;
}

export async function reiniciarProgresoCurso(usuarioId) {
  await consulta('DELETE FROM curso_progreso_lecciones WHERE usuario_id = $1', [usuarioId]);
  await consulta('DELETE FROM curso_intentos_quizzes WHERE usuario_id = $1', [usuarioId]);
  return { reiniciado: true };
}

// ===========================================================================
// FUNCIONES ADMIN (CRUD)
// ===========================================================================

export async function obtenerTodosLosModulos() {
  const resultado = await consulta(`
    SELECT id, orden, titulo, contenido, seccion, creado_en 
    FROM curso_lecciones 
    ORDER BY orden ASC
  `);
  return resultado.rows;
}

export async function crearModulo(orden, titulo, contenido, seccion) {
  const resultado = await consulta(`
    INSERT INTO curso_lecciones (orden, titulo, contenido, seccion)
    VALUES ($1, $2, $3, $4)
    RETURNING id, orden, titulo, contenido, seccion, creado_en
  `, [orden, titulo, contenido, seccion]);
  return resultado.rows[0];
}

export async function actualizarModulo(id, orden, titulo, contenido, seccion) {
  const resultado = await consulta(`
    UPDATE curso_lecciones 
    SET orden = $2, titulo = $3, contenido = $4, seccion = $5
    WHERE id = $1
    RETURNING id, orden, titulo, contenido, seccion, creado_en
  `, [id, orden, titulo, contenido, seccion]);
  return resultado.rows[0];
}

export async function eliminarModulo(id) {
  await consulta('DELETE FROM curso_lecciones WHERE id = $1', [id]);
  return { eliminado: true };
}

export async function reordenarModulos(nuevosOrdenes) {
  for (const { id, nuevoOrden } of nuevosOrdenes) {
    await consulta(
      'UPDATE curso_lecciones SET orden = $2 WHERE id = $1',
      [id, nuevoOrden]
    );
  }
  return { reordenado: true };
}

export async function obtenerQuizzesPorLeccion(leccionId) {
  const resultado = await consulta(`
    SELECT id, leccion_id, pregunta, opciones, respuesta_correcta 
    FROM curso_quizzes 
    WHERE leccion_id = $1 
    ORDER BY id ASC
  `, [leccionId]);
  return resultado.rows;
}

export async function crearQuiz(leccionId, pregunta, opciones, respuestaCorrecta) {
  const resultado = await consulta(`
    INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta)
    VALUES ($1, $2, $3, $4)
    RETURNING id, leccion_id, pregunta, opciones, respuesta_correcta
  `, [leccionId, pregunta, JSON.stringify(opciones), respuestaCorrecta]);
  return resultado.rows[0];
}

export async function actualizarQuiz(id, pregunta, opciones, respuestaCorrecta) {
  const resultado = await consulta(`
    UPDATE curso_quizzes 
    SET pregunta = $2, opciones = $3, respuesta_correcta = $4
    WHERE id = $1
    RETURNING id, leccion_id, pregunta, opciones, respuesta_correcta
  `, [id, pregunta, JSON.stringify(opciones), respuestaCorrecta]);
  return resultado.rows[0];
}

export async function eliminarQuiz(id) {
  await consulta('DELETE FROM curso_quizzes WHERE id = $1', [id]);
  return { eliminado: true };
}