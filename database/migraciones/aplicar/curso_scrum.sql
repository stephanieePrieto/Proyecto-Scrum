/**
    @file seed_curso_scrum.sql
    @description Carga las lecciones 1 a 4, la lección 999 para la evaluación final y los quizzes de cada lección (4 preguntas por lección). Ejecutar después de la migración.
    Datos iniciales del microcurso de Scrum, basados en la Guía de Scrum.

    @author Stephanie Elizdeth Hernández Prieto
*/

-- Configuración de codificación UTF-8 para evitar errores de acentos
SET client_encoding = 'UTF8';

-- SEED: LECCIONES TEÓRICAS Y LECCIÓN FANTASMA 999 PARA EVALUACIÓN FINAL

-- Inserción de lecciones estándar (1 a 4)
-- Comprobación previa: si ya hay lecciones con orden 1-4 y otro id, el upsert fallaría
-- con un error poco claro. Mejor detenerse aquí con un mensaje explícito.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM curso_lecciones
    WHERE orden IN (1, 2, 3, 4) AND id NOT IN (1, 2, 3, 4)
  ) THEN
    RAISE EXCEPTION 'Conflicto en curso_lecciones: existen filas con orden 1-4 y id distinto de 1-4. Revisa la tabla antes de sembrar.';
  END IF;
END $$;

-- Inserción de lecciones estándar (1 a 4) con id explícito

INSERT INTO curso_lecciones (id, orden, titulo, contenido, seccion) VALUES
(1, 1, '1. Introducción a Scrum y Teoría Empírica',
'<h3>¿Qué es Scrum?</h3>
<p>Scrum es un marco de trabajo (framework) ligero que ayuda a las personas, equipos y organizaciones a generar valor a través de soluciones adaptativas para problemas complejos.</p>
<h3>El Empirismo y Lean</h3>
<p>Scrum se basa en el <strong>empirismo</strong> (el conocimiento proviene de la experiencia y de tomar decisiones basándose en lo que se observa) y en el <strong>pensamiento Lean</strong> (reduce el desperdicio y se enfoca en lo esencial).</p>
<h3>Los Tres Pilares de Scrum</h3>
<ul>
  <li><strong>Transparencia:</strong> El proceso y el trabajo emergentes deben ser visibles tanto para quienes realizan el trabajo como para quienes lo reciben.</li>
  <li><strong>Inspección:</strong> Los artefactos de Scrum y el progreso hacia los objetivos deben inspeccionarse con frecuencia para detectar desviaciones.</li>
  <li><strong>Adaptación:</strong> Si algún aspecto se desvía de los límites aceptables, el proceso o el material debe ajustarse de inmediato.</li>
</ul>
<h3>Valores de Scrum</h3>
<p>El uso con éxito de Scrum depende de que las personas vivan cinco valores fundamentales: <strong>Compromiso, Foco, Apertura, Respeto y Coraje</strong>.</p>',
'Introducción'),

(2, 2, '2. El Equipo Scrum (Scrum Team)',
'<h3>Estructura del Equipo</h3>
<p>El modelo fundamental consiste en un equipo pequeño (típicamente 10 personas o menos) que consta de un <strong>Scrum Master</strong>, un <strong>Product Owner</strong> y <strong>Developers</strong>. Es una unidad cohesionada de profesionales enfocados en un objetivo a la vez: el Objetivo del Producto.</p>
<h3>Roles y Responsabilidades</h3>
<ul>
  <li><strong>Product Owner (PO):</strong> Es responsable de maximizar el valor del producto y de la gestión efectiva del Product Backlog (expresar elementos, ordenarlos y asegurar su transparencia).</li>
  <li><strong>Scrum Master (SM):</strong> Es responsable de establecer Scrum tal como se define en la Guía oficial. Es un líder que sirve al equipo, eliminando impedimentos y facilitando los eventos.</li>
  <li><strong>Developers:</strong> Son los profesionales comprometidos a crear cualquier aspecto de un Incremento utilizable en cada Sprint, adhiriéndose a la Definición de Terminado.</li>
</ul>',
'Roles'),

