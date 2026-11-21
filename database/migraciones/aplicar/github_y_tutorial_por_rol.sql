-- HU-66: repositorio de GitHub; HU-67: progreso del tutorial por rol.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS github_repo_url TEXT;

CREATE TABLE IF NOT EXISTS curso_tutorial_progreso (
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
  estado TEXT NOT NULL CHECK (estado IN ('completado', 'omitido')),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, proyecto_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.curso_tutorial_progreso TO scrumflow_app;
