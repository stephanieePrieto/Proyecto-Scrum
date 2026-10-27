-- DATOS DE PRUEBA - HU-30 (velocity), HU-31 (avance) y HU-35 (dashboard).
-- NO es parte de la base: solo sirve para ver las métricas con información.
-- Ejecutar DESPUES de schema.sql y seed.sql. Es seguro correrlo varias veces (no duplica datos).
--
-- Qué crea en "Proyecto Demo Alfa" (el "Proyecto Demo Beta" se deja vacío a propósito
-- para probar el estado "proyecto nuevo"):
--   * 3 sprints cerrados con historias aceptadas y rechazadas en su Review  -> gráfica Velocity
--   * 1 sprint activo con tareas repartidas entre el equipo                 -> avance y dashboard
--       - Diana: tareas hechas y pendientes, una sin horas estimadas
--       - Luis: una tarea hecha y una en progreso
--       - Marta: sin tareas                                                 -> "Sin tareas"
--       - Ex Miembro: dado de baja, conserva una tarea hecha                -> histórico
--       - una tarea sin responsable
--   * 3 impedimentos (2 abiertos, uno de ellos de severidad alta) y horas reales registradas

DO $$
DECLARE
  v_proyecto   INTEGER;
  v_po         INTEGER;
  v_diana      INTEGER;
  v_luis       INTEGER;
  v_exmiembro  INTEGER;
  v_c_porhacer INTEGER;
  v_c_progreso INTEGER;
  v_c_hecho    INTEGER;
  v_sprint     INTEGER;
  v_historia   INTEGER;
  v_tarea      INTEGER;
  v_i          INTEGER;