(3, 3, '3. Eventos de Scrum y la Cadencia del Sprint',
'<h3>El Sprint (Contenedor de Eventos)</h3>
<p>Los Sprints son el corazón de Scrum; eventos de duración fija de <strong>un mes o menos</strong> para crear consistencia. Un nuevo Sprint inicia inmediatamente al concluir el anterior.</p>
<h3>Eventos Formales dentro del Sprint</h3>
<ul>
  <li><strong>Sprint Planning:</strong> Inicia el Sprint estableciendo el trabajo a realizar (¿Por qué es valioso?, ¿Qué se puede hacer? y ¿Cómo se realizará?).</li>
  <li><strong>Daily Scrum:</strong> Evento de 15 minutos diarios para que los Developers inspeccionen el progreso hacia el Sprint Goal y adapten el Sprint Backlog.</li>
  <li><strong>Sprint Review:</strong> Inspección del resultado del Sprint (Incremento) al final del ciclo para adaptar el Product Backlog junto con los interesados.</li>
  <li><strong>Sprint Retrospective:</strong> Cierra el Sprint. El equipo planifica formas de aumentar su calidad y efectividad inspeccionando procesos, personas e interacciones.</li>
</ul>',
'Planificación'),

(4, 4, '4. Artefactos de Scrum y sus Compromisos',
'<h3>Artefactos y Transparencia</h3>
<p>Los artefactos representan trabajo o valor y están diseñados para maximizar la transparencia. Cada artefacto contiene un <strong>compromiso</strong> explícito:</p>
<ul>
  <li><strong>Product Backlog:</strong> Lista ordenada y emergente de lo que se necesita para mejorar el producto.
    <br><em>Compromiso asociado:</em> <strong>Objetivo del Producto (Product Goal)</strong>.</li>
  <li><strong>Sprint Backlog:</strong> Compuesto por el Objetivo del Sprint (por qué), los elementos seleccionados (qué), y el plan para entregar el Incremento (cómo).
    <br><em>Compromiso asociado:</em> <strong>Objetivo del Sprint (Sprint Goal)</strong>.</li>
  <li><strong>Incremento:</strong> Peldaño concreto hacia el Objetivo del Producto. Debe ser utilizable y cumplir con los estándares de calidad.
    <br><em>Compromiso asociado:</em> <strong>Definición de Terminado (Definition of Done - DoD)</strong>.</li>
</ul>',
'Ejecución')
ON CONFLICT (id) DO UPDATE
SET orden = EXCLUDED.orden, titulo = EXCLUDED.titulo, contenido = EXCLUDED.contenido, seccion = EXCLUDED.seccion;

-- Inserción explícita de la Lección 999 para satisfacer la Foreign Key del Quiz Final Integrador
INSERT INTO curso_lecciones (id, orden, titulo, contenido, seccion)
VALUES (999, 999, 'Quiz Final Integrador', 'Evaluación final para la obtención de certificado', 'Evaluación')
ON CONFLICT (id) DO UPDATE
SET orden = EXCLUDED.orden, titulo = EXCLUDED.titulo, contenido = EXCLUDED.contenido, seccion = EXCLUDED.seccion;

-- Ajustar la secuencia: tras insertar ids explícitos, el siguiente SERIAL no debe chocar.
SELECT setval(pg_get_serial_sequence('curso_lecciones', 'id'), (SELECT MAX(id) FROM curso_lecciones));

-- LIMPIEZA Y SEED: QUIZZES MODULARES (4 Preguntas por Lección)
DELETE FROM curso_quizzes;

DO $$
DECLARE
  q RECORD;
  v_leccion INTEGER;
