/**
    @file seed-proyecto-nuevo.sql
    @description DATOS DE PRUEBA - Segundo equipo para el comparativo.
    Crea el "Equipo Gamma" con Stephy (stephanieehpr@gmail.com) como Scrum Master y el
    "Proyecto Demo Gamma" con todos los datos necesarios: 3 sprints cerrados (velocity),
    1 sprint activo con 12 tareas asignadas, horas reales registradas y 1 impedimento abierto.
    Ejecutar DESPUES de schema.sql y seed.sql. Es seguro correrlo varias veces
    (si el proyecto ya existe, no duplica nada).

    @author Dana Carmona Santamaria
*/

DO $$
DECLARE
  v_stephy      INTEGER;
  v_po          INTEGER;
  v_dana        INTEGER;
  v_diego       INTEGER;
  v_equipo      INTEGER;
  v_proyecto    INTEGER;
  v_c_porhacer  INTEGER;
  v_c_progreso  INTEGER;
  v_c_hecho     INTEGER;
  v_sprint      INTEGER;
  v_historia    INTEGER;
  v_tarea       INTEGER;
  v_i           INTEGER;
BEGIN
  -- Usuarios reales tomados de seed.sql
  SELECT id INTO v_stephy FROM usuarios WHERE correo = 'stephanieehpr@gmail.com';
  SELECT id INTO v_po     FROM usuarios WHERE correo = 'citlipop@gmail.com';
  SELECT id INTO v_dana   FROM usuarios WHERE correo = 'dana044car@gmail.com';
  SELECT id INTO v_diego  FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com';
  IF v_stephy IS NULL OR v_po IS NULL OR v_dana IS NULL OR v_diego IS NULL THEN
    RAISE NOTICE 'Faltan usuarios del seed: ejecuta primero database/seed.sql';
    RETURN;
  END IF;

  -- Idempotencia: si el proyecto ya existe, no hacer nada
  SELECT id INTO v_proyecto FROM proyectos WHERE nombre = 'Proyecto Demo Gamma';
  IF v_proyecto IS NOT NULL THEN
    RAISE NOTICE 'El Proyecto Demo Gamma ya existe; no se duplican los datos.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------
  -- Equipo Gamma (nuevo) con los mismos integrantes que Alfa
  -- ---------------------------------------------------------------------
  SELECT id INTO v_equipo FROM equipos WHERE nombre = 'Equipo Gamma';
  IF v_equipo IS NULL THEN
    INSERT INTO equipos (nombre, creado_por) VALUES ('Equipo Gamma', v_stephy)
    RETURNING id INTO v_equipo;
  END IF;

  INSERT INTO miembros_equipo (equipo_id, usuario_id) VALUES
    (v_equipo, v_stephy), (v_equipo, v_po), (v_equipo, v_dana), (v_equipo, v_diego)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------
  -- Proyecto Demo Gamma, con Stephy como Scrum Master
  -- ---------------------------------------------------------------------
  INSERT INTO proyectos (equipo_id, nombre, vision, fecha_inicio, fecha_fin, umbral_desviacion, creado_por)
  VALUES (v_equipo, 'Proyecto Demo Gamma',
          'Proyecto de ejemplo para comparar dos equipos',
          CURRENT_DATE - 60, CURRENT_DATE + 30, 10, v_stephy)
  RETURNING id INTO v_proyecto;

  INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol) VALUES
    (v_proyecto, v_stephy, 'scrum_master'),
    (v_proyecto, v_po,     'product_owner'),
    (v_proyecto, v_dana,   'developer'),
    (v_proyecto, v_diego,  'developer');

  -- Columnas por defecto (mismos nombres y WIP que seed.sql)
  INSERT INTO columnas_tablero (proyecto_id, nombre, orden, limite_wip, es_final) VALUES
    (v_proyecto, 'Por empezar', 1, 5,    FALSE),
    (v_proyecto, 'En progreso', 2, 3,    FALSE),
    (v_proyecto, 'En revisión', 3, NULL, FALSE),
    (v_proyecto, 'Terminado',   4, NULL, TRUE);

  SELECT id INTO v_c_porhacer FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'Por empezar';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'En progreso';
  SELECT id INTO v_c_hecho    FROM columnas_tablero WHERE proyecto_id = v_proyecto AND es_final = TRUE;

  -- ---------------------------------------------------------------------
  -- 3 sprints cerrados (Velocity): 5, 8 y 13 pts -> promedio 8.7
  -- ---------------------------------------------------------------------
  FOR v_i IN 1..3 LOOP
    INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado, velocity, cerrado_en)
    VALUES (v_proyecto, 'Gamma Sprint ' || v_i, 'Sprint cerrado de ejemplo',
            CURRENT_DATE - (28 - (v_i - 1) * 7), CURRENT_DATE - (22 - (v_i - 1) * 7), 90, 'cerrado', NULL,
            NOW() - ((22 - (v_i - 1) * 7) || ' days')::interval)
    RETURNING id INTO v_sprint;

    -- Historias aceptadas
    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            v_sprint, 'Gamma S' || v_i || ' historia A', CASE v_i WHEN 1 THEN 3 WHEN 2 THEN 5 ELSE 8 END, 'aceptada', 100 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            v_sprint, 'Gamma S' || v_i || ' historia B', CASE v_i WHEN 1 THEN 2 WHEN 2 THEN 3 ELSE 5 END, 'aceptada', 101 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    -- Historia rechazada (simula el scope)
    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            NULL, 'Gamma S' || v_i || ' historia rechazada', CASE v_i WHEN 1 THEN 5 WHEN 2 THEN 3 ELSE 5 END, 'rechazada', 102 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, comentario, decidido_por)
    VALUES (v_sprint, v_historia, 'rechazada', 'No cumple la definición de terminado', v_po);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 1 sprint activo con 12 tareas (Avance 75 %: 9 de 12 en Hecho)
  -- Estimado total 40 h; reales 44 h -> desviacion 10 %
  -- ---------------------------------------------------------------------
  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proyecto, 'Gamma Sprint 4 (activo)', 'Sprint activo de ejemplo', CURRENT_DATE - 3, CURRENT_DATE + 4, 90, 'activo')
  RETURNING id INTO v_sprint;

  INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
  VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
          v_sprint, 'Gamma S4 historia en curso', 8, 'en_sprint', 200, v_po)
  RETURNING id INTO v_historia;

  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: diseñar login',          v_dana,  4, 1),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: maquetar panel',         v_dana,  3, 2),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: crear endpoints',        v_diego, 5, 3),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: validaciones',           v_diego, 2, 4),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: conectar con la API',   v_dana,  4, 5),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: documentar API',         v_dana,  3, 6),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: pruebas unitarias',      v_diego, 5, 7),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: revisar diseño',         v_dana,  2, 8),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: preparar demo',          v_diego, 3, 9),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Gamma: migrar datos',           v_dana,  4, 10),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Gamma: optimizar consultas',    v_diego, 3, 11),
    (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Gamma: tarea sin responsable',  NULL,    2, 12);

  -- Horas reales registradas (44 h en total)
  INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota) VALUES
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: diseñar login'),        v_dana,  CURRENT_DATE - 1, 5,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: maquetar panel'),       v_dana,  CURRENT_DATE - 1, 3,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: crear endpoints'),      v_diego, CURRENT_DATE - 1, 6,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: validaciones'),         v_diego, CURRENT_DATE - 1, 2,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: conectar con la API'),  v_dana,  CURRENT_DATE - 2, 10, 'Problemas de conexión con el proveedor externo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: documentar API'),       v_dana,  CURRENT_DATE - 1, 3,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: pruebas unitarias'),    v_diego, CURRENT_DATE - 1, 5,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: revisar diseño'),       v_dana,  CURRENT_DATE - 1, 2,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: preparar demo'),        v_diego, CURRENT_DATE - 1, 4,  'Horas de ejemplo'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: migrar datos'),         v_dana,  CURRENT_DATE - 1, 2,  'Horas parciales'),
    ((SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Gamma: optimizar consultas'),  v_diego, CURRENT_DATE - 1, 2,  'Horas parciales');

  -- Snapshots para la gráfica Burndown del sprint activo
  INSERT INTO snapshots_burndown (sprint_id, fecha, horas_restantes, puntos_restantes, alcance_modificado) VALUES
    (v_sprint, CURRENT_DATE - 3, 40, 8, false),
    (v_sprint, CURRENT_DATE - 2, 30, 8, false),
    (v_sprint, CURRENT_DATE - 1, 20, 8, true),
    (v_sprint, CURRENT_DATE,     10, 8, false);

  -- Impedimento abierto
  INSERT INTO impedimentos (proyecto_id, sprint_id, titulo, severidad, estado, creado_por, resuelto_en) VALUES
    (v_proyecto, v_sprint, 'Gamma: acceso al entorno de pruebas', 'media', 'abierto', v_dana, NULL);

  UPDATE proyectos p SET ultimo_numero_hu = GREATEST(p.ultimo_numero_hu, COALESCE((SELECT MAX(h.numero_hu) FROM historias h WHERE h.proyecto_id = p.id), 0)) WHERE p.id = v_proyecto;

  RAISE NOTICE 'Proyecto Demo Gamma creado (id=%) con 3 sprints cerrados y 1 activo. Entra como Stephy para ver 2 equipos en el comparativo.', v_proyecto;
END
$$;

-- TAREAS Y HORAS DE LOS SPRINTS CERRADOS DEL PROYECTO DEMO GAMMA
-- Los 3 sprints cerrados solo tenian historias (para la velocity); ahora tambien
-- tienen 4 tareas cada uno, todas en Hecho, con horas estimadas y reales, y su
-- historia de cambios de columna para que el CFD tambien dibuje esos sprints.
-- Numeros nuevos de Gamma: 24 tareas (21 en Hecho) -> avance 88 %; estimado
-- 78 h, reales 87 h -> desviacion 11.5 %. La velocity no cambia (usa historias).
-- Es seguro correrlo varias veces: las tareas solo se crean si no existen
-- (titulo 'Gamma S1:%', 'Gamma S2:%', 'Gamma S3:%') y los eventos solo se
-- insertan si la tarjeta todavia no tiene ninguno.
DO $$
DECLARE
  v_proyecto    INTEGER;
  v_dana        INTEGER;
  v_diego       INTEGER;
  v_c_porhacer  INTEGER;
  v_c_progreso  INTEGER;
  v_c_hecho     INTEGER;
  v_sprint      INTEGER;
  v_hist_a      INTEGER;
  v_hist_b      INTEGER;
BEGIN
  SELECT id INTO v_proyecto FROM proyectos WHERE nombre = 'Proyecto Demo Gamma';
  IF v_proyecto IS NULL THEN
    RAISE NOTICE 'No existe Proyecto Demo Gamma: no se cargan las tareas de los sprints cerrados.';
    RETURN;
  END IF;

  SELECT id INTO v_dana  FROM usuarios WHERE correo = 'dana044car@gmail.com';
  SELECT id INTO v_diego FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com';
  SELECT id INTO v_c_porhacer FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'Por empezar';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'En progreso';
  SELECT id INTO v_c_hecho    FROM columnas_tablero WHERE proyecto_id = v_proyecto AND es_final = TRUE;

  -- ---------------------------------------------------------------- Sprint 1 (hace 4 semanas)
  SELECT id INTO v_sprint FROM sprints WHERE proyecto_id = v_proyecto AND nombre = 'Gamma Sprint 1';
  IF v_sprint IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tareas WHERE proyecto_id = v_proyecto AND titulo LIKE 'Gamma S1:%') THEN
    SELECT id INTO v_hist_a FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S1 historia A';
    SELECT id INTO v_hist_b FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S1 historia B';
    INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S1: diseñar base de datos', v_dana,  4, 1),
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S1: crear modelos',         v_diego, 3, 2),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S1: configurar entorno',    v_dana,  2, 3),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S1: documentar setup',      v_diego, 3, 4);
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
    FROM (VALUES
      ('Gamma S1: diseñar base de datos', 'dana044car@gmail.com',     24, 5.0, 'Horas de ejemplo'),
      ('Gamma S1: crear modelos',         'diegotrujano3c@gmail.com', 24, 3.0, 'Horas de ejemplo'),
      ('Gamma S1: configurar entorno',    'dana044car@gmail.com',     23, 2.0, 'Horas de ejemplo'),
      ('Gamma S1: documentar setup',      'diegotrujano3c@gmail.com', 23, 4.0, 'Horas de ejemplo')
    ) AS r(titulo, correo, dias, horas, nota)
    JOIN tareas t   ON t.proyecto_id = v_proyecto AND t.titulo = r.titulo
    JOIN usuarios u ON u.correo = r.correo;
  END IF;

  -- ---------------------------------------------------------------- Sprint 2 (hace 3 semanas)
  SELECT id INTO v_sprint FROM sprints WHERE proyecto_id = v_proyecto AND nombre = 'Gamma Sprint 2';
  IF v_sprint IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tareas WHERE proyecto_id = v_proyecto AND titulo LIKE 'Gamma S2:%') THEN
    SELECT id INTO v_hist_a FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S2 historia A';
    SELECT id INTO v_hist_b FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S2 historia B';
    INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S2: endpoint de usuarios',   v_diego, 5, 1),
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S2: validar formularios',    v_dana,  4, 2),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S2: pruebas de integración', v_diego, 3, 3),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S2: revisar código',         v_dana,  2, 4);
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
    FROM (VALUES
      ('Gamma S2: endpoint de usuarios',   'diegotrujano3c@gmail.com', 17, 6.0, 'Horas de ejemplo'),
      ('Gamma S2: validar formularios',    'dana044car@gmail.com',     17, 4.0, 'Horas de ejemplo'),
      ('Gamma S2: pruebas de integración', 'diegotrujano3c@gmail.com', 16, 3.0, 'Horas de ejemplo'),
      ('Gamma S2: revisar código',         'dana044car@gmail.com',     16, 2.0, 'Horas de ejemplo')
    ) AS r(titulo, correo, dias, horas, nota)
    JOIN tareas t   ON t.proyecto_id = v_proyecto AND t.titulo = r.titulo
    JOIN usuarios u ON u.correo = r.correo;
  END IF;

  -- ---------------------------------------------------------------- Sprint 3 (hace 2 semanas)
  SELECT id INTO v_sprint FROM sprints WHERE proyecto_id = v_proyecto AND nombre = 'Gamma Sprint 3';
  IF v_sprint IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tareas WHERE proyecto_id = v_proyecto AND titulo LIKE 'Gamma S3:%') THEN
    SELECT id INTO v_hist_a FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S3 historia A';
    SELECT id INTO v_hist_b FROM historias WHERE sprint_id = v_sprint AND titulo = 'Gamma S3 historia B';
    INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S3: dashboard inicial',   v_dana,  4, 1),
      (v_hist_a, v_proyecto, v_sprint, v_c_hecho, 'Gamma S3: exportar reportes',   v_diego, 3, 2),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S3: caché de consultas',  v_diego, 2, 3),
      (v_hist_b, v_proyecto, v_sprint, v_c_hecho, 'Gamma S3: preparar release',    v_dana,  3, 4);
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
    FROM (VALUES
      ('Gamma S3: dashboard inicial',  'dana044car@gmail.com',     10, 5.0, 'Horas de ejemplo'),
      ('Gamma S3: exportar reportes',  'diegotrujano3c@gmail.com', 10, 3.0, 'Horas de ejemplo'),
      ('Gamma S3: caché de consultas', 'diegotrujano3c@gmail.com',  9, 2.0, 'Horas de ejemplo'),
      ('Gamma S3: preparar release',   'dana044car@gmail.com',      9, 4.0, 'Horas de ejemplo')
    ) AS r(titulo, correo, dias, horas, nota)
    JOIN tareas t   ON t.proyecto_id = v_proyecto AND t.titulo = r.titulo
    JOIN usuarios u ON u.correo = r.correo;
  END IF;

  -- ---------------------------------------------------------------- Historia para el CFD
  -- Cada tarea nace en Por hacer, pasa por En progreso y termina en Hecho dentro
  -- de su sprint. Las fechas se construyen en UTC al mediodia (el CFD agrupa
  -- por fecha UTC). Solo se insertan eventos si la tarjeta todavia no tiene
  -- ninguno, para no duplicar ni borrar la historia real de la app.
  UPDATE tareas t
     SET creado_en = ((CURRENT_DATE - e.dias_creado) || ' 12:00:00+00')::timestamptz
    FROM (VALUES
      ('Gamma S1: diseñar base de datos', 26, 25, 23),
      ('Gamma S1: crear modelos',         26, 25, 23),
      ('Gamma S1: configurar entorno',    26, 25, 23),
      ('Gamma S1: documentar setup',      26, 25, 23),
      ('Gamma S2: endpoint de usuarios',   19, 18, 16),
      ('Gamma S2: validar formularios',    19, 18, 16),
      ('Gamma S2: pruebas de integración', 19, 18, 16),
      ('Gamma S2: revisar código',         19, 18, 16),
      ('Gamma S3: dashboard inicial',   12, 11, 9),
      ('Gamma S3: exportar reportes',   12, 11, 9),
      ('Gamma S3: caché de consultas',  12, 11, 9),
      ('Gamma S3: preparar release',    12, 11, 9)
    ) AS e(titulo, dias_creado, dias_ep, dias_hecho)
   WHERE t.proyecto_id = v_proyecto AND t.titulo = e.titulo;

  -- Un solo INSERT con los dos pasos (Por hacer -> En progreso y En progreso ->
  -- Hecho): si se hicieran en dos INSERT separados, el segundo ya no insertaria
  -- nada porque el guarda NOT EXISTS veria el evento del primero.
  INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en)
  SELECT t.id, t.responsable_id, 'columna_cambiada',
         jsonb_build_object('anterior', p.anterior, 'nueva', p.nueva),
         ((CURRENT_DATE - CASE p.paso WHEN 1 THEN e.dias_ep ELSE e.dias_hecho END) || ' 12:00:00+00')::timestamptz
    FROM tareas t
    JOIN (VALUES
      ('Gamma S1: diseñar base de datos', 26, 25, 23),
      ('Gamma S1: crear modelos',         26, 25, 23),
      ('Gamma S1: configurar entorno',    26, 25, 23),
      ('Gamma S1: documentar setup',      26, 25, 23),
      ('Gamma S2: endpoint de usuarios',   19, 18, 16),
      ('Gamma S2: validar formularios',    19, 18, 16),
      ('Gamma S2: pruebas de integración', 19, 18, 16),
      ('Gamma S2: revisar código',         19, 18, 16),
      ('Gamma S3: dashboard inicial',   12, 11, 9),
      ('Gamma S3: exportar reportes',   12, 11, 9),
      ('Gamma S3: caché de consultas',  12, 11, 9),
      ('Gamma S3: preparar release',    12, 11, 9)
    ) AS e(titulo, dias_creado, dias_ep, dias_hecho) ON e.titulo = t.titulo
    CROSS JOIN (VALUES (1, v_c_porhacer, v_c_progreso), (2, v_c_progreso, v_c_hecho)) AS p(paso, anterior, nueva)
   WHERE t.proyecto_id = v_proyecto
     AND NOT EXISTS (SELECT 1 FROM historial_tareas h WHERE h.tarea_id = t.id AND h.accion = 'columna_cambiada');

  RAISE NOTICE 'Listo: tareas y horas de los 3 sprints cerrados de Proyecto Demo Gamma (id=%): 12 tareas, 24 cambios de columna.', v_proyecto;
END $$;
