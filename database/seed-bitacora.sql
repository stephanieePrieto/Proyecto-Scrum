-- ===========================================================================
-- SEED-BITACORA.SQL - Datos de prueba para la bitácora de auditoría (HU-46)
-- ===========================================================================
--
-- Inserta registros de ejemplo en la tabla bitacora para probar la consulta de la
-- bitácora. Es seguro correrlo varias veces: NO duplica registros.
--
-- REQUISITOS (en este orden):
--   1. database/schema.sql   -> crea las tablas
--   2. database/seed.sql     -> crea usuarios, equipos y proyectos base (Proyecto Demo Alfa / Beta)
--   Este archivo NO crea usuarios ni proyectos, solo registros de auditoría.
--
-- USO:
--   psql -U tu_usuario -d tu_base_de_datos -f database/seed-bitacora.sql
--
-- CÓMO FUNCIONA:
--   * Sin IDs fijos: los usuarios se buscan por correo y los proyectos por nombre, así que
--     funciona aunque los ids de la base sean otros (por ejemplo, tras borrar y repoblar).
--   * Sin duplicados: un registro se considera ya cargado si existe otro con el mismo
--     (proyecto_id, accion, creado_en). Las fechas de abajo son fijas a propósito, justo para eso.
--   * Si falta un usuario o un proyecto del seed.sql, avisa con un NOTICE y no inserta nada.
--   * Los objeto_id de épicas, historias, tareas, sprints, etc. son ilustrativos (la bitácora no
--     tiene llaves foráneas a propósito). Solo el id del proyecto y los ids de usuario son reales.
--
-- LA BITÁCORA ES INMUTABLE: no se puede hacer UPDATE, DELETE ni TRUNCATE sobre ella (triggers de
-- schema.sql y migraciones/bitacora_inmutable.sql). Por eso este archivo nunca limpia la tabla.
-- Para empezar de cero hay que recrear la base de desarrollo completa (schema.sql + seed.sql).
-- ===========================================================================

DO $$
DECLARE
  -- Proyectos y usuarios, por nombre / correo (los de seed.sql)
  c_proyecto_1 CONSTANT TEXT := 'Proyecto Demo Alfa';
  c_proyecto_2 CONSTANT TEXT := 'Proyecto Demo Beta';
  c_sm1        CONSTANT TEXT := 'stephanieehpr@gmail.com';   -- Scrum Master de Alfa (y quien creó el proyecto)
  c_po1        CONSTANT TEXT := 'citlipop@gmail.com';        -- Product Owner de Alfa
  c_dev1       CONSTANT TEXT := 'dana044car@gmail.com';      -- Developer de Alfa
  c_dev2       CONSTANT TEXT := 'diegotrujano3c@gmail.com';  -- Developer de Alfa
  c_sm2        CONSTANT TEXT := 'dana044car@gmail.com';      -- Scrum Master de Beta

  v_p1      INTEGER;
  v_p2      INTEGER;
  v_equipo1 INTEGER;
  v_equipo2 INTEGER;
  v_sm      INTEGER;
  v_po      INTEGER;
  v_dev1    INTEGER;
  v_dev2    INTEGER;
  v_sm2     INTEGER;
  v_nuevos  INTEGER;