BEGIN
  FOR q IN
    SELECT * FROM (VALUES
      -- Lección 1: Introducción y Empirismo (4 preguntas)
      (1, '¿En qué dos conceptos fundamentales se basa el marco de trabajo de Scrum?',
       '{"0": "El empirismo y el pensamiento Lean", "1": "La gestión rígida y el modelo en cascada", "2": "La programación en pareja y el desarrollo en cascada"}', 0),
      (1, '¿Cuáles son los tres pilares del empirismo que sostiene Scrum?',
       '{"0": "Transparencia, Inspección y Adaptación", "1": "Compromiso, Calidad y Velocidad", "2": "Planificación, Control y Ejecución"}', 0),
      (1, '¿Qué pilar exige que el proceso y el trabajo emergentes sean visibles para quienes realizan y reciben el trabajo?',
       '{"0": "Transparencia", "1": "Adaptación", "2": "Inspección"}', 0),
      (1, '¿Cuáles son los 5 valores fundamentales de Scrum que guían el comportamiento del equipo?',
       '{"0": "Compromiso, Foco, Apertura, Respeto y Coraje", "1": "Transparencia, Inspección, Adaptación, Rapidez y Calidad", "2": "Confianza, Documentación, Procesos, Herramientas y Contratos"}', 0),

      -- Lección 2: El Equipo Scrum (4 preguntas)
      (2, '¿Cómo está estructurado un Scrum Team según la Guía Oficial?',
       '{"0": "Un grupo pequeño cohesionado compuesto por Product Owner, Scrum Master y Developers", "1": "Un equipo liderado por un Gerente de Proyecto con sub-equipos de prueba", "2": "Un grupo de desarrolladores sin roles asignados"}', 0),
      (2, '¿Quién es el único responsable de la gestión efectiva del Product Backlog y de maximizar el valor del producto?',
       '{"0": "Product Owner", "1": "Scrum Master", "2": "Developers"}', 0),
      (2, '¿Cuál es la función principal del Scrum Master dentro del equipo y la organización?',
       '{"0": "Servir al equipo, eliminar impedimentos y asegurar que Scrum se comprenda y aplique", "1": "Asignar las tareas individuales a cada programador diariamente", "2": "Aprobar las horas de trabajo y el presupuesto"}', 0),
      (2, '¿De qué son responsables los Developers dentro del Scrum Team?',
       '{"0": "De crear un plan para el Sprint (Sprint Backlog) y entregar un Incremento utilizable que cumpla con la DoD", "1": "De negociar con los patrocinadores y definir los costos", "2": "De supervisar el desempeño del Product Owner"}', 0),

      -- Lección 3: Eventos y Cadencia (4 preguntas)
      (3, '¿Cuál es la duración fija máxima definida para un Sprint?',
       '{"0": "Un mes o menos", "1": "Seis meses", "2": "Tres meses"}', 0),
      (3, '¿Cuáles son los tres aspectos que se abordan durante el Sprint Planning?',
       '{"0": "¿Por qué es valioso este Sprint?, ¿Qué se puede hacer? y ¿Cómo se realizará el trabajo?", "1": "¿Cuánto costará el Sprint?, ¿Quiénes trabajarán? y ¿Cuándo se cobrará?", "2": "¿Qué falló en el pasado?, ¿Quién cometió errores? y ¿Cómo corregirlos?"}', 0),
      (3, '¿Cuál es el objetivo principal del Daily Scrum y cuál es su tiempo límite (timebox)?',
       '{"0": "Inspeccionar el progreso hacia el Sprint Goal y adaptar el Sprint Backlog en máximo 15 minutos", "1": "Rendir cuentas detalladas al Gerente de Proyecto en 1 hora", "2": "Revisar los costos y facturas en 30 minutos"}', 0),
      (3, '¿En qué evento el Scrum Team e interesados inspeccionan los resultados del Sprint para adaptar el Product Backlog?',
       '{"0": "Sprint Review", "1": "Sprint Retrospective", "2": "Daily Scrum"}', 0),

      -- Lección 4: Artefactos y Compromisos (4 preguntas)
      (4, '¿Qué compromiso obligatorio corresponde al artefacto del Product Backlog?',
       '{"0": "El Objetivo del Producto (Product Goal)", "1": "El Objetivo del Sprint (Sprint Goal)", "2": "La Definición de Terminado (Definition of Done)"}', 0),
      (4, '¿Cuáles son los elementos que componen el artefacto del Sprint Backlog?',
       '{"0": "El Objetivo del Sprint (por qué), los ítems seleccionados (qué) y un plan accionable (cómo)", "1": "El manual del usuario y la arquitectura de software", "2": "El contrato firmado y la factura de cobro"}', 0),
      (4, '¿Qué compromiso garantiza la transparencia sobre la calidad requerida de un Incremento?',
       '{"0": "La Definición de Terminado (Definition of Done)", "1": "El Objetivo del Producto (Product Goal)", "2": "El Plan del Sprint"}', 0),
      (4, '¿Cuándo un elemento del Product Backlog pasa a ser oficialmente parte de un Incremento?',
       '{"0": "Cuando cumple totalmente con la Definición de Terminado (Definition of Done)", "1": "En el momento en que el desarrollador comienza a escribir código", "2": "Cuando se selecciona en el Sprint Planning"}', 0)
    ) AS t(orden, pregunta, opciones, respuesta_correcta)
  LOOP
    SELECT id INTO v_leccion FROM curso_lecciones WHERE orden = q.orden;
    IF v_leccion IS NOT NULL THEN
      INSERT INTO curso_quizzes (leccion_id, pregunta, opciones, respuesta_correcta)
      VALUES (v_leccion, q.pregunta, q.opciones::JSONB, q.respuesta_correcta);
    END IF;
  END LOOP;
END $$;

-- Verificación esperada: 5 lecciones (1-4 y 999) y 16 quizzes (4 por lección).
-- SELECT COUNT(*) FROM curso_lecciones;  -- 5
-- SELECT COUNT(*) FROM curso_quizzes;    -- 16
