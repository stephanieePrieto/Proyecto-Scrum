-- HU-27 (Alfonso): temporizador de horas reales.
-- Es seguro correrlo varias veces. Este mismo bloque debe ir tambien al FINAL de schema.sql
-- para que una base nueva ya nazca con esta tabla.
--
-- Una persona solo puede tener UN temporizador (la llave primaria es usuario_id).
-- El tiempo vive en el servidor: si se cierra el navegador no se pierde.
--   acumulado_segundos = tiempo ya medido hasta la ultima pausa
--   reanudado_en       = momento en que volvio a correr (NULL mientras esta en pausa)
CREATE TABLE IF NOT EXISTS temporizadores (
  usuario_id          INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  tarea_id            INTEGER NOT NULL REFERENCES tareas (id) ON DELETE CASCADE,
  estado              TEXT NOT NULL DEFAULT 'corriendo' CHECK (estado IN ('corriendo', 'pausado')),
  acumulado_segundos  INTEGER NOT NULL DEFAULT 0 CHECK (acumulado_segundos >= 0),
  reanudado_en        TIMESTAMPTZ,
  iniciado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT temporizadores_estado_coherente CHECK ((estado = 'corriendo') = (reanudado_en IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_temporizadores_tarea ON temporizadores (tarea_id);