-- BASE (no modificar sin avisar al equipo) - HU-47: datos de prueba (2 equipos, usuarios base y un sprint de ejemplo)
-- Ejecutar DESPUES de schema.sql. Es seguro correrlo varias veces: no duplica los datos.
--
-- Todos los usuarios son "base": ninguno tiene rol global. El rol existe solo DENTRO de un proyecto.
-- Contrasena de todos:  Scrum2026!   (correos: nombre@scrumflow.test)
--   Proyecto Demo Alfa: Sofia = Scrum Master, Pablo = Product Owner, Diana / Luis / Marta = Developers
--   Proyecto Demo Beta: Diana = Scrum Master, Paula = Product Owner, Sergio / Daniel / Laura / Mario = Developers
--   Diana tiene un rol distinto en cada proyecto. Nora no pertenece a ningun equipo (prueba de "sin proyectos").

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuarios (sin rol). Los hashes bcrypt se migran solos a Argon2id en el primer inicio de sesion.
INSERT INTO usuarios (nombre, correo, password_hash, acepto_privacidad_en)
SELECT v.nombre, v.correo, crypt('Scrum2026!', gen_salt('bf', 10)), NOW()
FROM (VALUES
  ('Sofia',  'sofia@scrumflow.test'),
  ('Pablo',  'pablo@scrumflow.test'),
  ('Diana',  'diana@scrumflow.test'),
  ('Luis',   'luis@scrumflow.test'),
  ('Marta',  'marta@scrumflow.test'),
  ('Sergio', 'sergio@scrumflow.test'),
  ('Paula',  'paula@scrumflow.test'),
  ('Daniel', 'daniel@scrumflow.test'),
  ('Laura',  'laura@scrumflow.test'),
  ('Mario',  'mario@scrumflow.test'),
  ('Nora',   'nora@scrumflow.test')
) AS v(nombre, correo)
ON CONFLICT DO NOTHING;

-- Capacidad individual (6 horas por dia por defecto)
INSERT INTO capacidad_usuarios (usuario_id)
SELECT id FROM usuarios
ON CONFLICT DO NOTHING;

-- Equipos (con su creador)
INSERT INTO equipos (nombre, creado_por)
SELECT e.nombre, u.id
FROM (VALUES
  ('Equipo Alfa', 'sofia@scrumflow.test'),
  ('Equipo Beta', 'diana@scrumflow.test')
) AS e(nombre, correo)
JOIN usuarios u ON u.correo = e.correo
ON CONFLICT DO NOTHING;

-- Miembros de cada equipo (sin rol)
INSERT INTO miembros_equipo (equipo_id, usuario_id)
SELECT e.id, u.id
FROM (VALUES
  ('Equipo Alfa', 'sofia@scrumflow.test'),
  ('Equipo Alfa', 'pablo@scrumflow.test'),
  ('Equipo Alfa', 'diana@scrumflow.test'),
  ('Equipo Alfa', 'luis@scrumflow.test'),
  ('Equipo Alfa', 'marta@scrumflow.test'),
  ('Equipo Beta', 'diana@scrumflow.test'),
  ('Equipo Beta', 'paula@scrumflow.test'),
  ('Equipo Beta', 'sergio@scrumflow.test'),
  ('Equipo Beta', 'daniel@scrumflow.test'),
  ('Equipo Beta', 'laura@scrumflow.test'),
  ('Equipo Beta', 'mario@scrumflow.test')
) AS m(equipo, correo)
JOIN equipos e ON e.nombre = m.equipo
JOIN usuarios u ON u.correo = m.correo
ON CONFLICT DO NOTHING;

-- Un proyecto por equipo (lo crea quien creo el equipo)
INSERT INTO proyectos (equipo_id, nombre, vision, fecha_inicio, fecha_fin, creado_por)
SELECT e.id, 'Proyecto Demo ' || REPLACE(e.nombre, 'Equipo ', ''),
       'Proyecto de ejemplo para probar ScrumFlow', CURRENT_DATE, CURRENT_DATE + 60, e.creado_por
FROM equipos e
ON CONFLICT DO NOTHING;

-- Roles POR PROYECTO (unico lugar donde existe el rol)
INSERT INTO miembros_proyecto (proyecto_id, usuario_id, rol)
SELECT p.id, u.id, r.rol
FROM (VALUES
  ('Proyecto Demo Alfa', 'sofia@scrumflow.test',  'scrum_master'),
  ('Proyecto Demo Alfa', 'pablo@scrumflow.test',  'product_owner'),
  ('Proyecto Demo Alfa', 'diana@scrumflow.test',  'developer'),
  ('Proyecto Demo Alfa', 'luis@scrumflow.test',   'developer'),
  ('Proyecto Demo Alfa', 'marta@scrumflow.test',  'developer'),
  ('Proyecto Demo Beta', 'diana@scrumflow.test',  'scrum_master'),
  ('Proyecto Demo Beta', 'paula@scrumflow.test',  'product_owner'),
  ('Proyecto Demo Beta', 'sergio@scrumflow.test', 'developer'),
  ('Proyecto Demo Beta', 'daniel@scrumflow.test', 'developer'),
  ('Proyecto Demo Beta', 'laura@scrumflow.test',  'developer'),
  ('Proyecto Demo Beta', 'mario@scrumflow.test',  'developer')
) AS r(proyecto, correo, rol)
JOIN proyectos p ON p.nombre = r.proyecto
JOIN usuarios u  ON u.correo = r.correo
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

-- Cuatro historias de ejemplo en el backlog del Proyecto Demo Alfa (las crea su Product Owner)
INSERT INTO historias (proyecto_id, titulo, como, quiero, para, criterios, puntos, orden, creada_por)
SELECT p.id, h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.orden,
       (SELECT id FROM usuarios WHERE correo = 'pablo@scrumflow.test')
FROM proyectos p
CROSS JOIN (VALUES
  ('Iniciar sesion',     'usuario',       'iniciar sesion con mi correo',      'acceder a mis proyectos',  'Con credenciales validas entro al dashboard', 3, 1),
  ('Ver mis proyectos',  'usuario',       'ver la lista de mis proyectos',     'elegir en cual trabajar',  'Solo veo proyectos de mis equipos',           5, 2),
  ('Crear una historia', 'product owner', 'crear historias de usuario',        'mantener el backlog',      'La historia aparece al final del backlog',    5, 3),
  ('Mover tarjetas',     'desarrollador', 'mover tarjetas entre columnas',     'reflejar mi avance',       'Los demas ven el cambio sin recargar',        8, 4)
) AS h(titulo, como, quiero, para, criterios, puntos, orden)
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM historias x WHERE x.proyecto_id = p.id);