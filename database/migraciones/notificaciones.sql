-- HU-24 (Alfonso): columnas que usa la campana de notificaciones. Sin datos de prueba.
-- Es seguro correrlo varias veces. Este mismo bloque debe ir tambien al FINAL de schema.sql
-- para que una base nueva ya nazca con estas columnas.

ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS titulo         TEXT;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS referencia_id  INTEGER;
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS metadatos      JSONB NOT NULL DEFAULT '{}';
ALTER TABLE notificaciones ADD COLUMN IF NOT EXISTS leida_en       TIMESTAMPTZ;