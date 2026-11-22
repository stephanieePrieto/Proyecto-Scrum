/**
    @file preferencias_app_revertir.sql
    @description Revierte preferencias_app.sql sin borrar la columna preferencias_app ni sus datos.
    Solo quita el valor por defecto y la restriccion NOT NULL.

    @author Citlaly Morales Viveros
*/
BEGIN;

ALTER TABLE usuarios
ALTER COLUMN preferencias_app DROP DEFAULT;

ALTER TABLE usuarios
ALTER COLUMN preferencias_app DROP NOT NULL;

COMMIT;