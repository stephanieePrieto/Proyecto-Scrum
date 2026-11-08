-- ===========================================================================
-- MICROCURSO DE SCRUM - ESQUEMA DE BASE DE DATOS
-- Descripción: Estructura para el micro curso de Scrum con seguimiento de progreso,

-- ===========================================================================
-- TABLA: curso_lecciones
-- Descripción: Almacena las lecciones/módulos del curso.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS curso_lecciones (
  id SERIAL PRIMARY KEY,
  orden INTEGER NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  seccion TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para ordenar lecciones rápidamente
CREATE INDEX IF NOT EXISTS ix_curso_lecciones_orden ON curso_lecciones(orden);

-- ===========================================================================
-- TABLA: curso_progreso_lecciones
-- Descripción: Registra el progreso de lectura de cada usuario por lección.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS curso_progreso_lecciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  completada BOOLEAN NOT NULL DEFAULT FALSE,
  posicion_scroll NUMERIC(5, 2) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, leccion_id)
);

-- Índices para consultas rápidas de progreso por usuario
CREATE INDEX IF NOT EXISTS ix_curso_progreso_usuario ON curso_progreso_lecciones(usuario_id);
CREATE INDEX IF NOT EXISTS ix_curso_progreso_leccion ON curso_progreso_lecciones(leccion_id);

-- ===========================================================================
-- TABLA: curso_quizzes
-- Descripción: Almacena las preguntas y opciones de los quizzes por lección.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS curso_quizzes (
  id SERIAL PRIMARY KEY,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  opciones JSONB NOT NULL,
  respuesta_correcta INTEGER NOT NULL
);

-- Índice para agrupar quizzes por lección
CREATE INDEX IF NOT EXISTS ix_curso_quizzes_leccion ON curso_quizzes(leccion_id);

-- ===========================================================================
-- TABLA: curso_intentos_quizzes
-- Descripción: Registra los intentos, calificaciones y aprobación de quizzes por usuario.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS curso_intentos_quizzes (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  calificacion NUMERIC(5, 2) NOT NULL DEFAULT 0,
  aprobado BOOLEAN NOT NULL DEFAULT FALSE,
  intentos INTEGER NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, leccion_id)
);

-- Índices para consultas rápidas de quizzes por usuario
CREATE INDEX IF NOT EXISTS ix_curso_intentos_usuario ON curso_intentos_quizzes(usuario_id);
CREATE INDEX IF NOT EXISTS ix_curso_intentos_leccion ON curso_intentos_quizzes(leccion_id);

-- ===========================================================================
-- TABLA: curso_certificados
-- Descripción: Almacena los certificados emitidos a usuarios que completaron el curso.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS curso_certificados (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  emitido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id)
);

CREATE INDEX IF NOT EXISTS ix_curso_certificados_usuario ON curso_certificados(usuario_id);

-- ===========================================================================
-- SEED: Contenido inicial del curso (4 lecciones con quizzes)
-- ===========================================================================
INSERT INTO curso_lecciones (orden, titulo, contenido, seccion) VALUES
(1, '1. Fundamentos Ágiles y el Tablero Kanban',
'<h3>Teoría de Scrum</h3>
<p>Scrum es un marco de trabajo ligero que ayuda a las personas, equipos y organizaciones a generar valor mediante soluciones adaptativas a problemas complejos. Se basa en la <strong>transparencia</strong>, <strong>inspección</strong> y <strong>adaptación</strong>.</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>En nuestra plataforma, el trabajo se organiza en Sprints y se visualiza en el módulo de <strong>Tablero</strong> (<code>/pages/tablero.html</code>). Las tarjetas se mueven entre columnas (Por hacer, En progreso, Hecho) arrastrándolas en tiempo real gracias a WebSockets.</p>',
'Introducción'),

