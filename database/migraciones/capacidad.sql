-- Tablas de capacidad individual: horas disponibles por día y ausencias/vacaciones.
-- Requiere la tabla usuarios(id). Ejecutar después de database/schema.sql,
-- o copiar su contenido dentro de schema.sql avisando al equipo.

CREATE TABLE IF NOT EXISTS capacidad_usuarios (
  usuario_id     INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  horas_por_dia  NUMERIC(4, 2) NOT NULL CHECK (horas_por_dia >= 0 AND horas_por_dia <= 24),
  notas          VARCHAR(500),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ausencias (
  id           SERIAL PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL DEFAULT 'ausencia' CHECK (tipo IN ('ausencia', 'vacaciones')),
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE NOT NULL,
  CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS idx_ausencias_usuario_fechas ON ausencias (usuario_id, fecha_inicio, fecha_fin);
