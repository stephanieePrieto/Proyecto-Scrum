/**
    @file zona_horaria_opcional.sql
    @description Permite que usuarios.zona_horaria quede vacía (NULL) para proponer la zona del navegador
    cuando la persona todavía no guarda una. No modifica ni borra filas existentes.

    @author Citlaly Morales Viveros
*/
BEGIN;

ALTER TABLE usuarios
ALTER COLUMN zona_horaria
DROP NOT NULL;

ALTER TABLE usuarios
ALTER COLUMN zona_horaria
DROP DEFAULT;

COMMIT;