-- ===========================================================================
-- MIGRACIÓN: Microcurso de Scrum integrado con ScrumFlow
-- ===========================================================================

CREATE TABLE IF NOT EXISTS curso_lecciones (
  id SERIAL PRIMARY KEY,
  orden INTEGER NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL, -- Contenido dual: Teoría de Scrum + Uso en ScrumFlow
  seccion TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS curso_progreso_lecciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  completada BOOLEAN NOT NULL DEFAULT FALSE,
  posicion_scroll NUMERIC(5, 2) NOT NULL DEFAULT 0, -- Porcentaje de lectura guardado
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, leccion_id)
);
CREATE INDEX IF NOT EXISTS ix_curso_progreso_usuario ON curso_progreso_lecciones(usuario_id);

CREATE TABLE IF NOT EXISTS curso_quizzes (
  id SERIAL PRIMARY KEY,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  opciones JSONB NOT NULL,
  respuesta_correcta INTEGER NOT NULL -- Índice de la opción correcta (0, 1, 2...)
);

CREATE TABLE IF NOT EXISTS curso_intentos_quizzes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  calificacion NUMERIC(5, 2) NOT NULL DEFAULT 0, -- 0 a 100%
  aprobado BOOLEAN NOT NULL DEFAULT FALSE,
  intentos INTEGER NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, leccion_id)
);

-- ===========================================================================
-- SEED: Contenido Teórico + Práctico en ScrumFlow
-- ===========================================================================
INSERT INTO curso_lecciones (orden, titulo, contenido, seccion) VALUES
(
  1, 
  '1. Fundamentos Ágiles y el Tablero Kanban', 
  '<h3>Teoría de Scrum</h3><p>Scrum es un marco de trabajo ligero que ayuda a las personas, equipos y organizaciones a generar valor mediante soluciones complejos. Se basa en la transparencia, inspección y adaptación.</p><h3>Cómo se usa en ScrumFlow</h3><p>En nuestra plataforma, el trabajo se organiza en Sprints y se visualiza en el módulo de <strong>Tablero</strong> (<code>/pages/tablero.html</code>). Las tarjetas se mueven entre columnas (Por hacer, En progreso, Hecho) arrastrándolas en tiempo real gracias a WebSockets.</p>', 
  'Introducción'
),
(
  2, 
  '2. Roles en el Proyecto: Scrum Master, Product Owner y Developers', 
  '<h3>Teoría de Roles</h3><p>El equipo Scrum consta de un Scrum Master (que asegura el proceso y elimina impedimentos), un Product Owner (que gestiona el Backlog y maximiza el valor) y los Developers (que construyen el incremento).</p><h3>Cómo se usa en ScrumFlow</h3><p>Los roles se asignan de forma independiente por cada proyecto en la tabla <code>miembros_proyecto</code>. Dependiendo de tu rol en el proyecto activo, la barra superior y los permisos (<code>permisos-ui.js</code>) adaptarán las herramientas disponibles para ti.</p>', 
  'Roles'
),
(
  3, 
  '3. Sprints, Capacidad y Planificación', 
  '<h3>Teoría de Sprints</h3><p>Los Sprints son contenedores de un mes o menos para crear consistencia, con una duración fija. Ningún cambio altera la calidad del Sprint Goal.</p><h3>Cómo se usa en ScrumFlow</h3><p>Antes de arrancar, cada integrante configura sus horas disponibles y ausencias en el módulo de <strong>Capacidad</strong> (<code>/pages/capacidad.html</code>). El sistema calcula automáticamente la capacidad total del equipo para el Sprint en curso.</p>', 
  'Planificación'
),
(
  4, 
  '4. Ceremonias Ágiles: Daily, Review y Retrospectiva', 
  '<h3>Teoría de Ceremonias</h3><p>El evento Daily Standup alinea al equipo cada 24 horas. Al finalizar el Sprint, la Review inspecciona el incremento y la Retro busca mejoras continuas.</p><h3>Cómo se usa en ScrumFlow</h3><p>Registra tus pendientes en el módulo <strong>Daily</strong> (<code>/pages/daily.html</code>) y mide el tiempo real invertido en cada tarea utilizando el temporizador nativo del servidor para evitar pérdida de datos.</p>', 
  'Ejecución'
)
ON CONFLICT (orden) DO NOTHING;

-- Quizzes de ejemplo para cada lección (respuesta_correcta es el índice basado en 0)
INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta) 
SELECT l.id, q.pregunta, q.opciones::jsonb, q.resp 
FROM curso_lecciones l
JOIN (VALUES
  (1, '¿Qué pilar fundamental de Scrum se refleja al mover tarjetas en el Tablero Kanban en tiempo real?', '["Transparencia y visibilidad", "Ocultar información", "Trabajar sin orden"]'::json, 0),
  (2, '¿Dónde se definen los roles de Scrum Master, Product Owner y Developer en ScrumFlow?', '["En el perfil global del usuario", "Dentro de cada proyecto en miembros_proyecto", "En el archivo .env"]'::json, 1),
  (3, '¿Qué módulo de ScrumFlow permite registrar las horas disponibles y vacaciones de cada integrante?', '["Módulo de Capacidad", "Módulo de Bitácora", "Módulo de Login"]'::json, 0),
  (4, '¿Para qué sirve el temporizador de tareas integrado en ScrumFlow?', '["Para medir horas reales en el servidor sin perder tiempo si se cierra el navegador", "Para bloquear la computadora", "Para enviar correos masivos"]'::json, 0)
) AS q(orden, pregunta, opciones, resp) ON l.orden = q.orden
ON CONFLICT DO NOTHING;