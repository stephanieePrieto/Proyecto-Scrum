/**
    @file preferencias_app_tema.sql
    @description Apariencia solo con claro (por defecto) y oscuro. Las cuentas que tenían "sistema" pasan a "claro".
    No se modifican los demás valores.

    @author Citlaly Morales Viveros
*/

BEGIN;

UPDATE usuarios
        SET preferencias_app = jsonb_set(preferencias_app, '{tema}', '"claro"'::jsonb)
    WHERE preferencias_app->>'tema' IS DISTINCT FROM 'claro'
        AND preferencias_app->>'tema' IS DISTINCT FROM 'oscuro';

ALTER TABLE usuarios ALTER COLUMN preferencias_app SET DEFAULT
    '{"tema": "claro", "textoGrande": false, "altoContraste": false, "reducirAnimaciones": false}'::jsonb;

COMMIT;