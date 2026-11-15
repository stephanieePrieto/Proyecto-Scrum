/**
    @file zona_horaria_opcional_revertir.sql
    @description Revierte zona_horaria_opcional.sql.

    @author Citlaly Morales Viveros
*/
BEGIN;

UPDATE usuarios
SET
    zona_horaria = 'America/Mexico_City'
WHERE
    zona_horaria IS NULL;

ALTER TABLE usuarios
ALTER COLUMN zona_horaria
SET DEFAULT 'America/Mexico_City';

ALTER TABLE usuarios
ALTER COLUMN zona_horaria
SET
    NOT NULL;

COMMIT;