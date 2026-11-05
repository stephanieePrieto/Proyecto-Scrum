-- ===========================================================================
-- SEED-BITACORA.SQL - Datos de prueba para la bitácora de auditoría
-- ===========================================================================
-- 
-- Este archivo inserta registros de ejemplo en la tabla bitacora para probar
-- la funcionalidad de consulta de la bitácora de auditoría (HU-46).
-- 
-- REQUISITOS:
--   - Ejecutar primero database/schema.sql para crear las tablas
--   - Ejecutar database/seed.sql para crear usuarios, equipos y proyectos base
--   - Este archivo NO crea usuarios ni proyectos, solo registros de auditoría
-- 
-- USO:
--   psql -U tu_usuario -d tu_base_de_datos -f database/seed-bitacora.sql
-- 
-- NOTA: Los IDs de usuario y proyecto deben coincidir con los existentes en tu BD.
--       Si usas los datos de seed.sql, estos IDs ya existirán.
-- ===========================================================================

-- Limpiar la bitácora (opcional: descomentar si quieres empezar de cero)
-- TRUNCATE TABLE bitacora;

-- ===========================================================================
-- REGISTROS DE PRUEBA PARA PROYECTO 1
-- ===========================================================================
-- Suponiendo que seed.sql creó:
--   - Proyecto 1: "ScrumFlow" (equipo_id: 1)
--   - Usuario 1: "admin" o creador del proyecto
--   - Usuario 2: Scrum Master del proyecto 1
--   - Usuario 3: Product Owner del proyecto 1
--   - Usuario 4: Developer del proyecto 1

-- Creación del proyecto
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    1,  -- Usuario creador
    1,  -- Proyecto 1
    'proyecto_creado',
    'proyecto',
    1,
    '{"nombre": "ScrumFlow", "equipo_id": 1, "fecha_inicio": "2024-01-01", "fecha_fin": "2024-12-31"}',
    '2024-10-01 09:00:00+00'
);

-- Configuración inicial del tablero
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    1,
    1,
    'tablero_configurado',
    'tablero',
    NULL,
    '{"columnas": ["Backlog", "To Do", "In Progress", "Review", "Done"]}',
    '2024-10-01 09:15:00+00'
);

-- Invitaciones enviadas
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    1,
    1,
    'invitacion_creada',
    'invitacion',
    1,
    '{"correo": "scrum.master@example.com", "rol": "scrum_master"}',
    '2024-10-01 10:00:00+00'
);

INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    1,
    1,
    'invitacion_creada',
    'invitacion',
    2,
    '{"correo": "product.owner@example.com", "rol": "product_owner"}',
    '2024-10-01 10:05:00+00'
);

-- Invitaciones aceptadas
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,  -- Scrum Master acepta
    1,
    'invitacion_aceptada',
    'invitacion',
    1,
    '{"usuario_id": 2, "rol": "scrum_master"}',
    '2024-10-01 11:00:00+00'
);

INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,  -- Product Owner acepta
    1,
    'invitacion_aceptada',
    'invitacion',
    2,
    '{"usuario_id": 3, "rol": "product_owner"}',
    '2024-10-01 11:30:00+00'
);

-- Creación de épicas
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,  -- Product Owner
    1,
    'epica_creada',
    'epica',
    1,
    '{"nombre": "Gestión de proyectos", "color": "#4F46E5"}',
    '2024-10-02 14:00:00+00'
);

INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,
    1,
    'epica_creada',
    'epica',
    2,
    '{"nombre": "Tablero Kanban", "color": "#7C3AED"}',
    '2024-10-02 15:30:00+00'
);

-- Creación de historias
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,
    1,
    'historia_creada',
    'historia',
    1,
    '{"numero_hu": 1, "titulo": "Como PO quiero crear proyectos", "epica_id": 1, "puntos": 5}',
    '2024-10-03 09:00:00+00'
);

INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,  -- Scrum Master
    1,
    'historia_creada',
    'historia',
    2,
    '{"numero_hu": 2, "titulo": "Como SM quiero configurar el tablero", "epica_id": 2, "puntos": 3}',
    '2024-10-03 10:00:00+00'
);

-- Modificación de historia
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,
    1,
    'historia_modificada',
    'historia',
    1,
    '{"antes": {"puntos": 5}, "despues": {"puntos": 8}}',
    '2024-10-04 16:00:00+00'
);

-- Creación de sprint
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,  -- Scrum Master
    1,
    'sprint_creado',
    'sprint',
    1,
    '{"nombre": "Sprint 1", "fecha_inicio": "2024-10-07", "fecha_fin": "2024-10-20", "capacidad_horas": 320}',
    '2024-10-05 09:00:00+00'
);

-- Inicio de sprint
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,
    1,
    'sprint_iniciado',
    'sprint',
    1,
    '{"estado_anterior": "planificado", "estado_nuevo": "activo"}',
    '2024-10-07 09:00:00+00'
);

