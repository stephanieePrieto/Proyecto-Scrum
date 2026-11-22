/**
  @file seed.sql
  @description BASE (no modificar sin avisar al equipo) - datos de prueba con el equipo ListiVerse
  Ejecutar DESPUES de schema.sql. Es seguro correrlo varias veces: no duplica los datos.

  Todos los usuarios son "base": ninguno tiene rol global. El rol existe solo DENTRO de un proyecto.
  Contrasena de todos:  Scrum2026!   (correos personalizados)
    Proyecto Demo Alfa: Stephy = Scrum Master, Citlaly = Product Owner, Dana / Diego = Developers
    Proyecto Demo Beta: Dana = Scrum Master, Diego = Product Owner, Stephy / Citlaly = Developers
    Al final: datos de prueba del Tablero en Proyecto Demo Alfa (el proyecto que abre el tablero por defecto), con su sprint activo.

  @author Stephanie Elizdeth Hernández Prieto
  @author Camila Mariné Crespo Zurita
  @author Citlaly Morales Viveros
  @author Alfonso Mendoza Vasquez
  @author Jetzaly Josmery Tello Campos
*/
/**
  @file seed.sql
  @description BASE (no modificar sin avisar al equipo) - datos de prueba con el equipo ListiVerse
  Ejecutar DESPUES de schema.sql. Es seguro correrlo varias veces: no duplica los datos.

  Todos los usuarios son "base": ninguno tiene rol global. El rol existe solo DENTRO de un proyecto.
  Contrasena de todos:  Scrum2026!   (correos personalizados)
    Proyecto Demo Alfa: Stephy = Scrum Master, Citlaly = Product Owner, Dana / Diego = Developers
    Proyecto Demo Beta: Dana = Scrum Master, Diego = Product Owner, Stephy / Citlaly = Developers
    Proyecto Demo Gamma: Stephy = Scrum Master, Citlaly = Product Owner, Dana / Diego = Developers
    Al final: datos de prueba del Tablero en Proyecto Demo Alfa (el proyecto que abre el tablero por defecto), con su sprint activo.
    Ademas: datos de metricas del Proyecto Demo Gamma (para el comparativo HU-2) y datos
    adicionales de Demo Alfa (6 tareas extra con horas reales y la historia de cambios de
    columna para el CFD). Lo que antes hacia seed-cfd-demo-alfa.sql ahora vive aqui:
    ese archivo ya no hace falta y no debe correrse despues de este seed.

  @author Stephanie Elizdeth Hernández Prieto
  @author Camila Mariné Crespo Zurita
  @author Citlaly Morales Viveros
  @author Alfonso Mendoza Vasquez
  @author Jetzaly Josmery Tello Campos
  @author Dana Carmona Santamaria (Equipo Gamma, datos extra de Alfa y CFD, 15 nov 2026)
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuarios (sin rol). Las contraseñas se generan directamente con Bcrypt usando la extensión pgcrypto.
INSERT INTO usuarios (nombre, correo, password_hash, acepto_privacidad_en)
SELECT v.nombre, v.correo, crypt('Scrum2026!', gen_salt('bf', 10)), NOW()
FROM (VALUES
  ('Stephy Hernández',   'stephanieehpr@gmail.com'),
  ('Citlaly Morales',    'citlipop@gmail.com'),
  ('Dana Carmona',       'dana044car@gmail.com'),
  ('Diego Jimenez',      'diegotrujano3c@gmail.com'),
  ('Alfonso Mendoza',    'mendozavas615@gmail.com'),
  ('Camila Crespo',      'camcrezu@gmail.com'),
  ('Jetzaly Tello',      'jetzaly2006@gmail.com'),
  ('Juan Pablo Loya Alonso','jploya2006@gmail.com')
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
  ('Equipo Alfa', 'stephanieehpr@gmail.com'),
  ('Equipo Beta', 'dana044car@gmail.com'),
  ('Equipo Gamma', 'stephanieehpr@gmail.com')
) AS e(nombre, correo)
JOIN usuarios u ON u.correo = e.correo
ON CONFLICT DO NOTHING;

-- Miembros de cada equipo
INSERT INTO miembros_equipo (equipo_id, usuario_id)
SELECT e.id, u.id
FROM (VALUES
  ('Equipo Alfa', 'stephanieehpr@gmail.com'),
  ('Equipo Alfa', 'citlipop@gmail.com'),
  ('Equipo Alfa', 'dana044car@gmail.com'),
  ('Equipo Alfa', 'diegotrujano3c@gmail.com'),
  ('Equipo Alfa', 'mendozavas615@gmail.com'),
  
  ('Equipo Beta', 'dana044car@gmail.com'),
  ('Equipo Beta', 'diegotrujano3c@gmail.com'),
  ('Equipo Beta', 'stephanieehpr@gmail.com'),
  ('Equipo Beta', 'citlipop@gmail.com'),

  ('Equipo Gamma', 'stephanieehpr@gmail.com'),
  ('Equipo Gamma', 'citlipop@gmail.com'),
  ('Equipo Gamma', 'dana044car@gmail.com'),
  ('Equipo Gamma', 'diegotrujano3c@gmail.com')
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
  ('Proyecto Demo Alfa', 'stephanieehpr@gmail.com',  'scrum_master'),
  ('Proyecto Demo Alfa', 'citlipop@gmail.com',     'product_owner'),
  ('Proyecto Demo Alfa', 'dana044car@gmail.com',     'developer'),
  ('Proyecto Demo Alfa', 'diegotrujano3c@gmail.com', 'developer'),
  ('Proyecto Demo Alfa', 'mendozavas615@gmail.com',  'developer'),
  
  ('Proyecto Demo Beta', 'dana044car@gmail.com',     'scrum_master'),
  ('Proyecto Demo Beta', 'diegotrujano3c@gmail.com', 'product_owner'),
  ('Proyecto Demo Beta', 'stephanieehpr@gmail.com',  'developer'),
  ('Proyecto Demo Beta', 'citlipop@gmail.com',     'developer'),

  ('Proyecto Demo Gamma', 'stephanieehpr@gmail.com',  'scrum_master'),
  ('Proyecto Demo Gamma', 'citlipop@gmail.com',     'product_owner'),
  ('Proyecto Demo Gamma', 'dana044car@gmail.com',     'developer'),
  ('Proyecto Demo Gamma', 'diegotrujano3c@gmail.com', 'developer')
) AS r(proyecto, correo, rol)
JOIN proyectos p ON p.nombre = r.proyecto
JOIN usuarios u  ON u.correo = r.correo
ON CONFLICT DO NOTHING;

-- Columnas por defecto del tablero
-- Mismos valores que migraciones/columnas_tablero_predeterminadas.sql (limites WIP: 5 y 3). Si cambias uno, cambia el otro.
INSERT INTO columnas_tablero (proyecto_id, nombre, orden, limite_wip, es_final)
SELECT p.id, c.nombre, c.orden, c.limite_wip, c.es_final
FROM proyectos p
CROSS JOIN (VALUES
  ('Por empezar',  1, 5,    FALSE),
  ('En progreso',  2, 3,    FALSE),
  ('En revisión',  3, NULL::INTEGER, FALSE),
  ('Terminado',    4, NULL::INTEGER, TRUE)
) AS c(nombre, orden, limite_wip, es_final)
ON CONFLICT DO NOTHING;

-- Un sprint planificado para el Proyecto Demo Alfa
INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas)
SELECT p.id, 'Sprint 1', 'Primer sprint de ejemplo', CURRENT_DATE, CURRENT_DATE + 6, 90
FROM proyectos p
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = p.id);

-- Cuatro historias de ejemplo en el backlog del Proyecto Demo Alfa (las crea su Product Owner: Citlaly)
INSERT INTO historias (proyecto_id, numero_hu, titulo, como, quiero, para, criterios, puntos, orden, creada_por)
SELECT p.id, h.orden, h.titulo, h.como, h.quiero, h.para,
       h.criterios, h.puntos, h.orden,
       (SELECT id FROM usuarios WHERE correo = 'citlipop@gmail.com')
FROM proyectos p
CROSS JOIN (VALUES
  ('Iniciar sesion',     'usuario',        'iniciar sesion con mi correo',        'acceder a mis proyectos',       'Con credenciales validas entro al dashboard', 3, 1),
  ('Ver mis proyectos',  'usuario',        'ver la lista de mis proyectos',     'elegir en cual trabajar',       'Solo veo proyectos de mis equipos',         5, 2),
  ('Crear una historia', 'product owner',  'crear historias de usuario',        'mantener el backlog',           'La historia aparece al final del backlog',    5, 3),
  ('Mover tarjetas',     'desarrollador',  'mover tarjetas entre columnas',     'reflejar mi avance',            'Los demas ven el cambio sin recargar',        8, 4)
) AS h(titulo, como, quiero, para, criterios, puntos, orden)
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM historias x WHERE x.proyecto_id = p.id);

-- DATOS DE PRUEBA DEL TABLERO - en "Proyecto Demo Alfa", el que abre el tablero por defecto
DO $$
DECLARE
  v_proyecto_nombre CONSTANT TEXT := 'Proyecto Demo Alfa';
  v_sprint_nombre   CONSTANT TEXT := 'Sprint 0';

  v_proy     INTEGER;
  v_sprint   INTEGER;
  v_po       INTEGER;
  v_columnas INTEGER;
BEGIN
  -- ---------------------------------------------------------------- Comprobaciones
  SELECT id INTO v_proy FROM proyectos WHERE nombre = v_proyecto_nombre;
  IF v_proy IS NULL THEN
    RAISE NOTICE 'No existe "%"; no se cargan los datos del tablero.', v_proyecto_nombre;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM sprints WHERE proyecto_id = v_proy AND nombre = v_sprint_nombre) THEN
    RAISE NOTICE 'Los datos del tablero ya estaban cargados en "%". No se hizo nada.', v_proyecto_nombre;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM sprints WHERE proyecto_id = v_proy AND estado = 'activo') THEN
    RAISE NOTICE '"%" ya tiene otro sprint activo; no se cargan los datos del tablero.', v_proyecto_nombre;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_columnas FROM columnas_tablero
   WHERE proyecto_id = v_proy AND nombre IN ('Por empezar', 'En progreso', 'En revisión', 'Terminado');
  IF v_columnas < 4 THEN
    RAISE NOTICE 'Faltan columnas por defecto en "%"; no se cargan los datos del tablero.', v_proyecto_nombre;
    RETURN;
  END IF;

  SELECT u.id INTO v_po FROM usuarios u WHERE u.correo = 'citlipop@gmail.com';
  IF v_po IS NULL THEN
    RAISE NOTICE 'Faltan los usuarios del seed; no se cargan los datos del tablero.';
    RETURN;
  END IF;

  -- ---------------------------------------------------------------- Usuario dado de baja (para "Usuario inactivo")
  INSERT INTO usuarios (nombre, correo, password_hash, activo)
  VALUES ('Marco Reyes (baja)', 'marco.reyes.baja@example.com', NULL, FALSE)
  ON CONFLICT DO NOTHING;

  -- Los limites WIP ya vienen del INSERT de columnas por defecto (5 y 3); aqui no se redefinen.

  -- ---------------------------------------------------------------- Epicas
  INSERT INTO epicas (proyecto_id, nombre, color) VALUES
    (v_proy, 'Acceso y cuentas',       '#0EA5E9'),
    (v_proy, 'Tablero Kanban',         '#4F46E5'),
    (v_proy, 'Seguimiento de horas',   '#F59E0B')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------- Sprint activo
  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proy, v_sprint_nombre, 'Datos de ejemplo para probar el tablero Kanban',
          CURRENT_DATE - 4, CURRENT_DATE + 2, 90, 'activo')
  RETURNING id INTO v_sprint;

  -- ---------------------------------------------------------------- Historias
INSERT INTO historias (proyecto_id, numero_hu, epica_id, sprint_id, titulo, como, quiero, para, criterios, puntos, etiquetas, estado, orden, creada_por)
SELECT v_proy, (SELECT COALESCE(MAX(x.numero_hu), 0) FROM historias x WHERE x.proyecto_id = v_proy) + h.orden, e.id, v_sprint, h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.etiquetas, h.estado, 
  (SELECT COALESCE(MAX(x.orden), 0) FROM historias x WHERE x.proyecto_id = v_proy) + h.orden, v_po
  FROM (VALUES
    ('Inicio de sesion seguro',                 'Acceso y cuentas',    'usuario',       'iniciar sesion con mi correo',                            'acceder al sistema',                          'Con credenciales validas entro al dashboard',                            3, ARRAY['auth'],         'hecho',     1),
    ('Tablero con columnas configurables','Tablero Kanban',       'desarrollador', 'un tablero del sprint activo con columnas',                'ver el avance del trabajo',                   'El tablero carga en menos de 2 segundos con las columnas correspondientes', 8, ARRAY['tablero'],      'en_sprint', 2),
    ('Informacion en la tarjeta',       'Tablero Kanban',       'desarrollador', 'ver los datos clave en cada tarjeta',                      'entender la tarea sin abrirla',               'La tarjeta muestra titulo, responsable, horas, puntos y etiquetas',       5, ARRAY['tablero'],      'en_sprint', 3),
    ('Mover tarjetas en tiempo real',    'Tablero Kanban',       'desarrollador', 'mover tarjetas arrastrandolas',                            'que el equipo vea el avance al instante',     'Los demas usuarios ven el movimiento en menos de 1 segundo',              8, ARRAY['tiempo-real'],  'en_sprint', 4),
    ('Registrar horas reales',           'Seguimiento de horas', 'desarrollador', 'registrar las horas que dedico a cada tarea',             'comparar lo real contra lo estimado',         'Las horas registradas aparecen sumadas en la tarjeta',                    3, ARRAY['horas'],        'en_sprint', 5)
  ) AS h(titulo, epica, como, quiero, para, criterios, puntos, etiquetas, estado, orden)
  JOIN epicas e ON e.proyecto_id = v_proy AND e.nombre = h.epica;

  -- ---------------------------------------------------------------- Tareas = tarjetas del tablero
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, descripcion, responsable_id, horas_estimadas, etiquetas, orden, bloqueada, motivo_bloqueo)
  SELECT hi.id, v_proy, v_sprint, c.id, d.titulo, d.descripcion, u.id, d.horas_est, d.etiquetas, d.orden, d.bloqueada, d.motivo
  FROM (VALUES
    ('Informacion en la tarjeta',   'Por empezar', 'Semaforo de desviacion de horas en la tarjeta',
        'Colorear las horas en verde, ambar o rojo segun la desviacion', NULL::TEXT, 3.0, ARRAY['frontend'], 1, FALSE, NULL::TEXT),
    ('Mover tarjetas en tiempo real','Por empezar', 'Reversion automatica de la tarjeta',
        'Si el servidor no responde, la tarjeta vuelve a su columna y se muestra un error', 'marco.reyes.baja@example.com', 4.0, ARRAY['frontend'], 2, FALSE, NULL),
    ('Mover tarjetas en tiempo real','Por empezar', 'Cola local de movimientos pendientes',
        'Marcar la tarjeta como pendiente de sincronizar y reenviar el movimiento al reconectar', 'diegotrujano3c@gmail.com', 3.0, ARRAY['frontend'], 3, FALSE, NULL),
    ('Registrar horas reales',       'Por empezar', 'Formulario de registro de horas',
        'Campo de fecha, horas y nota por tarea', 'dana044car@gmail.com', 2.5, ARRAY['frontend'], 4, FALSE, NULL),
    ('Tablero con columnas configurables','En progreso','Modal de personalizacion de columnas',
        'Agregar, renombrar y reordenar columnas desde el tablero', 'dana044car@gmail.com', 4.0, ARRAY['frontend'], 1, FALSE, NULL),
    ('Informacion en la tarjeta',   'En progreso', 'Badge de bloqueo con borde rosa y candado',
        'Resaltar las tarjetas bloqueadas', 'diegotrujano3c@gmail.com', 2.0, ARRAY['frontend'], 2, TRUE, 'Falta definir el icono de candado con el equipo de diseno'),
    ('Mover tarjetas en tiempo real','En progreso','Transmision por WebSockets',
        'Emitir el movimiento a los demas usuarios conectados al proyecto', 'diegotrujano3c@gmail.com', 5.0, ARRAY['backend'], 3, FALSE, NULL),
    ('Tablero con columnas configurables','En revisión','Endpoint PUT de columnas con validacion',
        'Rechazar nombres vacios o repetidos y columnas con tarjetas', 'diegotrujano3c@gmail.com', 5.0, ARRAY['backend'], 1, FALSE, NULL),
    ('Informacion en la tarjeta',   'En revisión', 'Componente compacto de tarjeta',
        'Titulo, responsable, puntos, etiquetas y horas', 'dana044car@gmail.com', 4.0, ARRAY['frontend'], 2, FALSE, NULL),
    ('Inicio de sesion seguro',              'Terminado',   'Maquetar formulario de inicio de sesion',
        'Correo, contrasena y mensajes de error', 'dana044car@gmail.com', 3.0, ARRAY['frontend'], 1, FALSE, NULL),
    ('Inicio de sesion seguro',              'Terminado',   'Validar credenciales con bcrypt',
        'Comparar el hash y devolver el token de sesion', 'diegotrujano3c@gmail.com', 4.0, ARRAY['backend'], 2, FALSE, NULL),
    ('Tablero con columnas configurables','Terminado', 'Maquetar layout responsivo de columnas',
        'Cuatro columnas que se adaptan a pantallas pequenas', 'dana044car@gmail.com', 3.0, ARRAY['frontend'], 3, FALSE, NULL),
    ('Tablero con columnas configurables','Terminado', 'Skeletons de carga y boton Reintentar',
        'Mostrar tarjetas de carga y un mensaje con reintento', 'dana044car@gmail.com', 2.0, ARRAY['frontend'], 4, FALSE, NULL),
    ('Mover tarjetas en tiempo real','Terminado',  'Modulo drag-and-drop entre columnas',
        'Arrastrar y soltar tarjetas entre columnas', 'dana044car@gmail.com', 4.0, ARRAY['frontend'], 5, FALSE, NULL)
  ) AS d(historia, columna, titulo, descripcion, responsable, horas_est, etiquetas, orden, bloqueada, motivo)
  JOIN historias hi   ON hi.sprint_id = v_sprint AND hi.titulo = d.historia
  JOIN columnas_tablero c  ON c.proyecto_id = v_proy AND c.nombre = d.columna
  LEFT JOIN usuarios u     ON u.correo = d.responsable;

  -- ---------------------------------------------------------------- Horas reales
  INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
  SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
  FROM (VALUES
    ('Maquetar formulario de inicio de sesion',       'dana044car@gmail.com', 4, 3.0, 'Formulario y estilos'),
    ('Modulo drag-and-drop entre columnas',           'dana044car@gmail.com', 4, 2.0, 'Eventos dragstart y drop'),
    ('Maquetar layout responsivo de columnas',        'dana044car@gmail.com', 3, 1.6, 'Grid de columnas'),
    ('Modulo drag-and-drop entre columnas',           'dana044car@gmail.com', 3, 2.0, 'Movimiento optimista'),
    ('Skeletons de carga y boton Reintentar',         'dana044car@gmail.com', 3, 1.5, 'Skeletons'),
    ('Maquetar layout responsivo de columnas',        'dana044car@gmail.com', 2, 2.0, 'Ajustes responsivos'),
    ('Skeletons de carga y boton Reintentar',         'dana044car@gmail.com', 2, 1.5, 'Mensaje de error'),
    ('Componente compacto de tarjeta',                'dana044car@gmail.com', 2, 2.0, 'Estructura de la tarjeta'),
    ('Modal de personalizacion de columnas',          'dana044car@gmail.com', 1, 2.0, 'Maqueta del modal'),
    ('Componente compacto de tarjeta',                'dana044car@gmail.com', 1, 3.0, 'Etiquetas y horas'),
    ('Modal de personalizacion de columnas',          'dana044car@gmail.com', 0, 2.8, 'Renombrar y reordenar'),
    ('Validar credenciales con bcrypt',               'diegotrujano3c@gmail.com',      4, 2.2, 'Servicio de autenticacion'),
    ('Endpoint PUT de columnas con validacion',       'diegotrujano3c@gmail.com',      4, 2.0, 'Ruta y controlador'),
    ('Validar credenciales con bcrypt',               'diegotrujano3c@gmail.com',      3, 2.0, 'Pruebas del login'),
    ('Endpoint PUT de columnas con validacion',       'diegotrujano3c@gmail.com',      3, 1.5, 'Validacion de nombres'),
    ('Endpoint PUT de columnas con validacion',       'diegotrujano3c@gmail.com',      2, 2.0, 'Regla de columnas'),
    ('Transmision por WebSockets',                    'diegotrujano3c@gmail.com',      2, 3.0, 'Salas por proyecto'),
    ('Badge de bloqueo con borde rosa y candado',     'diegotrujano3c@gmail.com',      1, 1.0, 'Estilo del borde'),
    ('Transmision por WebSockets',                    'diegotrujano3c@gmail.com',      1, 2.0, 'Evento tarjeta-movida'),
    ('Badge de bloqueo con borde rosa y candado',     'diegotrujano3c@gmail.com',      0, 1.6, 'Icono de candado'),
    ('Transmision por WebSockets',                    'diegotrujano3c@gmail.com',      0, 2.0, 'Pruebas con dos usuarios')
  ) AS r(titulo, correo, dias, horas, nota)
  JOIN tareas t   ON t.sprint_id = v_sprint AND t.titulo = r.titulo
  JOIN usuarios u ON u.correo = r.correo;

  -- ---------------------------------------------------------------- Checklist y Comentarios
  INSERT INTO checklist_items (tarea_id, texto, hecho, orden)
  SELECT t.id, c.texto, c.hecho, c.orden
  FROM (VALUES
    ('Modal de personalizacion de columnas', 'Agregar columna',    TRUE,  1),
    ('Modal de personalizacion de columnas', 'Renombrar columna',  TRUE,  2),
    ('Modal de personalizacion de columnas', 'Reordenar columnas', FALSE, 3),
    ('Componente compacto de tarjeta',       'Titulo y responsable', TRUE, 1),
    ('Componente compacto de tarjeta',       'Etiquetas y puntos',   TRUE, 2),
    ('Componente compacto de tarjeta',       'Texto completo al pasar el cursor', TRUE, 3)
  ) AS c(titulo, texto, hecho, orden)
  JOIN tareas t ON t.sprint_id = v_sprint AND t.titulo = c.titulo;

  INSERT INTO comentarios (tarea_id, usuario_id, texto)
  SELECT t.id, u.id, c.texto
  FROM (VALUES
    ('Badge de bloqueo con borde rosa y candado',       'diegotrujano3c@gmail.com',     'Me quede esperando el icono de candado, lo dejo bloqueada hasta que diseno lo confirme.'),
    ('Badge de bloqueo con borde rosa y candado',       'stephanieehpr@gmail.com',   'Ya abri el impedimento para darle seguimiento en la daily.'),
    ('Componente compacto de tarjeta',                  'stephanieehpr@gmail.com',   'Revisa que el semaforo use los mismos colores.'),
    ('Transmision por WebSockets',                      'dana044car@gmail.com','Probe con dos ventanas y el cambio llega casi al instante.')
  ) AS c(titulo, correo, texto)
  JOIN tareas t   ON t.sprint_id = v_sprint AND t.titulo = c.titulo
  JOIN usuarios u ON u.correo = c.correo;

  -- ---------------------------------------------------------------- Impedimentos
  INSERT INTO impedimentos (proyecto_id, sprint_id, tarea_id, titulo, severidad, responsable_id, estado, creado_por)
  SELECT v_proy, v_sprint, t.id, 'Falta definir el icono de candado con el equipo de diseno', 'media',
    (SELECT id FROM usuarios WHERE correo = 'stephanieehpr@gmail.com'), 'abierto',
    (SELECT id FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com')
  FROM tareas t
  WHERE t.sprint_id = v_sprint AND t.titulo = 'Badge de bloqueo con borde rosa y candado';

  RAISE NOTICE 'Listo: sprint "%" con 5 historias y 14 tarjetas en "%" (id de proyecto = %).', v_sprint_nombre, v_proyecto_nombre, v_proy;
END $$;

-- DATOS DE METRICAS DEL PROYECTO DEMO GAMMA 
DO $$
DECLARE
  v_proyecto    INTEGER;
  v_po          INTEGER;
  v_dana        INTEGER;
  v_diego       INTEGER;
  v_c_porhacer  INTEGER;
  v_c_progreso  INTEGER;
  v_c_hecho     INTEGER;
  v_sprint      INTEGER;
  v_historia    INTEGER;
  v_i           INTEGER;
BEGIN
  SELECT id INTO v_proyecto FROM proyectos WHERE nombre = 'Proyecto Demo Gamma';
  IF v_proyecto IS NULL THEN
    RAISE NOTICE 'No existe Proyecto Demo Gamma: revisa los INSERT de equipos y proyectos de arriba.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM sprints WHERE proyecto_id = v_proyecto AND nombre LIKE 'Gamma Sprint %') THEN
    RAISE NOTICE 'Los datos de metricas de Demo Gamma ya estaban cargados. No se hizo nada.';
    RETURN;
  END IF;

  SELECT id INTO v_po    FROM usuarios WHERE correo = 'citlipop@gmail.com';
  SELECT id INTO v_dana  FROM usuarios WHERE correo = 'dana044car@gmail.com';
  SELECT id INTO v_diego FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com';

  SELECT id INTO v_c_porhacer FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'Por empezar';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proyecto AND nombre = 'En progreso';
  SELECT id INTO v_c_hecho    FROM columnas_tablero WHERE proyecto_id = v_proyecto AND es_final = TRUE;

  -- ---------------------------------------------------------------- 3 sprints cerrados (Velocity): 8, 16 y 20 pts
  FOR v_i IN 1..3 LOOP
    INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado, velocity, cerrado_en)
    VALUES (v_proyecto, 'Gamma Sprint ' || v_i, 'Sprint cerrado de ejemplo',
            CURRENT_DATE - (28 - (v_i - 1) * 7), CURRENT_DATE - (22 - (v_i - 1) * 7), 90, 'cerrado', NULL,
            NOW() - ((22 - (v_i - 1) * 7) || ' days')::interval)
    RETURNING id INTO v_sprint;

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

    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
            NULL, 'Gamma S' || v_i || ' historia rechazada', CASE v_i WHEN 1 THEN 5 WHEN 2 THEN 3 ELSE 5 END, 'rechazada', 102 + v_i * 10, v_po)
    RETURNING id INTO v_historia;
    INSERT INTO reviews_historias (sprint_id, historia_id, decision, comentario, decidido_por)
    VALUES (v_sprint, v_historia, 'rechazada', 'No cumple la definición de terminado', v_po);
  END LOOP;

  -- ---------------------------------------------------------------- 1 sprint activo con 12 tareas
  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proyecto, 'Gamma Sprint 4 (activo)', 'Sprint activo de ejemplo', CURRENT_DATE - 3, CURRENT_DATE + 4, 90, 'activo')
  RETURNING id INTO v_sprint;

  INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
  VALUES (v_proyecto, (SELECT COALESCE(MAX(numero_hu), 0) + 1 FROM historias WHERE proyecto_id = v_proyecto),
          v_sprint, 'Gamma S4 historia en curso', 8, 'en_sprint', 200, v_po)
  RETURNING id INTO v_historia;

  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, responsable_id, horas_estimadas, orden) VALUES
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: diseñar login',         v_dana,  4, 1),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: maquetar panel',        v_dana,  3, 2),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: crear endpoints',       v_diego, 5, 3),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: validaciones',          v_diego, 2, 4),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: conectar con la API',  v_dana,  4, 5),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: documentar API',        v_dana,  3, 6),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: pruebas unitarias',     v_diego, 5, 7),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: revisar diseño',        v_dana,  2, 8),
    (v_historia, v_proyecto, v_sprint, v_c_hecho,    'Gamma: preparar demo',         v_diego, 3, 9),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Gamma: migrar datos',          v_dana,  4, 10),
    (v_historia, v_proyecto, v_sprint, v_c_progreso, 'Gamma: optimizar consultas',   v_diego, 3, 11),
    (v_historia, v_proyecto, v_sprint, v_c_porhacer, 'Gamma: tarea sin responsable', NULL,    2, 12);

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

  RAISE NOTICE 'Listo: Proyecto Demo Gamma (id=%) con 3 sprints cerrados y 1 activo.', v_proyecto;
END $$;

-- TAREAS Y HORAS DE LOS SPRINTS CERRADOS DEL PROYECTO DEMO GAMMA
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

  -- Un solo INSERT con los dos pasos (Por hacer -> En progreso y En progreso -> Hecho)
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

-- DATOS ADICIONALES DEL PROYECTO DEMO ALFA
DO $$
DECLARE
  v_proy        INTEGER;
  v_sprint      INTEGER;
  v_historia    INTEGER;
  v_po          INTEGER;
  v_dana        INTEGER;
  v_diego       INTEGER;
  v_c_porhacer   INTEGER;
  v_c_progreso INTEGER;
  v_c_revision INTEGER;
  v_c_hecho       INTEGER;
  v_t           INTEGER;
BEGIN
  SELECT id INTO v_proy FROM proyectos WHERE nombre = 'Proyecto Demo Alfa';
  IF v_proy IS NULL THEN
    RAISE NOTICE 'No existe Proyecto Demo Alfa: no se cargan los datos adicionales.';
    RETURN;
  END IF;

  -- Sprint activo (o Sprint 0 si todavia no hay otro activo)
  SELECT id INTO v_sprint FROM sprints WHERE proyecto_id = v_proy AND estado = 'activo' ORDER BY fecha_inicio DESC LIMIT 1;
  IF v_sprint IS NULL THEN
    SELECT id INTO v_sprint FROM sprints WHERE proyecto_id = v_proy AND nombre = 'Sprint 0';
  END IF;
  IF v_sprint IS NULL THEN
    RAISE NOTICE 'Proyecto Demo Alfa no tiene sprint activo ni Sprint 0: no se cargan los datos adicionales.';
    RETURN;
  END IF;

  SELECT id INTO v_po    FROM usuarios WHERE correo = 'citlipop@gmail.com';
  SELECT id INTO v_dana  FROM usuarios WHERE correo = 'dana044car@gmail.com';
  SELECT id INTO v_diego FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com';

  -- Historia para las tareas extra (la del sprint activo si existe)
  SELECT id INTO v_historia FROM historias WHERE proyecto_id = v_proy AND titulo = 'Demo S4 historia en curso';
  IF v_historia IS NULL THEN
    SELECT id INTO v_historia FROM historias WHERE proyecto_id = v_proy ORDER BY id DESC LIMIT 1;
  END IF;
  IF v_historia IS NULL THEN
    INSERT INTO historias (proyecto_id, numero_hu, sprint_id, titulo, puntos, estado, orden, creada_por)
    VALUES (v_proy, 1, v_sprint, 'Alfa extra: mejoras del tablero', 5, 'en_sprint', 1, v_po)
    RETURNING id INTO v_historia;
  END IF;

  SELECT id INTO v_c_porhacer   FROM columnas_tablero WHERE proyecto_id = v_proy AND nombre = 'Por empezar';
  SELECT id INTO v_c_progreso FROM columnas_tablero WHERE proyecto_id = v_proy AND nombre = 'En progreso';
  SELECT id INTO v_c_revision FROM columnas_tablero WHERE proyecto_id = v_proy AND nombre = 'En revisión';
  SELECT id INTO v_c_hecho       FROM columnas_tablero WHERE proyecto_id = v_proy AND es_final = TRUE;

  -- ---------------------------------------------------------------- 6 tareas extra asignadas
  IF NOT EXISTS (SELECT 1 FROM tareas WHERE proyecto_id = v_proy AND titulo LIKE 'Alfa extra:%') THEN
    INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, descripcion, responsable_id, horas_estimadas, etiquetas, orden, bloqueada, motivo_bloqueo) VALUES
      (v_historia, v_proy, v_sprint, v_c_hecho,    'Alfa extra: endpoint de reportes',         'Endpoint para descargar el reporte de avance', v_diego, 5, ARRAY['backend'],  1, FALSE, NULL),
      (v_historia, v_proy, v_sprint, v_c_hecho,    'Alfa extra: filtros del tablero',          'Filtrar tarjetas por responsable y etiqueta',  v_dana,  4, ARRAY['frontend'], 2, FALSE, NULL),
      (v_historia, v_proy, v_sprint, v_c_progreso, 'Alfa extra: exportar a CSV',               'Exportar las tareas del sprint a CSV',        v_dana,  6, ARRAY['backend'],  3, FALSE, NULL),
      (v_historia, v_proy, v_sprint, v_c_progreso, 'Alfa extra: notificaciones en tiempo real','Avisar cuando alguien mueve una tarjeta',      v_diego, 5, ARRAY['backend'],  4, FALSE, NULL),
      (v_historia, v_proy, v_sprint, v_c_porhacer, 'Alfa extra: modo oscuro',                  'Tema oscuro para el tablero',                   v_dana,  3, ARRAY['frontend'], 5, FALSE, NULL),
      (v_historia, v_proy, v_sprint, v_c_porhacer, 'Alfa extra: pruebas de carga',             'Probar el tablero con 200 tarjetas',            NULL,   4, ARRAY['frontend'], 6, FALSE, NULL);

    INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
    SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
    FROM (VALUES
      ('Alfa extra: endpoint de reportes',         'diegotrujano3c@gmail.com', 1, 6.0, 'Endpoint y pruebas'),
      ('Alfa extra: filtros del tablero',          'dana044car@gmail.com',     1, 4.0, 'Filtros por responsable'),
      ('Alfa extra: exportar a CSV',               'dana044car@gmail.com',     0, 3.0, 'Avance parcial'),
      ('Alfa extra: notificaciones en tiempo real','diegotrujano3c@gmail.com', 0, 2.0, 'Avance parcial')
    ) AS r(titulo, correo, dias, horas, nota)
    JOIN tareas t   ON t.proyecto_id = v_proy AND t.titulo = r.titulo
    JOIN usuarios u ON u.correo = r.correo;
  END IF;

  -- Solo se insertan eventos si la tarjeta todavia no tiene ninguno.
  -- Tarjeta 1: 'Maquetar formulario de inicio de sesion' (hoy en Hecho)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Maquetar formulario de inicio de sesion';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 10) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 8) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_hecho),       ((CURRENT_DATE - 3) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 2: 'Modulo drag-and-drop entre columnas' (hoy en Hecho)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Modulo drag-and-drop entre columnas';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 9) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 6) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_hecho),       ((CURRENT_DATE - 2) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 3: 'Validar credenciales con bcrypt' (hoy en Hecho, paso por revision)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Validar credenciales con bcrypt';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 9) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 5) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_revision), ((CURRENT_DATE - 4) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_revision, 'nueva', v_c_hecho),       ((CURRENT_DATE - 1) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 4: 'Maquetar layout responsivo de columnas' (hoy en Hecho)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Maquetar layout responsivo de columnas';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 10) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 7) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_hecho),       ((CURRENT_DATE - 5) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 5: 'Modal de personalizacion de columnas' (hoy en En progreso)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Modal de personalizacion de columnas';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 7) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer, 'nueva', v_c_progreso), ((CURRENT_DATE - 4) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 6: 'Componente compacto de tarjeta' (hoy en En revision)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Componente compacto de tarjeta';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 6) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 3) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_revision), ((CURRENT_DATE - 1) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 7: 'Endpoint PUT de columnas con validacion' (hoy en En revision)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Endpoint PUT de columnas con validacion';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 8) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer, 'nueva', v_c_revision), ((CURRENT_DATE - 2) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 8: 'Semaforo de desviacion de horas en la tarjeta' (hoy en Por hacer, sin movimientos)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Semaforo de desviacion de horas en la tarjeta';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 5) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
  END IF;

  -- Tarjeta 9: 'Alfa extra: endpoint de reportes' (hoy en Hecho)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: endpoint de reportes';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 9) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 6) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_hecho),       ((CURRENT_DATE - 2) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 10: 'Alfa extra: filtros del tablero' (hoy en Hecho)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: filtros del tablero';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 8) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer,   'nueva', v_c_progreso), ((CURRENT_DATE - 5) || ' 12:00:00+00')::timestamptz),
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_progreso, 'nueva', v_c_hecho),       ((CURRENT_DATE - 1) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 11: 'Alfa extra: exportar a CSV' (hoy en En progreso)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: exportar a CSV';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 7) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer, 'nueva', v_c_progreso), ((CURRENT_DATE - 3) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 12: 'Alfa extra: notificaciones en tiempo real' (hoy en En progreso)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: notificaciones en tiempo real';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 6) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
    INSERT INTO historial_tareas (tarea_id, usuario_id, accion, detalle, creado_en) VALUES
      (v_t, v_dana, 'columna_cambiada', jsonb_build_object('anterior', v_c_porhacer, 'nueva', v_c_progreso), ((CURRENT_DATE - 2) || ' 12:00:00+00')::timestamptz);
  END IF;

  -- Tarjeta 13: 'Alfa extra: modo oscuro' (hoy en Por hacer, sin movimientos)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: modo oscuro';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 4) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
  END IF;

  -- Tarjeta 14: 'Alfa extra: pruebas de carga' (hoy en Por hacer, sin movimientos)
  SELECT id INTO v_t FROM tareas WHERE proyecto_id = v_proy AND titulo = 'Alfa extra: pruebas de carga';
  IF v_t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM historial_tareas WHERE tarea_id = v_t AND accion = 'columna_cambiada') THEN
    UPDATE tareas SET creado_en = ((CURRENT_DATE - 3) || ' 12:00:00+00')::timestamptz WHERE id = v_t;
  END IF;

  RAISE NOTICE 'Listo: datos adicionales de Proyecto Demo Alfa (id=%): 6 tareas extra y historia del CFD para 14 tarjetas.', v_proy;
END $$;

------------------------------------------------------------- sincronizar el contador de historias por proyecto. GREATEST evita disminuir un contador que ya era mayor.
UPDATE proyectos p
SET ultimo_numero_hu = GREATEST(
    p.ultimo_numero_hu,
    COALESCE((
        SELECT MAX(h.numero_hu)
        FROM historias h
        WHERE h.proyecto_id = p.id
    ), 0)
);