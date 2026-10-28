-- BASE (no modificar sin avisar al equipo) - HU-47: crea todas las tablas del sistema
-- VERSION 2: todos los usuarios son "base" (sin rol global). El rol existe SOLO en miembros_proyecto.rol.
-- Para empezar de cero: database/reiniciar.sql
-- Es seguro correrlo varias veces: no borra nada que ya exista (usa IF NOT EXISTS).
-- Si necesitan cambiar una tabla, avisen al equipo y agreguen el cambio al final de este archivo.
-- ===========================================================================
-- Funcion compartida: los correos siempre se guardan en minusculas y sin espacios
-- ===========================================================================
CREATE OR REPLACE FUNCTION normalizar_correo() RETURNS TRIGGER AS $$ BEGIN NEW.correo := LOWER(TRIM(NEW.correo));
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- ===========================================================================
-- Cuentas y equipos (HU-38, HU-39, HU-40, HU-45, HU-57)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL,
  password_hash TEXT,
  es_admin BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  foto_url TEXT,
  zona_horaria TEXT NOT NULL DEFAULT 'America/Mexico_City',
  preferencias_notif JSONB NOT NULL DEFAULT '{"asignaciones": true, "menciones": true, "correo": false}',
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  acepto_privacidad_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_correo ON usuarios (LOWER(correo));
DROP TRIGGER IF EXISTS tg_usuarios_correo ON usuarios;
CREATE TRIGGER tg_usuarios_correo BEFORE
INSERT
  OR
