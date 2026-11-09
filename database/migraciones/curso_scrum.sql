-- ===========================================================================
-- MICROCURSO DE SCRUM - ESQUEMA DE BASE DE DATOS Y DATOS INICIALES
-- Autor: Stephanie Elizdeth Hernández Prieto
-- Descripción: Estructura de tablas, índices y semillas para lecciones y quizzes.
-- ===========================================================================

-- 1. TABLA: curso_lecciones
CREATE TABLE IF NOT EXISTS curso_lecciones (
  id SERIAL PRIMARY KEY,
  orden INTEGER NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  seccion TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_curso_lecciones_orden ON curso_lecciones(orden);

-- 2. TABLA: curso_progreso_lecciones
CREATE TABLE IF NOT EXISTS curso_progreso_lecciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  completada BOOLEAN NOT NULL DEFAULT FALSE,
  posicion_scroll NUMERIC(5, 2) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id, leccion_id)
);

CREATE INDEX IF NOT EXISTS ix_curso_progreso_usuario ON curso_progreso_lecciones(usuario_id);
CREATE INDEX IF NOT EXISTS ix_curso_progreso_leccion ON curso_progreso_lecciones(leccion_id);

-- 3. TABLA: curso_quizzes
CREATE TABLE IF NOT EXISTS curso_quizzes (
  id SERIAL PRIMARY KEY,
  leccion_id INTEGER NOT NULL REFERENCES curso_lecciones(id) ON DELETE CASCADE,
  pregunta TEXT NOT NULL,
  opciones JSONB NOT NULL,
  respuesta_correcta INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_curso_quizzes_leccion ON curso_quizzes(leccion_id);

-- 4. TABLA: curso_intentos_quizzes
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

CREATE INDEX IF NOT EXISTS ix_curso_intentos_usuario ON curso_intentos_quizzes(usuario_id);
CREATE INDEX IF NOT EXISTS ix_curso_intentos_leccion ON curso_intentos_quizzes(leccion_id);

-- 5. TABLA: curso_certificados
CREATE TABLE IF NOT EXISTS curso_certificados (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  emitido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (usuario_id)
);

CREATE INDEX IF NOT EXISTS ix_curso_certificados_usuario ON curso_certificados(usuario_id);

-- ===========================================================================
-- SEED: CONTENIDO DE LECCIONES (4 Módulos)
-- ===========================================================================
INSERT INTO curso_lecciones (orden, titulo, contenido, seccion) VALUES
(1, '1. Fundamentos Ágiles y el Tablero Kanban',
'<h3>Teoría de Scrum</h3>
<p>Scrum es un marco de trabajo ligero que ayuda a las personas, equipos y organizaciones a generar valor mediante soluciones adaptativas a problemas complejos. Se basa en el empirismo y el pensamiento Lean: <strong>transparencia</strong>, <strong>inspección</strong> y <strong>adaptación</strong>.</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>En nuestra plataforma, el trabajo se organiza en Sprints y se visualiza en el módulo de <strong>Tablero</strong>. Las tarjetas se mueven entre columnas (Por hacer, En progreso, Hecho) arrastrándolas en tiempo real gracias a WebSockets.</p>',
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
<p>Los roles se asignan <strong>por proyecto</strong> en la tabla <code>miembros_proyecto</code>. Dependiendo de tu rol en el proyecto activo, la barra superior y los permisos adaptarán las herramientas disponibles.</p>',
'Roles'),

(3, '3. Sprints, Capacidad y Planificación',
'<h3>Teoría de Sprints</h3>
<p>Los Sprints son contenedores de <strong>un mes o menos</strong> para crear consistencia. Tienen una duración fija, un Sprint Goal claro, una revisión al final (Sprint Review) y una retrospectiva (Sprint Retrospective).</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>Antes de arrancar un Sprint, cada integrante configura sus horas disponibles y ausencias en el módulo de <strong>Capacidad</strong>. El sistema calcula automáticamente la capacidad total del equipo.</p>',
'Planificación'),

(4, '4. Ceremonias Ágiles: Daily, Review y Retrospectiva',
'<h3>Teoría de Ceremonias</h3>
<p>Scrum define eventos clave para mantener el ritmo:
<ul>
<li><strong>Daily Scrum</strong>: Reunión diaria de 15 minutos para alinear al equipo.</li>
<li><strong>Sprint Review</strong>: Inspección del incremento al final del Sprint.</li>
<li><strong>Sprint Retrospective</strong>: Reflexión del equipo para mejorar procesos.</li>
</ul>
</p>
<h3>Cómo se usa en ScrumFlow</h3>
<p>Registra tus pendientes en el módulo <strong>Daily</strong> y mide el tiempo real invertido en cada tarea utilizando el temporizador nativo del servidor para evitar pérdida de datos si cierras el navegador.</p>',
'Ejecución')
ON CONFLICT (orden) DO UPDATE 
SET titulo = EXCLUDED.titulo, contenido = EXCLUDED.contenido, seccion = EXCLUDED.seccion;

-- ===========================================================================
-- SEED: QUIZZES (2 preguntas por leccion). Es seguro correrlo varias veces.
-- ===========================================================================
-- Ya NO se hace TRUNCATE: los ids de curso_quizzes se conservan entre ejecuciones.
-- Una pregunta se identifica por (leccion, texto de la pregunta); no hace falta ningun UNIQUE nuevo.
--   * Si la pregunta no existe en esa leccion, se inserta.
--   * Si ya existe, solo se actualizan sus opciones y respuesta correcta (por si se corrigieron aqui).
-- Si cambias el TEXTO de una pregunta, se insertara como una nueva y la anterior se quedara en la tabla:
-- en ese caso borra la vieja a mano (DELETE FROM curso_quizzes WHERE id = ...).
DO $$
DECLARE
  q RECORD;
  v_leccion INTEGER;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
  (1, '¿Qué pilar fundamental de Scrum se refleja al mover tarjetas en el Tablero Kanban en tiempo real?',
   '{"0": "Transparencia y visibilidad", "1": "Ocultar información", "2": "Trabajar sin orden"}', 0),
  (1, '¿En qué teoría de control de procesos se basa principalmente Scrum?',
   '{"0": "Empírica (Transparencia, Inspección y Adaptación)", "1": "Modelo Cascada clásico", "2": "Planificación rígida prediseñada"}', 0),
  (2, '¿Dónde se definen los roles de Scrum Master, Product Owner y Developer en ScrumFlow?',
   '{"0": "En el perfil global del usuario", "1": "Dentro de cada proyecto en la tabla miembros_proyecto", "2": "En el archivo .env"}', 1),
  (2, '¿Quién es el responsable de maximizar el valor del producto y gestionar el Product Backlog?',
   '{"0": "Scrum Master", "1": "Product Owner", "2": "Developers"}', 1),
  (3, '¿Qué módulo de ScrumFlow permite registrar las horas disponibles y ausencias de cada integrante?',
   '{"0": "Módulo de Capacidad", "1": "Módulo de Bitácora", "2": "Módulo de Autenticación"}', 0),
  (3, '¿Cuál es la duración máxima recomendada para un Sprint en Scrum?',
   '{"0": "Un mes o menos", "1": "Seis meses", "2": "No tiene límite fijado"}', 0),
  (4, '¿Para qué sirve el temporizador de tareas integrado en ScrumFlow?',
   '{"0": "Para medir horas reales en el servidor sin perder tiempo al cerrar el navegador", "1": "Para bloquear el acceso al sistema", "2": "Para enviar correos masivos de notificación"}', 0),
  (4, '¿Cuál es la duración máxima acordada para la reunión Daily Scrum?',
   '{"0": "15 minutos", "1": "45 minutos", "2": "2 horas"}', 0)
    ) AS t(orden, pregunta, opciones, respuesta_correcta)
  LOOP
    SELECT id INTO v_leccion FROM curso_lecciones WHERE orden = q.orden;
    IF v_leccion IS NULL THEN
      RAISE NOTICE 'No existe la leccion % ; se omite su pregunta.', q.orden;
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM curso_quizzes WHERE leccion_id = v_leccion AND pregunta = q.pregunta) THEN
      UPDATE curso_quizzes
         SET opciones = q.opciones::JSONB, respuesta_correcta = q.respuesta_correcta
       WHERE leccion_id = v_leccion AND pregunta = q.pregunta
         AND (opciones IS DISTINCT FROM q.opciones::JSONB OR respuesta_correcta IS DISTINCT FROM q.respuesta_correcta);
    ELSE
      INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta)
      VALUES (v_leccion, q.pregunta, q.opciones::JSONB, q.respuesta_correcta);
    END IF;
  END LOOP;
END $$;
