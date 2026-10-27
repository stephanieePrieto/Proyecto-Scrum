-- BASE (no modificar sin avisar al equipo) - HU-47: datos de prueba con el equipo ListiVerse
-- Ejecutar DESPUES de schema.sql. Es seguro correrlo varias veces: no duplica los datos.
--
-- Todos los usuarios son "base": ninguno tiene rol global. El rol existe solo DENTRO de un proyecto.
-- Contrasena de todos:  Scrum2026!   (correos personalizados)
--   Proyecto Demo Alfa: Stephy = Scrum Master, Citlaly = Product Owner, Dana / Diego = Developers
--   Proyecto Demo Beta: Dana = Scrum Master, Diego = Product Owner, Stephy / Citlaly = Developers
--   Al final: datos de prueba del Tablero (HU-17 a HU-23) en Proyecto Demo Alfa (el proyecto que abre el tablero por defecto), con su sprint activo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Usuarios (sin rol). Los hashes bcrypt se migran solos a Argon2id en el primer inicio de sesion.
INSERT INTO usuarios (nombre, correo, password_hash, acepto_privacidad_en)
SELECT v.nombre, v.correo, crypt('Scrum2026!', gen_salt('bf', 10)), NOW()
FROM (VALUES
  ('Stephy Hernández',  'stephanieehpr@gmail.com'),
  ('Citlaly Morales',   'citlipop@gmail.com'),
  ('Dana Carmona',      'dana044car@gmail.com'),
  ('Diego Jimenez',     'diegotrujano3c@gmail.com'),
  ('Alfonso Mendoza',   'mendozavas615@gmail.com'),
  ('Camila Crespo',     'camcrezu@gmail.com'),
  ('Jetzaly Tello',     'jetzaly2006@gmail.com'),
  ('Juan Pablo Loya Alonso','jploya2006@gmail.com'),
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
  ('Equipo Beta', 'dana044car@gmail.com')
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
  ('Equipo Beta', 'citlipop@gmail.com')
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
  ('Proyecto Demo Beta', 'citlipop@gmail.com',     'developer')
) AS r(proyecto, correo, rol)
JOIN proyectos p ON p.nombre = r.proyecto
JOIN usuarios u  ON u.correo = r.correo
ON CONFLICT DO NOTHING;

-- Columnas por defecto del tablero
INSERT INTO columnas_tablero (proyecto_id, nombre, orden, es_final)
SELECT p.id, c.nombre, c.orden, c.es_final
FROM proyectos p
CROSS JOIN (VALUES
  ('Por hacer',    1, FALSE),
  ('En progreso',  2, FALSE),
  ('En revision',  3, FALSE),
  ('Hecho',        4, TRUE)
) AS c(nombre, orden, es_final)
ON CONFLICT DO NOTHING;

-- Un sprint planificado para el Proyecto Demo Alfa
INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas)
SELECT p.id, 'Sprint 1', 'Primer sprint de ejemplo', CURRENT_DATE, CURRENT_DATE + 6, 90
FROM proyectos p
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM sprints s WHERE s.proyecto_id = p.id);

-- Cuatro historias de ejemplo en el backlog del Proyecto Demo Alfa (las crea su Product Owner: Citlaly)
INSERT INTO historias (proyecto_id, titulo, como, quiero, para, criterios, puntos, orden, creada_por)
SELECT p.id, h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.orden,
       (SELECT id FROM usuarios WHERE correo = 'citlipop@gmail.com')
FROM proyectos p
CROSS JOIN (VALUES
  ('Iniciar sesion',     'usuario',        'iniciar sesion con mi correo',        'acceder a mis proyectos',      'Con credenciales validas entro al dashboard', 3, 1),
  ('Ver mis proyectos',  'usuario',        'ver la lista de mis proyectos',     'elegir en cual trabajar',      'Solo veo proyectos de mis equipos',         5, 2),
  ('Crear una historia', 'product owner',  'crear historias de usuario',        'mantener el backlog',          'La historia aparece al final del backlog',    5, 3),
  ('Mover tarjetas',     'desarrollador',  'mover tarjetas entre columnas',     'reflejar mi avance',           'Los demas ven el cambio sin recargar',        8, 4)
) AS h(titulo, como, quiero, para, criterios, puntos, orden)
WHERE p.nombre = 'Proyecto Demo Alfa'
  AND NOT EXISTS (SELECT 1 FROM historias x WHERE x.proyecto_id = p.id);