(2, '2. Roles en el Proyecto: Scrum Master, Product Owner y Developers',
'<h3>Teoría de Roles</h3>
<p>El equipo Scrum consta de tres roles clave:
<ul>
<li><strong>Scrum Master</strong>: Asegura el proceso Scrum, elimina impedimentos y protege al equipo de interferencias externas.</li>
<li><strong>Product Owner</strong>: Gestiona el Product Backlog, prioriza ítems y maximiza el valor del producto.</li>
<li><strong>Developers</strong>: Construyen el incremento del producto en cada Sprint.</li>
</ul>
</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>Los roles se asignan <strong>por proyecto</strong> en la tabla <code>miembros_proyecto</code>. Dependiendo de tu rol en el proyecto activo, la barra superior y los permisos (<code>permisos-ui.js</code>) adaptarán las herramientas disponibles.</p>',
'Roles'),

(3, '3. Sprints, Capacidad y Planificación',
'<h3>Teoría de Sprints</h3>
<p>Los Sprints son contenedores de <strong>un mes o menos</strong> para crear consistencia. Tienen:
<ul>
<li>Una <strong>duración fija</strong> (no se alarga).</li>
<li>Un <strong>Sprint Goal</strong> (objetivo claro).</li>
<li>Una <strong>revisión</strong> al final (Sprint Review).</li>
<li>Una <strong>retrospectiva</strong> para mejorar (Sprint Retrospective).</li>
</ul>
Ningún cambio altera la calidad del Sprint Goal.</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>Antes de arrancar un Sprint, cada integrante configura sus horas disponibles y ausencias en el módulo de <strong>Capacidad</strong> (<code>/pages/capacidad.html</code>). El sistema calcula automáticamente la capacidad total del equipo.</p>',
'Planificación'),

(4, '4. Ceremonias Ágiles: Daily, Review y Retrospectiva',
'<h3>Teoría de Ceremonias</h3>
<p>Scrum define eventos clave para mantener el ritmo:
<ul>
<li><strong>Daily Scrum</strong>: Reunión diaria de 15 minutos para alinear al equipo. Responde: ¿Qué hice ayer? ¿Qué haré hoy? ¿Qué impedimentos tengo?</li>
<li><strong>Sprint Review</strong>: Al final del Sprint, se inspecciona el incremento y se adapta el Backlog.</li>
<li><strong>Sprint Retrospective</strong>: El equipo reflexiona sobre cómo mejorar en el próximo Sprint.</li>
</ul>
</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>Registra tus pendientes en el módulo <strong>Daily</strong> (<code>/pages/daily.html</code>) y mide el tiempo real invertido en cada tarea utilizando el temporizador nativo del servidor para evitar pérdida de datos si cierras el navegador.</p>',
'Ejecución')
ON CONFLICT (orden) DO NOTHING;

-- ===========================================================================
-- SEED: Quizzes de ejemplo (1 por lección)
-- ===========================================================================
INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta)
SELECT l.id, q.pregunta, q.opciones::jsonb, q.respuesta_correcta
FROM curso_lecciones l
JOIN (
  VALUES
    (1, '¿Qué pilar fundamental de Scrum se refleja al mover tarjetas en el Tablero Kanban en tiempo real?',
     '{"0":"Transparencia y visibilidad", "1":"Ocultar información", "2":"Trabajar sin orden"}'::json, 0),
    (2, '¿Dónde se definen los roles de Scrum Master, Product Owner y Developer en ScrumFlow?',
     '{"0":"En el perfil global del usuario", "1":"Dentro de cada proyecto en miembros_proyecto", "2":"En el archivo .env"}'::json, 1),
    (3, '¿Qué módulo de ScrumFlow permite registrar las horas disponibles y vacaciones de cada integrante?',
     '{"0":"Módulo de Capacidad", "1":"Módulo de Bitácora", "2":"Módulo de Login"}'::json, 0),
    (4, '¿Para qué sirve el temporizador de tareas integrado en ScrumFlow?',
     '{"0":"Para medir horas reales en el servidor sin perder tiempo si se cierra el navegador", "1":"Para bloquear la computadora", "2":"Para enviar correos masivos"}'::json, 0)
) AS q(orden, pregunta, opciones, respuesta_correcta)
ON l.orden = q.orden
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- NOTA: Para habiltar la generación de PDFs, instalar en el backend:
-- npm install pdf-lib
-- ===========================================================================