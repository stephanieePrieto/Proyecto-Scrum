/**
    @file preferencias_app_tema_revertir.sql
    @description Revierte preferencias_app_tema.sql: restaura el valor por defecto anterior (tema "sistema").
    No cambia los valores ya guardados, porque no se puede saber cuáles eran "sistema" antes del cambio.

    @author Citlaly Morales Viveros
*/

BEGIN;

ALTER TABLE usuarios ALTER COLUMN preferencias_app SET DEFAULT
    '{"tema": "sistema", "textoGrande": false, "altoContraste": false, "reducirAnimaciones": false}'::jsonb;

COMMIT;