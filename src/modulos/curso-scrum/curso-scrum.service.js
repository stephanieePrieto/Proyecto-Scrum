import { consulta } from '../../config/db.js';

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

  // Si es Scrum Master de este proyecto, obtener el progreso global de todos los integrantes
  let progresoEquipo = [];
  if (rolEnProyecto === 'scrum_master' || rolEnProyecto === 'product_owner') {
    const equipoRes = await consulta(`
      mp.usuario_id, u.nombre, u.correo, mp.rol,
      COUNT(DISTINCT l.id) AS total_lecciones,
      COUNT(DISTINCT p.leccion_id) FILTER (WHERE p.completada = TRUE) AS lecciones_completadas
      FROM miembros_proyecto mp
      JOIN usuarios u ON u.id = mp.usuario_id
      CROSS JOIN curso_lecciones l
      LEFT JOIN curso_progreso_lecciones p ON p.leccion_id = l.id AND p.usuario_id = mp.usuario_id AND p.completada = TRUE
      WHERE mp.proyecto_id = $1
      GROUP BY mp.usuario_id, u.nombre, u.correo, mp.rol
    `, [proyectoId]);
    progresoEquipo = equipoRes.rows;
  }

  return {
    rolEnProyecto,
    lecciones: leccionesRes.rows,
    quizzes: quizzesRes.rows,
    progresoEquipo
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
}

export async function calificarQuiz(usuarioId, leccionId, respuestasUsuario) {
  // respuestasUsuario es un objeto { quizId: opcionSeleccionadaIndex }
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
  const aprobado = calificacion >= 100; // Exige 100% como acordamos

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