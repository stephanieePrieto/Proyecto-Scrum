-- DATOS DE PRUEBA - HU-30 (velocity), HU-31 (avance) y HU-35 (dashboard).
-- NO es parte de la base: solo sirve para ver las métricas con información.
-- Ejecutar DESPUÉS de schema.sql y seed.sql. Es seguro correrlo varias veces (no duplica datos).

DO $$
DECLARE
  v_proyecto   INTEGER;
  v_po         INTEGER;
  v_dana       INTEGER;
  v_diego      INTEGER;
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

  -- Usuarios reales tomados de seed.sql
  SELECT id INTO v_po    FROM usuarios WHERE correo = 'citlipop@gmail.com';
  SELECT id INTO v_dana  FROM usuarios WHERE correo = 'dana044car@gmail.com';
  SELECT id INTO v_diego FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com';

  SELECT id INTO v_c_porhacer FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'Por hacer';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'En progreso';
  SELECT id INTO v_c_hecho    FROM columnas_tablero WHERE proyecto_id = v_proyecto AND es_final = TRUE;

  -- Persona dada de baja
  INSERT INTO usuarios (nombre, correo, activo)
  VALUES ('Marco Reyes (baja)', 'marco.reyes.baja@example.com', FALSE)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_exmiembro FROM usuarios WHERE correo = 'marco.reyes.baja@example.com';

  -- ---------------------------------------------------------------------
  -- 3 sprints cerrados (HU-30: Velocity)
  -- ---------------------------------------------------------------------
  FOR v_i IN 1..3 LOOP
    INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado, velocity, cerrado_en)
    VALUES (v_proyecto, 'Demo Sprint ' || v_i, 'Sprint cerrado de ejemplo',
            CURRENT_DATE - (28 - (v_i - 1) * 7), CURRENT_DATE - (22 - (v_i - 1) * 7), 90, 'cerrado', NULL,
            NOW() - ((22 - (v_i - 1) * 7) || ' days')::interval)
    RETURNING id INTO v_sprint;

    -- Historias aceptadas y rechazadas para simular el scope
    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            v_sprint, 'Demo S' || v_i || ' historia A', CASE v_i WHEN 1 THEN 5 WHEN 2 THEN 8 ELSE 8 END, 'aceptada', 100 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            v_sprint, 'Demo S' || v_i || ' historia B', CASE v_i WHEN 1 THEN 3 WHEN 2 THEN 5 ELSE 8 END, 'aceptada', 101 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, decidido_por) VALUES (v_sprint, v_historia, 'aceptada', v_po);

    -- Historia rechazada
    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            NULL, 'Demo S' || v_i || ' historia rechazada', CASE v_i WHEN 1 THEN 8 WHEN 2 THEN 3 ELSE 5 END, 'rechazada', 102 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, comentario, decidido_por)
    VALUES (v_sprint, v_historia, 'rechazada', 'No cumple la definición de terminado', v_po);
  END LOOP;

  -- ---------------------------------------------------------------------
  -- 1 sprint activo con tareas (HU-31 Avance, HU-35 Dashboard)
  -- ---------------------------------------------------------------------
  UPDATE sprints SET estado = 'planificado' WHERE proyecto_id = v_proyecto AND estado = 'activo';

  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proyecto, 'Demo Sprint 4 (activo)', 'Sprint activo de ejemplo', CURRENT_DATE - 3, CURRENT_DATE + 4, 90, 'activo')
  RETURNING id INTO v_sprint;

  INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
  VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
          v_sprint, 'Demo S4 historia en curso', 8, 'en_sprint', 200, v_po)
  RETURNING id INTO v_historia;

  -- Tareas asignadas
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: diseñar pantalla',    v_dana, 5,    1),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: maquetar componentes', v_dana, 3,    2),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Demo: conectar con la API',  v_dana, 2,    3),
    (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Demo: tarea sin estimar',    v_dana, NULL, 4),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Demo: crear endpoints',      v_diego, 4, 5),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Demo: validaciones',         v_diego, 6, 6),
    (v_historia, v_proyecto, v_sprint, v_c_hecho, 'Demo: tarea de ex miembro', v_exmiembro, 3, 7),
    (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Demo: tarea sin responsable', NULL, 2, 8);

  -- Horas reales registradas normales
  FOR v_tarea IN SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo IN ('Demo: diseñar pantalla', 'Demo: crear endpoints') LOOP
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT v_tarea, responsable_id, CURRENT_DATE - 1, 6, 'Horas de ejemplo' FROM tareas WHERE id = v_tarea;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- HU-33: Datos para forzar alerta por desviación
  -- ---------------------------------------------------------------------
  UPDATE proyectos SET umbral_desviacion = 10 WHERE id = v_proyecto;

  FOR v_tarea IN SELECT id FROM tareas WHERE proyecto_id = v_proyecto AND titulo = 'Demo: conectar con la API' LOOP
    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    VALUES 
      (v_tarea, v_dana, CURRENT_DATE - 2, 8, 'Problemas de conexión con el proveedor externo'),
      (v_tarea, v_dana, CURRENT_DATE - 1, 10, 'Reescribiendo los endpoints por completo');
  END LOOP;

  -- ---------------------------------------------------------------------
  -- HU-29: Snapshots para la Gráfica Burndown
  -- ---------------------------------------------------------------------
  -- Simulamos que el sprint ha estado activo los últimos 3 días.
  INSERT INTO snapshots_burndown (sprint_id, fecha, horas_restantes, puntos_restantes, alcance_modificado) VALUES
    (v_sprint, CURRENT_DATE - 3, 90, 24, false),
    (v_sprint, CURRENT_DATE - 2, 75, 24, false),
    (v_sprint, CURRENT_DATE - 1, 60, 16, true), 
    (v_sprint, CURRENT_DATE,     45, 16, false);

  -- Impedimentos
  INSERT INTO impedimentos (proyecto_id, sprint_id, titulo, severidad, estado, creado_por, resuelto_en) VALUES
    (v_proyecto, v_sprint, 'Demo: servidor de pruebas caído',    'alta',  'abierto',  v_dana, NULL),
    (v_proyecto, v_sprint, 'Demo: falta acceso al repositorio',  'media', 'abierto',  v_diego, NULL),
    (v_proyecto, v_sprint, 'Demo: licencia vencida (resuelto)',  'baja',  'resuelto', v_diego, NOW());

  UPDATE proyectos p SET ultimo_numero_hu = GREATEST(p.ultimo_numero_hu, COALESCE((SELECT MAX(h.numero_hu) FROM historias h WHERE h.proyecto_id = p.id), 0)) WHERE p.id = v_proyecto;

  RAISE NOTICE 'Datos de métricas creados para Proyecto Demo Alfa (id=%).', v_proyecto;
END
$$;