BEGIN
  SELECT id INTO v_proyecto FROM proyectos WHERE nombre = 'Proyecto Demo Alfa';
  IF v_proyecto IS NULL THEN
    RAISE NOTICE 'No existe Proyecto Demo Alfa: ejecuta primero database/seed.sql';
    RETURN;
  END IF;

  -- Idempotencia: si ya se cargó, no hacer nada
  IF EXISTS (SELECT 1 FROM sprints WHERE proyecto_id = v_proyecto AND nombre LIKE 'Demo Sprint %') THEN
    RAISE NOTICE 'Los datos de métricas ya existen; no se duplican.';
    RETURN;
  END IF;

  SELECT id INTO v_po     FROM usuarios WHERE correo = 'pablo@scrumflow.test';
  SELECT id INTO v_diana  FROM usuarios WHERE correo = 'diana@scrumflow.test';
  SELECT id INTO v_luis   FROM usuarios WHERE correo = 'luis@scrumflow.test';

  SELECT id INTO v_c_porhacer FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'Por hacer';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'En progreso';
  SELECT id INTO v_c_hecho    FROM columnas_tablero WHERE proyecto_id = v_proyecto AND es_final = TRUE;

  -- Persona dada de baja: cuenta inactiva y sin pertenecer al proyecto
  INSERT INTO usuarios (nombre, correo, activo)
  VALUES ('Ex Miembro', 'exmiembro@scrumflow.test', FALSE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_exmiembro FROM usuarios WHERE correo = 'exmiembro@scrumflow.test';

  -- ---------------------------------------------------------------------
  -- 3 sprints cerrados (HU-30). Cada uno: 3 historias (2 aceptadas, 1 rechazada)
  --   Sprint 1: aceptadas 5 + 3 = 8 pts   (rechazada de 8 pts NO suma)
  --   Sprint 2: aceptadas 8 + 5 = 13 pts  (rechazada de 3 pts NO suma)
  --   Sprint 3: aceptadas 8 + 8 = 16 pts  (rechazada de 5 pts NO suma)
  -- ---------------------------------------------------------------------
  FOR v_i IN 1..3 LOOP
    INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado, velocity, cerrado_en)
    VALUES (v_proyecto, 'Demo Sprint ' || v_i, 'Sprint cerrado de ejemplo',
            CURRENT_DATE - (28 - (v_i - 1) * 7), CURRENT_DATE - (22 - (v_i - 1) * 7), 90, 'cerrado', NULL,
            NOW() - ((22 - (v_i - 1) * 7) || ' days')::interval)
    RETURNING id INTO v_sprint;

    -- Historia aceptada A
    INSERT INTO historias (proyecto_id, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, v_sprint, 'Demo S' || v_i || ' historia A',
            CASE v_i WHEN 1 THEN 5 WHEN 2 THEN 8 ELSE 8 END, 'aceptada', 100 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    -- Historia aceptada B
    INSERT INTO historias (proyecto_id, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, v_sprint, 'Demo S' || v_i || ' historia B',
            CASE v_i WHEN 1 THEN 3 WHEN 2 THEN 5 ELSE 8 END, 'aceptada', 101 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    -- Historia rechazada: vuelve al backlog (sin sprint), pero su Review conserva el sprint de origen
    INSERT INTO historias (proyecto_id, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, NULL, 'Demo S' || v_i || ' historia rechazada',
            CASE v_i WHEN 1 THEN 8 WHEN 2 THEN 3 ELSE 5 END, 'rechazada', 102 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, comentario, decidido_por)
    VALUES (v_sprint, v_historia, 'rechazada', 'No cumple la definición de terminado', v_po);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 1 sprint activo con tareas (HU-31 y HU-35)
  -- ---------------------------------------------------------------------
  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proyecto, 'Demo Sprint 4 (activo)', 'Sprint activo de ejemplo',
          CURRENT_DATE - 3, CURRENT_DATE + 4, 90, 'activo')
  RETURNING id INTO v_sprint;

  INSERT INTO historias (proyecto_id, sprint_id, titulo, puntos, estado, orden, creada_por)
  VALUES (v_proyecto, v_sprint, 'Demo S4 historia en curso', 8, 'en_sprint', 200, v_po)
  RETURNING id INTO v_historia;

  -- Diana: 3 tareas estimadas (5h y 3h hechas, 2h en progreso) + 1 sin estimar
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: diseñar pantalla',     v_diana, 5,    1),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: maquetar componentes', v_diana, 3,    2),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Demo: conectar con la API',  v_diana, 2,    3),
    (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Demo: tarea sin estimar',    v_diana, NULL, 4);

  -- Luis: 1 tarea hecha (4h) y 1 en progreso (6h)
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: crear endpoints',      v_luis, 4, 5),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Demo: validaciones',         v_luis, 6, 6);

  -- Persona dada de baja: conserva una tarea terminada (3h)
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden)
  VALUES (v_historia, v_proyecto, v_sprint, v_c_hecho, 'Demo: tarea de ex miembro', v_exmiembro, 3, 7);

  -- Tarea sin responsable
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden)
  VALUES (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Demo: tarea sin responsable', NULL, 2, 8);

  -- Horas reales registradas (HU-35: desviación acumulada)
  FOR v_tarea IN SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo IN ('Demo: diseñar pantalla', 'Demo: crear endpoints') LOOP
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT v_tarea, responsable_id, CURRENT_DATE - 1, 6, 'Horas de ejemplo' FROM tareas WHERE id = v_tarea;
  END LOOP;

  -- Impedimentos: 2 abiertos (1 alta) y 1 resuelto
  INSERT INTO impedimentos (proyecto_id, sprint_id, titulo, severidad, estado, creado_por, resuelto_en) VALUES
    (v_proyecto, v_sprint, 'Demo: servidor de pruebas caído',    'alta',  'abierto',  v_diana, NULL),
    (v_proyecto, v_sprint, 'Demo: falta acceso al repositorio',  'media', 'abierto',  v_luis,  NULL),
    (v_proyecto, v_sprint, 'Demo: licencia vencida (resuelto)',  'baja',  'resuelto', v_luis,  NOW());

  RAISE NOTICE 'Datos de métricas creados para Proyecto Demo Alfa (id=%).', v_proyecto;
END
$$;
