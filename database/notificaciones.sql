-- HU-24 (Alfonso): columnas que usa la campana de notificaciones + datos ficticios de demostracion.
-- Ejecutar DESPUES de schema.sql y seed.sql. Es seguro correrlo varias veces (no duplica nada).
-- No modifica schema.sql ni seed.sql: solo agrega columnas a la tabla "notificaciones".

-- ===========================================================================
-- 1. Columnas nuevas de la tabla notificaciones
-- ===========================================================================
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS titulo         TEXT;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS referencia_id  INTEGER;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS metadatos      JSONB NOT NULL DEFAULT '{}';
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS leida_en       TIMESTAMPTZ;

-- ===========================================================================
-- 2. Notificaciones ficticias (4 o 5 por persona, mezcla de leidas y sin leer)
--    "minutos" = hace cuantos minutos ocurrio el evento
-- ===========================================================================
INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, enlace, metadatos, leida, leida_en, creado_en)
SELECT u.id,
       v.tipo,
       v.titulo,
       v.mensaje,
       v.enlace,
       v.metadatos::jsonb,
       v.leida,
       CASE WHEN v.leida THEN NOW() - (v.minutos * INTERVAL '1 minute') + INTERVAL '5 minutes' END,
       NOW() - (v.minutos * INTERVAL '1 minute')
FROM (VALUES
  -- Alfonso (Developer en Alfa)
  ('mendozavas615@gmail.com', 'asignacion', 'Nueva tarea: Temporizador de horas reales',
     'Citlaly te asignó «Temporizador de horas reales» (6 h estimadas).',
     '/pages/tablero.html', '{}', FALSE, 8),
  ('mendozavas615@gmail.com', 'mencion', 'Diego te mencionó en un comentario',
     'Diego: ¿ya quedó el endpoint de horas? Lo necesito para conectar la tarjeta.',
     '/pages/tablero.html', '{}', FALSE, 35),
  ('mendozavas615@gmail.com', 'asignacion', 'Tienes 3 nuevas asignaciones',
     'Revisar adjuntos de tarjeta; Validar archivos mayores a 10 MB; Probar menciones en comentarios',
     '/pages/tablero.html', '{"agrupada": true, "total": 3}', FALSE, 130),
  ('mendozavas615@gmail.com', 'mencion', 'Stephy te mencionó en un comentario',
     'Stephy: recuerda registrar tus horas antes de cerrar el día.',
     '/pages/tablero.html', '{}', TRUE, 1500),
  ('mendozavas615@gmail.com', 'asignacion', 'Nueva tarea: Pruebas de permisos por rol',
     'Dana te asignó «Pruebas de permisos por rol» (4 h estimadas).',
     '/pages/tablero.html', '{}', TRUE, 2900),

  -- Stephy (Scrum Master en Alfa)
  ('stephanieehpr@gmail.com', 'mencion', 'Diego te mencionó en un comentario',
     'Diego: ¿podemos revisar el límite WIP de «En progreso» antes de la Daily?',
     '/pages/tablero.html', '{}', FALSE, 12),
  ('stephanieehpr@gmail.com', 'asignacion', 'Nueva tarea: Configurar pipeline de CI/CD',
     'Citlaly te asignó «Configurar pipeline de CI/CD» (6 h estimadas).',
     '/pages/tablero.html', '{}', FALSE, 55),
  ('stephanieehpr@gmail.com', 'mencion', 'Dana te mencionó en un comentario',
     'Dana: el burndown ya muestra la línea ideal, ¿lo revisas en la Review?',
     '/pages/metricas.html', '{}', TRUE, 420),
  ('stephanieehpr@gmail.com', 'asignacion', 'Nueva tarea: Documentar la API',
     'Alfonso te asignó «Documentar la API en OpenAPI» (5 h estimadas).',
     '/pages/tablero.html', '{}', TRUE, 2880),

  -- Citlaly (Product Owner en Alfa)
  ('citlipop@gmail.com', 'mencion', 'Stephy te mencionó en un comentario',
     'Stephy: necesito que priorices «Mover tarjetas» antes del Sprint Planning.',
     '/pages/backlog.html', '{}', FALSE, 20),
  ('citlipop@gmail.com', 'asignacion', 'Nueva tarea: Refinar criterios de aceptación',
     'Stephy te asignó «Refinar criterios de aceptación de HU-18» (2 h estimadas).',
     '/pages/backlog.html', '{}', FALSE, 190),
  ('citlipop@gmail.com', 'mencion', 'Dana te mencionó en un comentario',
     'Dana: ¿aceptas la historia «Ver mis proyectos» en la Review?',
     '/pages/sprints.html', '{}', TRUE, 1700),
  ('citlipop@gmail.com', 'asignacion', 'Nueva tarea: Preparar la Review',
     'Stephy te asignó «Preparar la Review del Sprint 1» (3 h estimadas).',
     '/pages/sprints.html', '{}', TRUE, 4300),

  -- Dana (Developer en Alfa, Scrum Master en Beta)
  ('dana044car@gmail.com', 'asignacion', 'Nueva tarea: Gráfica de velocity',
     'Stephy te asignó «Gráfica de velocity por sprint» (8 h estimadas).',
     '/pages/metricas.html', '{}', FALSE, 5),
  ('dana044car@gmail.com', 'mencion', 'Alfonso te mencionó en un comentario',
     'Alfonso: la desviación de horas ya llega al endpoint, ¿la conectas al dashboard?',
     '/pages/metricas.html', '{}', FALSE, 75),
  ('dana044car@gmail.com', 'asignacion', 'Tienes 2 nuevas asignaciones',
     'Exportar reportes a PDF; Exportar reportes a CSV',
     '/pages/metricas.html', '{"agrupada": true, "total": 2}', TRUE, 960),
  ('dana044car@gmail.com', 'mencion', 'Citlaly te mencionó en un comentario',
     'Citlaly: gracias por el avance por persona, quedó muy claro.',
     '/pages/metricas.html', '{}', TRUE, 3600),

  -- Diego (Developer en Alfa, Product Owner en Beta)
  ('diegotrujano3c@gmail.com', 'mencion', 'Alfonso te mencionó en un comentario',
     'Alfonso: ¿puedes revisar mi tarjeta de adjuntos? Ya pasa de 10 MB y la rechaza.',
     '/pages/tablero.html', '{}', FALSE, 18),
  ('diegotrujano3c@gmail.com', 'asignacion', 'Nueva tarea: Registrar la Daily',
     'Stephy te asignó «Registrar la Daily con tareas vinculadas» (5 h estimadas).',
     '/pages/sprints.html', '{}', FALSE, 240),
  ('diegotrujano3c@gmail.com', 'mencion', 'Stephy te mencionó en un comentario',
     'Stephy: tu impedimento lleva 2 días abierto, ¿lo resolvemos hoy?',
     '/pages/sprints.html', '{}', TRUE, 1300),
  ('diegotrujano3c@gmail.com', 'asignacion', 'Nueva tarea: Retrospectiva con votos',
     'Citlaly te asignó «Retrospectiva con votos y acciones» (8 h estimadas).',
     '/pages/sprints.html', '{}', TRUE, 5000)
) AS v(correo, tipo, titulo, mensaje, enlace, metadatos, leida, minutos)
JOIN usuarios u ON u.correo = v.correo
WHERE NOT EXISTS (
  SELECT 1 FROM notificaciones n
   WHERE n.usuario_id = u.id AND n.titulo = v.titulo AND n.mensaje = v.mensaje
);