/**
    @file solucion_dod_releases_reuniones_revertir.sql
    @description Revierte solucion_dod_releases_reuniones.sql.
    ADVERTENCIA: se pierde el texto de la solución de los impedimentos resueltos y la DoD de sprints e historias
    (con lo que se verificó de ella en la Review), los releases con la agrupación de sus sprints y las reuniones
    Scrum creadas a mano (con sus participantes). Los eventos generados del calendario se conservan.
    No borra impedimentos, sprints, historias ni decisiones.

    @author Diego Rafael Jiménez Trujano
*/
BEGIN;

-- sprint_id vuelve a ser obligatorio, así que las reuniones (sin sprint) se eliminan
DROP TABLE IF EXISTS eventos_participantes;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'eventos_calendario' AND column_name = 'origen') THEN
        DELETE FROM eventos_calendario WHERE origen = 'reunion';
    END IF;
END;
$$;

DROP INDEX IF EXISTS ix_eventos_reuniones;

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_reunion_horario;

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_origen_coherente;

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_origen_check;

ALTER TABLE eventos_calendario
DROP COLUMN IF EXISTS actualizado_en;

ALTER TABLE eventos_calendario
DROP COLUMN IF EXISTS creado_por;

ALTER TABLE eventos_calendario
DROP COLUMN IF EXISTS notas;

ALTER TABLE eventos_calendario
DROP COLUMN IF EXISTS proyecto_id;

ALTER TABLE eventos_calendario
DROP COLUMN IF EXISTS origen;

ALTER TABLE eventos_calendario
ALTER COLUMN sprint_id SET NOT NULL;

-- Releases y trigger que impide eliminar sprints agrupados
DROP TRIGGER IF EXISTS tg_sprint_en_release ON sprints;

DROP FUNCTION IF EXISTS impedir_eliminar_sprint_en_release();

DROP INDEX IF EXISTS ix_sprints_release;

ALTER TABLE sprints
DROP COLUMN IF EXISTS release_id;

DROP TABLE IF EXISTS releases;

-- Definition of Done por sprint y por historia
ALTER TABLE reviews_historias
DROP COLUMN IF EXISTS dod_total;

ALTER TABLE reviews_historias
DROP COLUMN IF EXISTS dod_cumplidos;

ALTER TABLE historias
DROP COLUMN IF EXISTS definition_of_done;

ALTER TABLE sprints
DROP COLUMN IF EXISTS definition_of_done;

-- Solución de los impedimentos
ALTER TABLE impedimentos
DROP COLUMN IF EXISTS solucion;

COMMIT;
