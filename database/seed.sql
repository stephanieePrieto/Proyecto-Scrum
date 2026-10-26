-- BASE (no modificar sin avisar al equipo) - HU-47: datos de prueba: 2 equipos, usuarios por rol y un sprint de ejemplo

-- BASE (no modificar sin avisar al equipo) - HU-47: datos de prueba (2 equipos, usuarios por rol y un sprint de ejemplo)
-- Ejecutar DESPUES de schema.sql:   psql -U TU_USUARIO -d scrumflow -f database/seed.sql
-- Es seguro correrlo varias veces: no duplica los datos.
--
-- Todos los usuarios de prueba tienen la contrasena:  Scrum2026!
--   admin@scrumflow.test                          Administrador
--   sm.alfa@scrumflow.test / po.alfa@...          Scrum Master y Product Owner del Equipo Alfa
--   dev1.alfa@... dev2.alfa@... dev3.alfa@...     Desarrolladores del Equipo Alfa
--   (igual para el Equipo Beta, cambiando "alfa" por "beta")

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuarios
INSERT INTO usuarios (nombre, correo, password_hash, es_admin, acepto_privacidad_en)
SELECT v.nombre, v.correo, crypt('Scrum2026!', gen_salt('bf', 10)), v.es_admin, NOW()
FROM (VALUES
  ('Admin ScrumFlow',   'admin@scrumflow.test',    TRUE),
  ('Sofia (SM Alfa)',   'sm.alfa@scrumflow.test',  FALSE),
  ('Pablo (PO Alfa)',   'po.alfa@scrumflow.test',  FALSE),
  ('Diana (Dev Alfa)',  'dev1.alfa@scrumflow.test', FALSE),
  ('Luis (Dev Alfa)',   'dev2.alfa@scrumflow.test', FALSE),
  ('Marta (Dev Alfa)',  'dev3.alfa@scrumflow.test', FALSE),
  ('Sergio (SM Beta)',  'sm.beta@scrumflow.test',  FALSE),
  ('Paula (PO Beta)',   'po.beta@scrumflow.test',  FALSE),
  ('Daniel (Dev Beta)', 'dev1.beta@scrumflow.test', FALSE),
  ('Laura (Dev Beta)',  'dev2.beta@scrumflow.test', FALSE),
  ('Mario (Dev Beta)',  'dev3.beta@scrumflow.test', FALSE)
) AS v(nombre, correo, es_admin)
ON CONFLICT DO NOTHING;

INSERT INTO capacidad_usuario (usuario_id)
SELECT id FROM usuarios
ON CONFLICT DO NOTHING;

-- Equipos y sus miembros
INSERT INTO equipos (nombre) VALUES ('Equipo Alfa'), ('Equipo Beta')
ON CONFLICT DO NOTHING;

INSERT INTO miembros_equipo (equipo_id, usuario_id)
SELECT e.id, u.id
FROM equipos e
JOIN usuarios u
  ON (e.nombre = 'Equipo Alfa' AND u.correo LIKE '%.alfa@scrumflow.test')
  OR (e.nombre = 'Equipo Beta' AND u.correo LIKE '%.beta@scrumflow.test')
ON CONFLICT DO NOTHING;

-- Un proyecto por equipo
INSERT INTO proyectos (equipo_id, nombre, vision, fecha_inicio, fecha_fin)
SELECT e.id, 'Proyecto Demo ' || REPLACE(e.nombre, 'Equipo ', ''),
       'Proyecto de ejemplo para probar ScrumFlow', CURRENT_DATE, CURRENT_DATE + 60
FROM equipos e
ON CONFLICT DO NOTHING;

-- Roles por proyecto, segun el inicio del correo: sm.* = Scrum Master, po.* = Product Owner, el resto = Developer
INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
SELECT p.id, u.id,
       CASE WHEN u.correo LIKE 'sm.%' THEN 'scrum_master'
            WHEN u.correo LIKE 'po.%' THEN 'product_owner'
            ELSE 'developer' END
FROM proyectos p
JOIN miembros_equipo me ON me.equipo_id = p.equipo_id
JOIN usuarios u ON u.id = me.usuario_id
ON CONFLICT DO NOTHING;

-- Columnas por defecto del tablero
INSERT INTO columnas_tablero (proyecto_id, nombre, orden, es_final)
SELECT p.id, c.nombre, c.orden, c.es_final
FROM proyectos p
CROSS JOIN (VALUES
  ('Por hacer',   1, FALSE),
  ('En progreso', 2, FALSE),
  ('En revision', 3, FALSE),
  ('Hecho',       4, TRUE)
) AS c(nombre, orden, es_final)
ON CONFLICT DO NOTHING;

-- Un sprint planificado para el Proyecto Demo Alfa
INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas)
SELECT p.id, 'Sprint 1', 'Primer sprint de ejemplo', CURRENT_DATE, CURRENT_DATE + 6, 90
FROM proyectos p
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = p.id);

-- Cuatro historias de ejemplo en el backlog del Proyecto Demo Alfa
INSERT INTO historias (proyecto_id, titulo, como, quiero, para, criterios, puntos, orden, creada_por)
SELECT p.id, h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.orden,
       (SELECT id FROM usuarios WHERE correo = 'po.alfa@scrumflow.test')
FROM proyectos p
CROSS JOIN (VALUES
  ('Iniciar sesion',       'usuario', 'iniciar sesion con mi correo', 'acceder a mis proyectos',     'Con credenciales validas entro al dashboard', 3, 1),
  ('Ver mis proyectos',    'usuario', 'ver la lista de mis proyectos', 'elegir en cual trabajar',    'Solo veo proyectos de mis equipos',           5, 2),
  ('Crear una historia',   'product owner', 'crear historias de usuario', 'mantener el backlog',    'La historia aparece al final del backlog',    5, 3),
  ('Mover tarjetas',       'desarrollador', 'mover tarjetas entre columnas', 'reflejar mi avance',  'Los demas ven el cambio sin recargar',        8, 4)
) AS h(titulo, como, quiero, para, criterios, puntos, orden)
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM historias x WHERE x.proyecto_id = p.id);