-- DATOS DE PRUEBA DEL TABLERO (HU-17 a HU-23) - en "Proyecto Demo Alfa", el que abre el tablero por defecto
-- Solo AGREGA datos: el "Sprint 1" planificado y las 4 historias del backlog de Alfa quedan como estaban.
-- Crea un "Sprint 0" ACTIVO (el tablero solo muestra el sprint activo) con sus propias historias y tarjetas.
-- Usa solo los usuarios y roles de arriba (Citlaly = PO crea las historias; Dana y Diego, developers, son los responsables;
-- Stephy = SM comenta y atiende el impedimento) y agrega un usuario INACTIVO de prueba (sin contrasena, fuera de todo
-- equipo) para el caso "Usuario inactivo".

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
   WHERE proyecto_id = v_proy AND nombre IN ('Por hacer', 'En progreso', 'En revision', 'Hecho');
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

  -- ---------------------------------------------------------------- Limites WIP (solo donde no hay limite)
  UPDATE columnas_tablero SET limite_wip = 3 WHERE proyecto_id = v_proy AND nombre = 'En progreso' AND limite_wip IS NULL;
  UPDATE columnas_tablero SET limite_wip = 2 WHERE proyecto_id = v_proy AND nombre = 'En revision' AND limite_wip IS NULL;

  -- ---------------------------------------------------------------- Epicas (para el filtro por epica)
  INSERT INTO epicas (proyecto_id, nombre, color) VALUES
    (v_proy, 'Acceso y cuentas',      '#0EA5E9'),
    (v_proy, 'Tablero Kanban',        '#4F46E5'),
    (v_proy, 'Seguimiento de horas',  '#F59E0B')
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------- Sprint activo (7 dias, termina en 2 dias)
  INSERT INTO sprints (proyecto_id, nombre, objetivo, fecha_inicio, fecha_fin, capacidad_horas, estado)
  VALUES (v_proy, v_sprint_nombre, 'Datos de ejemplo para probar el tablero Kanban',
          CURRENT_DATE - 4, CURRENT_DATE + 2, 90, 'activo')
  RETURNING id INTO v_sprint;

  -- ---------------------------------------------------------------- Historias (las crea el PO de Alfa: Citlaly)
  INSERT INTO historias (proyecto_id, epica_id, sprint_id, titulo, como, quiero, para, criterios, puntos, etiquetas, estado, orden, creada_por)
  SELECT v_proy, e.id, v_sprint, h.titulo, h.como, h.quiero, h.para, h.criterios, h.puntos, h.etiquetas, h.estado,
         (SELECT COALESCE(MAX(x.orden), 0) FROM historias x WHERE x.proyecto_id = v_proy) + h.orden, v_po  -- sigue la numeracion del backlog existente
  FROM (VALUES
    ('Inicio de sesion seguro',                   'Acceso y cuentas',     'usuario',       'iniciar sesion con mi correo',                         'acceder a mis proyectos',                      'Con credenciales validas entro al dashboard',                                                   3, ARRAY['auth'],              'hecho',     1),
    ('Tablero con columnas configurables','Tablero Kanban',       'desarrollador', 'un tablero del sprint activo con columnas',            'ver el avance del trabajo',                    'El tablero carga en menos de 2 segundos con las columnas Por hacer, En progreso, En revision y Hecho', 8, ARRAY['tablero'],           'en_sprint', 2),
    ('Informacion en la tarjeta',        'Tablero Kanban',       'desarrollador', 'ver los datos clave en cada tarjeta',                  'entender la tarea sin abrirla',                'La tarjeta muestra titulo, responsable, horas, puntos, etiquetas e indicador de bloqueo',       5, ARRAY['tablero'],           'en_sprint', 3),
    ('Mover tarjetas en tiempo real',    'Tablero Kanban',       'desarrollador', 'mover tarjetas arrastrandolas',                        'que el equipo vea el avance al instante',      'Los demas usuarios ven el movimiento en menos de 1 segundo',                                    8, ARRAY['tablero','tiempo-real'], 'en_sprint', 4),
    ('Registrar horas reales',           'Seguimiento de horas', 'desarrollador', 'registrar las horas que dedico a cada tarea',          'comparar lo real contra lo estimado',          'Las horas registradas aparecen sumadas en la tarjeta',                                          3, ARRAY['horas'],             'en_sprint', 5)
  ) AS h(titulo, epica, como, quiero, para, criterios, puntos, etiquetas, estado, orden)
  JOIN epicas e ON e.proyecto_id = v_proy AND e.nombre = h.epica;

  -- ---------------------------------------------------------------- Tareas = tarjetas del tablero
  INSERT INTO tareas (historia_id, proyecto_id, sprint_id, columna_id, titulo, descripcion, responsable_id, horas_estimadas, etiquetas, orden, bloqueada, motivo_bloqueo)
  SELECT hi.id, v_proy, v_sprint, c.id, d.titulo, d.descripcion, u.id, d.horas_est, d.etiquetas, d.orden, d.bloqueada, d.motivo
  FROM (VALUES
    -- Por hacer: sin responsable / responsable inactivo + titulo largo / sin horas reales
    ('Informacion en la tarjeta',   'Por hacer',   'Semaforo de desviacion de horas en la tarjeta',
       'Colorear las horas en verde, ambar o rojo segun la desviacion',                                    NULL::TEXT,                           3.0, ARRAY['frontend'],             1, FALSE, NULL::TEXT),
    ('Mover tarjetas en tiempo real','Por hacer',  'Reversion automatica de la tarjeta a su columna original cuando el servidor rechaza el movimiento o se pierde la conexion de red durante el arrastre',
       'Si el servidor no responde, la tarjeta vuelve a su columna y se muestra un error',                 'marco.reyes.baja@example.com',       4.0, ARRAY['frontend','backend'],   2, FALSE, NULL),
    ('Mover tarjetas en tiempo real','Por hacer',  'Cola local de movimientos pendientes',
       'Marcar la tarjeta como pendiente de sincronizar y reenviar el movimiento al reconectar',           'diegotrujano3c@gmail.com',                 3.0, ARRAY['frontend'],             3, FALSE, NULL),
    ('Registrar horas reales',      'Por hacer',   'Formulario de registro de horas',
       'Campo de fecha, horas y nota por tarea',                                                           'dana044car@gmail.com',            2.5, ARRAY['frontend'],             4, FALSE, NULL),
    -- En progreso (limite WIP 3: justo al limite, un movimiento mas dispara la alerta)
    ('Tablero con columnas configurables','En progreso','Modal de personalizacion de columnas',
       'Agregar, renombrar y reordenar columnas desde el tablero',                                         'dana044car@gmail.com',            4.0, ARRAY['frontend'],             1, FALSE, NULL),
    ('Informacion en la tarjeta',   'En progreso', 'Badge de bloqueo con borde rosa y candado',
       'Resaltar las tarjetas bloqueadas',                                                                 'diegotrujano3c@gmail.com',                 2.0, ARRAY['frontend'],             2, TRUE,  'Falta definir el icono de candado con el equipo de diseno'),
    ('Mover tarjetas en tiempo real','En progreso','Transmision por WebSockets en menos de 1 segundo',
       'Emitir el movimiento a los demas usuarios conectados al proyecto',                                 'diegotrujano3c@gmail.com',                 5.0, ARRAY['backend'],              3, FALSE, NULL),
    -- En revision (limite WIP 2: justo al limite)
    ('Tablero con columnas configurables','En revision','Endpoint PUT de columnas con validacion de nombres',
       'Rechazar nombres vacios o repetidos y columnas con tarjetas',                                      'diegotrujano3c@gmail.com',                 5.0, ARRAY['backend'],              1, FALSE, NULL),
    ('Informacion en la tarjeta',   'En revision', 'Componente compacto de tarjeta',
       'Titulo, responsable, puntos, etiquetas y horas en una tarjeta compacta',                           'dana044car@gmail.com',            4.0, ARRAY['frontend'],             2, FALSE, NULL),
    -- Hecho
    ('Inicio de sesion seguro',              'Hecho',       'Maquetar formulario de inicio de sesion',
       'Correo, contrasena y mensajes de error',                                                           'dana044car@gmail.com',            3.0, ARRAY['frontend'],             1, FALSE, NULL),
    ('Inicio de sesion seguro',              'Hecho',       'Validar credenciales con bcrypt',
       'Comparar el hash y devolver el token de sesion',                                                   'diegotrujano3c@gmail.com',                 4.0, ARRAY['backend'],              2, FALSE, NULL),
    ('Tablero con columnas configurables','Hecho', 'Maquetar layout responsivo de columnas',
       'Cuatro columnas que se adaptan a pantallas pequenas',                                              'dana044car@gmail.com',            3.0, ARRAY['frontend'],             3, FALSE, NULL),
    ('Tablero con columnas configurables','Hecho', 'Skeletons de carga y boton Reintentar',
       'Mostrar tarjetas de carga y un mensaje con reintento si falla la carga',                           'dana044car@gmail.com',            2.0, ARRAY['frontend'],             4, FALSE, NULL),
    ('Mover tarjetas en tiempo real','Hecho',      'Modulo drag-and-drop entre columnas',
       'Arrastrar y soltar tarjetas entre columnas',                                                       'dana044car@gmail.com',            4.0, ARRAY['frontend'],             5, FALSE, NULL)
  ) AS d(historia, columna, titulo, descripcion, responsable, horas_est, etiquetas, orden, bloqueada, motivo)
  JOIN historias hi        ON hi.sprint_id = v_sprint AND hi.titulo = d.historia
  JOIN columnas_tablero c  ON c.proyecto_id = v_proy AND c.nombre = d.columna
  LEFT JOIN usuarios u     ON u.correo = d.responsable;

  -- ---------------------------------------------------------------- Horas reales (semaforo HU-28: verde <=10%, ambar 10-25%, rojo >25%)
  -- Ninguna persona pasa de 6 h por dia (la capacidad por defecto de seed.sql).
  --   Iniciar sesion / formulario        3.0 de 3.0   =   0%  verde
  --   Validar credenciales               4.2 de 4.0   =   5%  verde
  --   Maquetar layout                    3.6 de 3.0   =  20%  ambar
  --   Endpoint PUT de columnas           5.5 de 5.0   =  10%  verde (limite exacto)
  --   Modal de personalizacion           4.8 de 4.0   =  20%  ambar
  --   Skeletons                          3.0 de 2.0   =  50%  rojo
  --   Componente compacto de tarjeta     5.0 de 4.0   =  25%  ambar (limite exacto)
  --   Badge de bloqueo                   2.6 de 2.0   =  30%  rojo (y bloqueada)
  --   Drag-and-drop                      4.0 de 4.0   =   0%  verde
  --   WebSockets                         7.0 de 5.0   =  40%  rojo
  --   Semaforo, Reversion, Cola, Formulario: sin horas -> la tarjeta debe mostrar "—" y no "0"
  INSERT INTO registros_horas (tarea_id, usuario_id, fecha, horas, nota)
  SELECT t.id, u.id, CURRENT_DATE - r.dias, r.horas, r.nota
  FROM (VALUES
    ('Maquetar formulario de inicio de sesion',       'dana044car@gmail.com', 4, 3.0, 'Formulario y estilos'),
    ('Modulo drag-and-drop entre columnas',           'dana044car@gmail.com', 4, 2.0, 'Eventos dragstart y drop'),
    ('Maquetar layout responsivo de columnas',        'dana044car@gmail.com', 3, 1.6, 'Grid de columnas'),
    ('Modulo drag-and-drop entre columnas',           'dana044car@gmail.com', 3, 2.0, 'Movimiento optimista y reversion'),
    ('Skeletons de carga y boton Reintentar',         'dana044car@gmail.com', 3, 1.5, 'Skeletons'),
    ('Maquetar layout responsivo de columnas',        'dana044car@gmail.com', 2, 2.0, 'Ajustes responsivos'),
    ('Skeletons de carga y boton Reintentar',         'dana044car@gmail.com', 2, 1.5, 'Mensaje de error y reintento'),
    ('Componente compacto de tarjeta',                'dana044car@gmail.com', 2, 2.0, 'Estructura de la tarjeta'),
    ('Modal de personalizacion de columnas',          'dana044car@gmail.com', 1, 2.0, 'Maqueta del modal'),
    ('Componente compacto de tarjeta',                'dana044car@gmail.com', 1, 3.0, 'Etiquetas, horas y responsable'),
    ('Modal de personalizacion de columnas',          'dana044car@gmail.com', 0, 2.8, 'Renombrar y reordenar'),
    ('Validar credenciales con bcrypt',               'diegotrujano3c@gmail.com',      4, 2.2, 'Servicio de autenticacion'),
    ('Endpoint PUT de columnas con validacion de nombres','diegotrujano3c@gmail.com',  4, 2.0, 'Ruta y controlador'),
    ('Validar credenciales con bcrypt',               'diegotrujano3c@gmail.com',      3, 2.0, 'Pruebas del login'),
    ('Endpoint PUT de columnas con validacion de nombres','diegotrujano3c@gmail.com',  3, 1.5, 'Validacion de nombres'),
    ('Endpoint PUT de columnas con validacion de nombres','diegotrujano3c@gmail.com',  2, 2.0, 'Regla de columnas con tarjetas'),
    ('Transmision por WebSockets en menos de 1 segundo','diegotrujano3c@gmail.com',    2, 3.0, 'Salas por proyecto'),
    ('Badge de bloqueo con borde rosa y candado',     'diegotrujano3c@gmail.com',      1, 1.0, 'Estilo del borde'),
    ('Transmision por WebSockets en menos de 1 segundo','diegotrujano3c@gmail.com',    1, 2.0, 'Evento tarjeta-movida'),
    ('Badge de bloqueo con borde rosa y candado',     'diegotrujano3c@gmail.com',      0, 1.6, 'Icono de candado'),
    ('Transmision por WebSockets en menos de 1 segundo','diegotrujano3c@gmail.com',    0, 2.0, 'Pruebas con dos usuarios')
  ) AS r(titulo, correo, dias, horas, nota)
  JOIN tareas t   ON t.sprint_id = v_sprint AND t.titulo = r.titulo
  JOIN usuarios u ON u.correo = r.correo;

  -- ---------------------------------------------------------------- Detalle de tarjeta: checklist y comentarios
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
    ('Componente compacto de tarjeta',                  'stephanieehpr@gmail.com',   'Revisa que el semaforo use los mismos colores que el de desviacion de horas.'),
    ('Transmision por WebSockets en menos de 1 segundo','dana044car@gmail.com','Probe con dos ventanas y el cambio llega casi al instante.')
  ) AS c(titulo, correo, texto)
  JOIN tareas t   ON t.sprint_id = v_sprint AND t.titulo = c.titulo
  JOIN usuarios u ON u.correo = c.correo;

  -- ---------------------------------------------------------------- Impedimento ligado a la tarjeta bloqueada (HU-23)
  INSERT INTO impedimentos (proyecto_id, sprint_id, tarea_id, titulo, severidad, responsable_id, estado, creado_por)
  SELECT v_proy, v_sprint, t.id, 'Falta definir el icono de candado con el equipo de diseno', 'media',
         (SELECT id FROM usuarios WHERE correo = 'stephanieehpr@gmail.com'), 'abierto',
         (SELECT id FROM usuarios WHERE correo = 'diegotrujano3c@gmail.com')
  FROM tareas t
  WHERE t.sprint_id = v_sprint AND t.titulo = 'Badge de bloqueo con borde rosa y candado';

  RAISE NOTICE 'Listo: sprint "%" con 5 historias y 14 tarjetas en "%" (id de proyecto = %).', v_sprint_nombre, v_proyecto_nombre, v_proy;
END $$;