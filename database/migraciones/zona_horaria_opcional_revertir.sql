-- Revierte zona_horaria_opcional.sql.
-- Autora: Citlaly Morales Viveros
-- Las cuentas sin zona guardada (NULL) reciben America/Mexico_City, el valor que tenía la columna.

BEGIN;

UPDATE usuarios SET zona_horaria = 'America/Mexico_City' WHERE zona_horaria IS NULL;
ALTER TABLE usuarios ALTER COLUMN zona_horaria SET DEFAULT 'America/Mexico_City';
ALTER TABLE usuarios ALTER COLUMN zona_horaria SET NOT NULL;

COMMIT;