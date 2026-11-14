-- Autora: Citlaly Morales Viveros
-- Permite que usuarios.zona_horaria quede vacía (NULL) para proponer la zona del navegador
-- cuando la persona todavía no guarda una. No modifica ni borra filas existentes.

BEGIN;

ALTER TABLE usuarios ALTER COLUMN zona_horaria DROP NOT NULL;
ALTER TABLE usuarios ALTER COLUMN zona_horaria DROP DEFAULT;

COMMIT;