-- Creación de tareas
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    4,  -- Developer
    1,
    'tarea_creada',
    'tarea',
    1,
    '{"titulo": "Diseñar modelo de datos", "historia_id": 1, "columna_id": 2, "horas_estimadas": 4}',
    '2024-10-07 10:00:00+00'
);

INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    4,
    1,
    'tarea_creada',
    'tarea',
    2,
    '{"titulo": "Implementar API de proyectos", "historia_id": 1, "columna_id": 2, "horas_estimadas": 8}',
    '2024-10-07 11:00:00+00'
);

-- Tarea movida
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    4,
    1,
    'tarea_movida',
    'tarea',
    1,
    '{"antes": {"columna_id": 2}, "despues": {"columna_id": 3}, "contexto": {"columna_origen": "To Do", "columna_destino": "In Progress"}}',
    '2024-10-08 14:00:00+00'
);

-- Cambio de estado de historia
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    4,
    1,
    'historia_estado_cambiado',
    'historia',
    2,
    '{"antes": {"estado": "backlog"}, "despues": {"estado": "en_sprint"}}',
    '2024-10-09 10:00:00+00'
);

-- Impedimento creado
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    4,
    1,
    'impedimento_creado',
    'impedimento',
    1,
    '{"titulo": "Base de datos lenta", "severidad": "alta", "responsable_id": 2, "tarea_id": 2}',
    '2024-10-10 15:00:00+00'
);

-- Impedimento resuelto
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,  -- Scrum Master resuelve
    1,
    'impedimento_resuelto',
    'impedimento',
    1,
    '{"antes": {"estado": "abierto"}, "despues": {"estado": "resuelto"}}',
    '2024-10-11 10:00:00+00'
);

-- Cierre de sprint
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,
    1,
    'sprint_cerrado',
    'sprint',
    1,
    '{"estado_anterior": "activo", "estado_nuevo": "cerrado", "velocity": 40}',
    '2024-10-20 16:00:00+00'
);

-- Creación de Sprint 2
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,
    1,
    'sprint_creado',
    'sprint',
    2,
    '{"nombre": "Sprint 2", "fecha_inicio": "2024-10-21", "fecha_fin": "2024-11-03", "capacidad_horas": 340}',
    '2024-10-21 08:00:00+00'
);

-- ===========================================================================
-- REGISTROS DE PRUEBA PARA PROYECTO 2 (si existe)
-- ===========================================================================
-- Descomentar si tienes un segundo proyecto para probar el aislamiento por proyecto

-- INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
-- VALUES (
--     5,
--     2,
--     'proyecto_creado',
--     'proyecto',
--     2,
--     '{"nombre": "App Mobile", "equipo_id": 2, "fecha_inicio": "2024-11-01", "fecha_fin": "2025-02-28"}',
--     '2024-10-25 10:00:00+00'
-- );

-- ===========================================================================
-- REGISTROS PARA PRUEBAS DE FILTROS
-- ===========================================================================
-- Estos registros tienen fechas y acciones específicas para probar los filtros

-- Diferente acción para probar filtro por acción
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    2,
    1,
    'rol_proyecto_asignado',
    'rol',
    NULL,
    '{"usuario_id": 5, "rol": "developer"}',
    '2024-10-15 12:00:00+00'
);

-- Diferente usuario para probar filtro por usuario
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    5,  -- Otro developer
    1,
    'tarea_creada',
    'tarea',
    3,
    '{"titulo": "Probar funcionalidad", "historia_id": 2, "columna_id": 2, "horas_estimadas": 2}',
    '2024-10-18 14:30:00+00'
);

-- Fecha diferente para probar filtro por fecha
INSERT INTO bitacora (usuario_id, proyecto_id, accion, objeto, objeto_id, detalle, creado_en)
VALUES (
    3,
    1,
    'epica_modificada',
    'epica',
    1,
    '{"antes": {"color": "#4F46E5"}, "despues": {"color": "#1E40AF"}}',
    '2024-09-28 15:00:00+00'  -- Antes del inicio del proyecto
);

-- ===========================================================================
-- CONTADOR: 25 registros de auditoría para el proyecto 1
-- ===========================================================================

-- Consulta para verificar:
-- SELECT COUNT(*) FROM bitacora WHERE proyecto_id = 1;
-- SELECT * FROM bitacora WHERE proyecto_id = 1 ORDER BY creado_en DESC LIMIT 10;

-- ===========================================================================
-- NOTAS FINALES
-- ===========================================================================
-- 1. Los IDs de usuario (1-5) deben existir en tu base de datos
-- 2. El proyecto_id 1 debe existir
-- 3. Puedes ajustar las fechas según tus necesidades
-- 4. Para limpiar: TRUNCATE TABLE bitacora;
-- 5. Los registros siguen el mismo formato que usa registrarAuditoria()
