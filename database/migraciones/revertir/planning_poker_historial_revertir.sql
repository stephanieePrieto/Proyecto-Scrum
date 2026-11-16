/**
    @file planning_poker_historial_revertir.sql
    @description Revierte planning_poker_historial.sql: quita el indice parcial y vuelve a poner el UNIQUE (proyecto_id, historia_id)
    solo si no hay historias con mas de una sesion. Si las hay, no se borra nada y se muestra un aviso.

    @author Citlaly Morales Viveros
*/
BEGIN;

DROP INDEX IF EXISTS ux_poker_sesion_activa_historia;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'poker_sesiones_proyecto_id_historia_id_key'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM poker_sesiones
            GROUP BY proyecto_id, historia_id
            HAVING COUNT(*) > 1
        ) THEN
            ALTER TABLE poker_sesiones
            ADD CONSTRAINT poker_sesiones_proyecto_id_historia_id_key UNIQUE (proyecto_id, historia_id);
    ELSE
            RAISE NOTICE 'Hay historias con mas de una sesion; el UNIQUE (proyecto_id, historia_id) no se restauro.';
        END IF;
    END IF;
END $$;

COMMIT;