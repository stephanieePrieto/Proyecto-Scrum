-- HU-05: rondas y votos persistentes de Planning Poker.
-- Ejecutar UNA VEZ en la BD scrumflow con una cuenta autorizada para crear tablas.
-- No modifica ni borra historias, sprints ni tablas existentes.
CREATE TABLE IF NOT EXISTS poker_sesiones (
  id BIGSERIAL PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  historia_id INTEGER NOT NULL REFERENCES historias(id) ON DELETE CASCADE,
  ronda INTEGER NOT NULL DEFAULT 1 CHECK (ronda > 0),
  estado TEXT NOT NULL DEFAULT 'votando' CHECK (estado IN ('votando', 'revelada', 'cerrada')),
  valor_final INTEGER CHECK (valor_final IN (1, 2, 3, 5, 8, 13, 21)),
  iniciada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proyecto_id, historia_id)
);
CREATE INDEX IF NOT EXISTS ix_poker_sesiones_proyecto ON poker_sesiones(proyecto_id);
CREATE TABLE IF NOT EXISTS poker_votos (
  sesion_id BIGINT NOT NULL REFERENCES poker_sesiones(id) ON DELETE CASCADE,
  ronda INTEGER NOT NULL CHECK (ronda > 0),
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL CHECK (puntos IN (1, 2, 3, 5, 8, 13, 21)),
  votado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sesion_id, ronda, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_poker_votos_sesion ON poker_votos(sesion_id, ronda);
-- Conceder acceso al rol de aplicación si está creado en este entorno.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrumflow_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON poker_sesiones, poker_votos TO scrumflow_app;
    GRANT USAGE, SELECT ON SEQUENCE poker_sesiones_id_seq TO scrumflow_app;
  END IF;
END $$;