BEGIN
  -- ---------------------------------------------------------------- Resolver ids
  SELECT id, equipo_id INTO v_p1, v_equipo1 FROM proyectos WHERE nombre = c_proyecto_1;
  SELECT id, equipo_id INTO v_p2, v_equipo2 FROM proyectos WHERE nombre = c_proyecto_2;
  SELECT id INTO v_sm   FROM usuarios WHERE correo = c_sm1;
  SELECT id INTO v_po   FROM usuarios WHERE correo = c_po1;
  SELECT id INTO v_dev1 FROM usuarios WHERE correo = c_dev1;
  SELECT id INTO v_dev2 FROM usuarios WHERE correo = c_dev2;
  SELECT id INTO v_sm2  FROM usuarios WHERE correo = c_sm2;

  IF v_p1 IS NULL OR v_sm IS NULL OR v_po IS NULL OR v_dev1 IS NULL OR v_dev2 IS NULL THEN
    RAISE NOTICE 'Faltan "%" o sus usuarios (corre primero seed.sql). No se cargó la bitácora de prueba.', c_proyecto_1;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------- Insertar solo lo que falte
  -- Columnas: usuario, proyecto, acción, objeto, objeto_id, detalle, fecha
  WITH nuevos (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en) AS (
    VALUES
    -- Creación del proyecto y del tablero
    (v_sm,   v_p1, 'proyecto_creado',      'proyecto',    v_p1,
       jsonb_build_object('nombre', c_proyecto_1, 'equipo_id', v_equipo1, 'fecha_inicio', '2024-01-01', 'fecha_fin', '2024-12-31'),
       TIMESTAMPTZ '2024-10-01 09:00:00+00'),
    (v_sm,   v_p1, 'tablero_configurado',  'tablero',     NULL,
       '{"columnas": ["Por hacer", "En progreso", "En revision", "Hecho"]}'::jsonb,
       TIMESTAMPTZ '2024-10-01 09:15:00+00'),

    -- Invitaciones enviadas
    (v_sm,   v_p1, 'invitacion_creada',    'invitacion',  1,
       jsonb_build_object('correo', c_sm1, 'rol', 'scrum_master'),
       TIMESTAMPTZ '2024-10-01 10:00:00+00'),
    (v_sm,   v_p1, 'invitacion_creada',    'invitacion',  2,
       jsonb_build_object('correo', c_po1, 'rol', 'product_owner'),
       TIMESTAMPTZ '2024-10-01 10:05:00+00'),

    -- Invitaciones aceptadas
    (v_sm,   v_p1, 'invitacion_aceptada',  'invitacion',  1,
       jsonb_build_object('usuario_id', v_sm, 'rol', 'scrum_master'),
       TIMESTAMPTZ '2024-10-01 11:00:00+00'),
    (v_po,   v_p1, 'invitacion_aceptada',  'invitacion',  2,
       jsonb_build_object('usuario_id', v_po, 'rol', 'product_owner'),
       TIMESTAMPTZ '2024-10-01 11:30:00+00'),

    -- Épicas
    (v_po,   v_p1, 'epica_creada',         'epica',       1,
       '{"nombre": "Gestión de proyectos", "color": "#4F46E5"}'::jsonb,
       TIMESTAMPTZ '2024-10-02 14:00:00+00'),
    (v_po,   v_p1, 'epica_creada',         'epica',       2,
       '{"nombre": "Tablero Kanban", "color": "#7C3AED"}'::jsonb,
       TIMESTAMPTZ '2024-10-02 15:30:00+00'),

    -- Historias
    (v_po,   v_p1, 'historia_creada',      'historia',    1,
       '{"numero_hu": 1, "titulo": "Como PO quiero crear proyectos", "epica_id": 1, "puntos": 5}'::jsonb,
       TIMESTAMPTZ '2024-10-03 09:00:00+00'),
    (v_sm,   v_p1, 'historia_creada',      'historia',    2,
       '{"numero_hu": 2, "titulo": "Como SM quiero configurar el tablero", "epica_id": 2, "puntos": 3}'::jsonb,
       TIMESTAMPTZ '2024-10-03 10:00:00+00'),
    (v_po,   v_p1, 'historia_modificada',  'historia',    1,
       '{"antes": {"puntos": 5}, "despues": {"puntos": 8}}'::jsonb,
       TIMESTAMPTZ '2024-10-04 16:00:00+00'),

    -- Sprint 1
    (v_sm,   v_p1, 'sprint_creado',        'sprint',      1,
       '{"nombre": "Sprint 1", "fecha_inicio": "2024-10-07", "fecha_fin": "2024-10-20", "capacidad_horas": 320}'::jsonb,
       TIMESTAMPTZ '2024-10-05 09:00:00+00'),
    (v_sm,   v_p1, 'sprint_iniciado',      'sprint',      1,
       '{"estado_anterior": "planificado", "estado_nuevo": "activo"}'::jsonb,
       TIMESTAMPTZ '2024-10-07 09:00:00+00'),

    -- Tareas
    (v_dev1, v_p1, 'tarea_creada',         'tarea',       1,
       '{"titulo": "Diseñar modelo de datos", "historia_id": 1, "columna_id": 2, "horas_estimadas": 4}'::jsonb,
       TIMESTAMPTZ '2024-10-07 10:00:00+00'),
    (v_dev1, v_p1, 'tarea_creada',         'tarea',       2,
       '{"titulo": "Implementar API de proyectos", "historia_id": 1, "columna_id": 2, "horas_estimadas": 8}'::jsonb,
       TIMESTAMPTZ '2024-10-07 11:00:00+00'),
    (v_dev1, v_p1, 'tarea_movida',         'tarea',       1,
       '{"antes": {"columna_id": 2}, "despues": {"columna_id": 3}, "contexto": {"columna_origen": "Por hacer", "columna_destino": "En progreso"}}'::jsonb,
       TIMESTAMPTZ '2024-10-08 14:00:00+00'),
    (v_dev1, v_p1, 'historia_estado_cambiado', 'historia', 2,
       '{"antes": {"estado": "backlog"}, "despues": {"estado": "en_sprint"}}'::jsonb,
       TIMESTAMPTZ '2024-10-09 10:00:00+00'),

    -- Impedimentos
    (v_dev1, v_p1, 'impedimento_creado',   'impedimento', 1,
       jsonb_build_object('titulo', 'Base de datos lenta', 'severidad', 'alta', 'responsable_id', v_sm, 'tarea_id', 2),
       TIMESTAMPTZ '2024-10-10 15:00:00+00'),
    (v_sm,   v_p1, 'impedimento_resuelto', 'impedimento', 1,
       '{"antes": {"estado": "abierto"}, "despues": {"estado": "resuelto"}}'::jsonb,
       TIMESTAMPTZ '2024-10-11 10:00:00+00'),

    -- Cierre del Sprint 1 y creación del Sprint 2
    (v_sm,   v_p1, 'sprint_cerrado',       'sprint',      1,
       '{"estado_anterior": "activo", "estado_nuevo": "cerrado", "velocity": 40}'::jsonb,
       TIMESTAMPTZ '2024-10-20 16:00:00+00'),
    (v_sm,   v_p1, 'sprint_creado',        'sprint',      2,
       '{"nombre": "Sprint 2", "fecha_inicio": "2024-10-21", "fecha_fin": "2024-11-03", "capacidad_horas": 340}'::jsonb,
       TIMESTAMPTZ '2024-10-21 08:00:00+00'),

    -- Registros para probar los filtros ------------------------------------
    -- Otra acción (filtro por acción)
    (v_sm,   v_p1, 'rol_proyecto_asignado', 'rol',        NULL,
       jsonb_build_object('usuario_id', v_dev2, 'rol', 'developer'),
       TIMESTAMPTZ '2024-10-15 12:00:00+00'),
    -- Otro usuario (filtro por usuario)
    (v_dev2, v_p1, 'tarea_creada',         'tarea',       3,
       '{"titulo": "Probar funcionalidad", "historia_id": 2, "columna_id": 2, "horas_estimadas": 2}'::jsonb,
       TIMESTAMPTZ '2024-10-18 14:30:00+00'),
    -- Otra fecha, anterior al inicio del proyecto (filtro por fecha)
    (v_po,   v_p1, 'epica_modificada',     'epica',       1,
       '{"antes": {"color": "#4F46E5"}, "despues": {"color": "#1E40AF"}}'::jsonb,
       TIMESTAMPTZ '2024-09-28 15:00:00+00'),

    -- Segundo proyecto (prueba de aislamiento por proyecto). Solo se carga si existe "Proyecto Demo Beta".
    (v_sm2,  v_p2, 'proyecto_creado',      'proyecto',    v_p2,
       jsonb_build_object('nombre', c_proyecto_2, 'equipo_id', v_equipo2, 'fecha_inicio', '2024-11-01', 'fecha_fin', '2025-02-28'),
       TIMESTAMPTZ '2024-10-25 10:00:00+00')
  )
  INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
  SELECT n.usuario_id, n.proyecto_id, n.accion, n.objeto, n.objeto_id, n.detalle, n.creado_en
  FROM nuevos n
  WHERE n.usuario_id IS NOT NULL
    AND n.proyecto_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM bitacora b
      WHERE b.proyecto_id = n.proyecto_id
        AND b.accion      = n.accion
        AND b.creado_en   = n.creado_en
    );

  GET DIAGNOSTICS v_nuevos = ROW_COUNT;
  IF v_nuevos = 0 THEN
    RAISE NOTICE 'La bitácora de prueba ya estaba cargada. No se insertó nada.';
  ELSE
    RAISE NOTICE 'Bitácora de prueba: % registro(s) nuevo(s) insertado(s).', v_nuevos;
  END IF;
END $$;

-- ===========================================================================
-- VERIFICACIÓN (opcional)
-- ===========================================================================
-- Proyecto Demo Alfa: 24 registros; Proyecto Demo Beta: 1 registro.
-- SELECT p.nombre, COUNT(*) FROM bitacora b JOIN proyectos p ON p.id = b.proyecto_id GROUP BY p.nombre;
-- SELECT * FROM bitacora ORDER BY creado_en DESC LIMIT 10;
--
-- Los registros siguen el mismo formato que usa registrarAuditoria().