UPDATE OF correo ON usuarios FOR EACH ROW EXECUTE FUNCTION normalizar_correo();
COMMENT ON TABLE usuarios IS 'Personas de la plataforma. NO tienen rol: el rol se asigna dentro de cada proyecto (miembros_proyecto.rol)';
COMMENT ON COLUMN usuarios.es_admin IS 'OBSOLETO: ya no concede permisos y siempre es FALSE. Se eliminara cuando ningun archivo del codigo la lea';
CREATE TABLE IF NOT EXISTS tokens_recuperacion (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_tokens_recuperacion_usuario ON tokens_recuperacion (usuario_id);
CREATE INDEX IF NOT EXISTS ix_tokens_recuperacion_hash ON tokens_recuperacion (token_hash);
CREATE TABLE IF NOT EXISTS equipos (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE,
  creado_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Pertenecer a un equipo NO implica ningun rol
CREATE TABLE IF NOT EXISTS miembros_equipo (
  equipo_id INTEGER NOT NULL REFERENCES equipos (id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  PRIMARY KEY (equipo_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_miembros_equipo_usuario ON miembros_equipo (usuario_id);
-- ===========================================================================
-- Proyectos y roles por proyecto (HU-01, HU-41, HU-42, HU-43)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS proyectos (
  id SERIAL PRIMARY KEY,
  equipo_id INTEGER NOT NULL REFERENCES equipos (id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  vision TEXT,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  definition_of_done TEXT NOT NULL DEFAULT 'Codigo revisado, probado y sin errores conocidos',
  umbral_desviacion INTEGER NOT NULL DEFAULT 20 CHECK (
    umbral_desviacion BETWEEN 0 AND 100
  ),
  archivado BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  ultimo_numero_hu INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_numero_hu >= 0),
  creado_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT proyectos_fechas_validas CHECK (fecha_fin >= fecha_inicio),
    CONSTRAINT proyectos_nombre_unico_por_equipo UNIQUE (equipo_id, nombre)
);
-- UNICO lugar donde existe el rol: una misma persona puede tener roles distintos en proyectos distintos
CREATE TABLE IF NOT EXISTS miembros_proyecto (
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK (
    rol IN ('scrum_master', 'product_owner', 'developer')
  ),
  PRIMARY KEY (proyecto_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_miembros_proyecto_usuario ON miembros_proyecto (usuario_id);
-- Un solo Product Owner por proyecto
CREATE UNIQUE INDEX IF NOT EXISTS ux_un_product_owner_por_proyecto ON miembros_proyecto (proyecto_id)
WHERE rol = 'product_owner';
-- Invitacion: se invita a una PERSONA al equipo. El rol y el proyecto son opcionales
-- (si vienen, al aceptar se agrega a la persona a ese proyecto con ese rol).
CREATE TABLE IF NOT EXISTS invitaciones (
  id SERIAL PRIMARY KEY,
  correo TEXT NOT NULL,
  equipo_id INTEGER NOT NULL REFERENCES equipos (id) ON DELETE CASCADE,
  proyecto_id INTEGER REFERENCES proyectos (id) ON DELETE CASCADE,
  rol TEXT CHECK (
    rol IS NULL
    OR rol IN ('scrum_master', 'product_owner', 'developer')
  ),
  token_hash TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (
    estado IN ('pendiente', 'aceptada', 'fallida', 'expirada')
  ),
  expira_en TIMESTAMPTZ NOT NULL,
  invitado_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_invitaciones_token ON invitaciones (token_hash);
CREATE INDEX IF NOT EXISTS ix_invitaciones_correo ON invitaciones (LOWER(correo));
DROP TRIGGER IF EXISTS tg_invitaciones_correo ON invitaciones;
CREATE TRIGGER tg_invitaciones_correo BEFORE
INSERT
  OR
UPDATE OF correo ON invitaciones FOR EACH ROW EXECUTE FUNCTION normalizar_correo();
-- Capacidad individual (HU-44)
CREATE TABLE IF NOT EXISTS capacidad_usuarios (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  horas_por_dia NUMERIC(4, 2) NOT NULL DEFAULT 6 CHECK (
    horas_por_dia >= 0
    AND horas_por_dia <= 24
  ),
  notas VARCHAR(500),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Compatibilidad: el nombre anterior (singular) sigue funcionando como vista de la tabla anterior.
-- Se eliminara cuando ningun archivo del codigo mencione "capacidad_usuario".
CREATE OR REPLACE VIEW capacidad_usuario AS
SELECT usuario_id,
  horas_por_dia
FROM capacidad_usuarios;
CREATE TABLE IF NOT EXISTS ausencias (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'ausencia' CHECK (tipo IN ('ausencia', 'vacaciones')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  motivo TEXT,
  CONSTRAINT ausencias_fechas_validas CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_ausencias_usuario_fechas ON ausencias (usuario_id, fecha_inicio, fecha_fin);
-- ===========================================================================
-- Backlog y sprints (HU-02 a HU-09)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS epicas (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4F46E5',
  UNIQUE (proyecto_id, nombre)
);
CREATE TABLE IF NOT EXISTS sprints (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  objetivo TEXT,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  capacidad_horas NUMERIC(7, 1) NOT NULL CHECK (capacidad_horas > 0),
  estado TEXT NOT NULL DEFAULT 'planificado' CHECK (estado IN ('planificado', 'activo', 'cerrado')),
  velocity INTEGER,
  cerrado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sprints_fechas_validas CHECK (fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_sprints_proyecto ON sprints (proyecto_id);
-- Un solo sprint activo por proyecto
CREATE UNIQUE INDEX IF NOT EXISTS ux_un_sprint_activo_por_proyecto ON sprints (proyecto_id)
WHERE estado = 'activo';
CREATE TABLE IF NOT EXISTS historias (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  numero_hu INTEGER NOT NULL CHECK (numero_hu > 0),
  epica_id INTEGER REFERENCES epicas (id) ON DELETE
  SET NULL,
    sprint_id INTEGER REFERENCES sprints (id) ON DELETE
  SET NULL,
    titulo TEXT NOT NULL,
    como TEXT,
    quiero TEXT,
    para TEXT,
    criterios TEXT,
    puntos INTEGER CHECK (puntos IN (1, 2, 3, 5, 8, 13, 21)),
    etiquetas TEXT [] NOT NULL DEFAULT '{}',
    estado TEXT NOT NULL DEFAULT 'backlog' CHECK (
      estado IN (
        'backlog',
        'en_sprint',
        'hecho',
        'aceptada',
        'rechazada'
      )
    ),
    orden INTEGER NOT NULL DEFAULT 0,
    propuesta BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    creada_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_historias_proyecto_orden ON historias (proyecto_id, orden);
CREATE INDEX IF NOT EXISTS ix_historias_sprint ON historias (sprint_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_historias_proyecto_numero_hu
ON historias (proyecto_id, numero_hu);
-- ===========================================================================
-- Tablero y tarjetas (HU-08, HU-17 a HU-25)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS columnas_tablero (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL,
  limite_wip INTEGER CHECK (
    limite_wip IS NULL
    OR limite_wip > 0
  ),
  wip_duro BOOLEAN NOT NULL DEFAULT FALSE,
  es_final BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (proyecto_id, nombre)
);
-- Una tarea es una tarjeta del tablero
CREATE TABLE IF NOT EXISTS tareas (
  id SERIAL PRIMARY KEY,
  historia_id INTEGER NOT NULL REFERENCES historias (id) ON DELETE CASCADE,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  sprint_id INTEGER REFERENCES sprints (id) ON DELETE
  SET NULL,
    columna_id INTEGER REFERENCES columnas_tablero (id) ON DELETE
  SET NULL,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    responsable_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    horas_estimadas NUMERIC(6, 1) CHECK (
      horas_estimadas IS NULL
      OR horas_estimadas > 0
    ),
    etiquetas TEXT [] NOT NULL DEFAULT '{}',
    orden INTEGER NOT NULL DEFAULT 0,
    bloqueada BOOLEAN NOT NULL DEFAULT FALSE,
    motivo_bloqueo TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_tareas_tablero ON tareas (sprint_id, columna_id, orden);
CREATE INDEX IF NOT EXISTS ix_tareas_responsable ON tareas (responsable_id);
CREATE INDEX IF NOT EXISTS ix_tareas_historia ON tareas (historia_id);
CREATE INDEX IF NOT EXISTS ix_tareas_proyecto ON tareas (proyecto_id);
CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  hecho BOOLEAN NOT NULL DEFAULT FALSE,
  orden INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comentarios (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    texto TEXT NOT NULL CHECK (LENGTH(TRIM(texto)) > 0),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_comentarios_tarea ON comentarios (tarea_id);
CREATE TABLE IF NOT EXISTS adjuntos (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    nombre_original TEXT NOT NULL,
    nombre_guardado TEXT NOT NULL,
    mime TEXT,
    tamano_bytes INTEGER NOT NULL CHECK (tamano_bytes <= 10485760),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_adjuntos_tarea ON adjuntos (tarea_id);
CREATE TABLE IF NOT EXISTS historial_tareas (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    accion TEXT NOT NULL,
    detalle JSONB,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_historial_tarea ON historial_tareas (tarea_id, creado_en);
-- ===========================================================================
-- Horas reales (HU-27, HU-28)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS registros_horas (
  id SERIAL PRIMARY KEY,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    fecha DATE NOT NULL,
    horas NUMERIC(4, 1) NOT NULL CHECK (
      horas > 0
      AND horas <= 24
    ),
    nota TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_horas_usuario_fecha ON registros_horas (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS ix_horas_tarea ON registros_horas (tarea_id);
-- ===========================================================================
-- Ceremonias Scrum (HU-10 a HU-15)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS impedimentos (
  id SERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  sprint_id INTEGER REFERENCES sprints (id) ON DELETE
  SET NULL,
    tarea_id INTEGER REFERENCES tareas (id) ON DELETE
  SET NULL,
    titulo TEXT NOT NULL,
    severidad TEXT NOT NULL DEFAULT 'media' CHECK (severidad IN ('baja', 'media', 'alta')),
    responsable_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'resuelto')),
    creado_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    resuelto_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resuelto_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_impedimentos_proyecto ON impedimentos (proyecto_id, estado);
CREATE TABLE IF NOT EXISTS dailies (
  id SERIAL PRIMARY KEY,
  sprint_id INTEGER NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  ayer TEXT,
  hoy TEXT,
  impedimentos TEXT,
  tardio BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sprint_id, usuario_id, fecha)
);
CREATE TABLE IF NOT EXISTS daily_tareas (
  daily_id INTEGER NOT NULL REFERENCES dailies (id) ON DELETE CASCADE,
  tarea_id INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  PRIMARY KEY (daily_id, tarea_id)
);
CREATE TABLE IF NOT EXISTS reviews_historias (
  id SERIAL PRIMARY KEY,
  sprint_id INTEGER NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  historia_id INTEGER NOT NULL REFERENCES historias (id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('aceptada', 'rechazada')),
  comentario TEXT,
  decidido_por INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    decidido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (sprint_id, historia_id)
);
CREATE TABLE IF NOT EXISTS retros (
  id SERIAL PRIMARY KEY,
  sprint_id INTEGER NOT NULL UNIQUE REFERENCES sprints (id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrada_en TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS retro_items (
  id SERIAL PRIMARY KEY,
  retro_id INTEGER NOT NULL REFERENCES retros (id) ON DELETE CASCADE,
  columna TEXT NOT NULL CHECK (columna IN ('bien', 'mejorar')),
  texto TEXT NOT NULL,
  autor_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    anonimo BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS retro_votos (
  item_id INTEGER NOT NULL REFERENCES retro_items (id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, usuario_id)
);
CREATE TABLE IF NOT EXISTS retro_acciones (
  id SERIAL PRIMARY KEY,
  retro_id INTEGER NOT NULL REFERENCES retros (id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  responsable_id INTEGER REFERENCES usuarios (id) ON DELETE
  SET NULL,
    fecha_limite DATE,
    completada BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS eventos_calendario (
  id SERIAL PRIMARY KEY,
  sprint_id INTEGER NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('planning', 'daily', 'review', 'retro')),
  titulo TEXT NOT NULL,
  inicia_en TIMESTAMPTZ NOT NULL,
  termina_en TIMESTAMPTZ NOT NULL
);
-- ===========================================================================
-- Notificaciones, metricas y bitacora (HU-24, HU-29, HU-46)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS notificaciones (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT,
  mensaje TEXT NOT NULL,
  enlace TEXT,
  referencia_id INTEGER,
  metadatos JSONB DEFAULT '{}',
  leida BOOLEAN NOT NULL DEFAULT FALSE,
  leida_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_notificaciones_usuario ON notificaciones (usuario_id, leida, creado_en DESC);
-- Una foto diaria del avance del sprint, para dibujar el Burndown
CREATE TABLE IF NOT EXISTS snapshots_burndown (
  id SERIAL PRIMARY KEY,
  sprint_id INTEGER NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  horas_restantes NUMERIC(8, 1) NOT NULL,
  puntos_restantes INTEGER NOT NULL DEFAULT 0,
  alcance_modificado BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (sprint_id, fecha)
);
-- Bitacora de auditoria. usuario_id y proyecto_id NO tienen llave foranea a proposito: el registro no debe cambiar nunca.
-- proyecto_id permite que cada Scrum Master consulte solo la bitacora de SU proyecto (ya no hay administrador global).
CREATE TABLE IF NOT EXISTS bitacora (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER,
  proyecto_id INTEGER,
  accion TEXT NOT NULL,
  objeto TEXT NOT NULL,
  objeto_id INTEGER,
  detalle JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_bitacora_fecha ON bitacora (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_bitacora_proyecto ON bitacora (proyecto_id, creado_en DESC);
-- La bitacora no se puede editar ni borrar (HU-46)
CREATE OR REPLACE FUNCTION bloquear_cambios_bitacora() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'La bitacora de auditoria no se puede editar ni borrar';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tg_bitacora_inmutable ON bitacora;
CREATE TRIGGER tg_bitacora_inmutable BEFORE
UPDATE
  OR DELETE ON bitacora FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_bitacora();
-- Planning Poker (HU-05) es OPCIONAL: si el equipo lo implementa, agregue aqui sus tablas.
-- ===========================================================================
-- Seguridad y autenticacion
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tokens_revocados (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  expira_en TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_tokens_revocados_expira ON tokens_revocados (expira_en);
CREATE TABLE IF NOT EXISTS intentos_ip (
  ip TEXT PRIMARY KEY,
  intentos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- ===========================================================================
-- OPCIONAL: solo se puede asignar a un proyecto a quien ya pertenece al equipo de ese proyecto.
-- Descomentar cuando equipos.service.js y proyectos.service.js agreguen al creador a miembros_equipo.
-- ===========================================================================
-- CREATE OR REPLACE FUNCTION validar_miembro_proyecto() RETURNS TRIGGER AS $$
-- BEGIN
--   IF NOT EXISTS (
--     SELECT 1 FROM proyectos p
--     JOIN miembros_equipo me ON me.equipo_id = p.equipo_id
--     WHERE p.id = NEW.proyecto_id AND me.usuario_id = NEW.usuario_id
--   ) THEN
--     RAISE EXCEPTION 'El usuario no pertenece al equipo de este proyecto';
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
-- DROP TRIGGER IF EXISTS tg_validar_miembro_proyecto ON miembros_proyecto;
-- CREATE TRIGGER tg_validar_miembro_proyecto BEFORE INSERT ON miembros_proyecto
--   FOR EACH ROW EXECUTE FUNCTION validar_miembro_proyecto();