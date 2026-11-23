/**
    @file solucion_dod_releases_reuniones.sql
    @description Cambios de Diego para bases de datos ya existentes (los mismos que ya están en schema.sql):
      - impedimentos.solucion (cómo se resolvió el impedimento).
      - Definition of Done por sprint y por historia (sprints.definition_of_done, historias.definition_of_done)
        y lo que se verificó de ella en la Review (reviews_historias.dod_cumplidos, dod_total).
      - tabla releases, sprints.release_id y el candado que impide eliminar un sprint agrupado.
      - reuniones Scrum en eventos_calendario (origen 'reunion', proyecto_id, notas, creado_por, actualizado_en;
        sprint_id deja de ser obligatorio) y la tabla eventos_participantes. Los eventos ya generados quedan como 'generado'.
    Agrega columnas, tablas, restricciones y un trigger, y vuelve opcional eventos_calendario.sprint_id.
    No modifica ni borra filas. Es seguro correrlo varias veces.
    Para revertir: migraciones/revertir/solucion_dod_releases_reuniones_revertir.sql

    @author Diego Rafael Jiménez Trujano
*/
BEGIN;

-- solución del impedimento
ALTER TABLE impedimentos
ADD COLUMN IF NOT EXISTS solucion TEXT;

-- DoD por sprint y por historia
ALTER TABLE sprints
ADD COLUMN IF NOT EXISTS definition_of_done TEXT;

ALTER TABLE historias
ADD COLUMN IF NOT EXISTS definition_of_done TEXT;

ALTER TABLE reviews_historias
ADD COLUMN IF NOT EXISTS dod_cumplidos INTEGER CHECK (dod_cumplidos IS NULL OR dod_cumplidos >= 0);

ALTER TABLE reviews_historias
ADD COLUMN IF NOT EXISTS dod_total INTEGER CHECK (dod_total IS NULL OR dod_total >= 0);

-- releases que agrupan sprints
CREATE TABLE IF NOT EXISTS releases (
    id SERIAL PRIMARY KEY,
    proyecto_id INTEGER NOT NULL REFERENCES proyectos (id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    fecha_objetivo DATE,
    creado_por INTEGER REFERENCES usuarios (id) ON DELETE SET NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT releases_nombre_unico_por_proyecto UNIQUE (proyecto_id, nombre)
);

CREATE INDEX IF NOT EXISTS ix_releases_proyecto ON releases (proyecto_id);

ALTER TABLE sprints
ADD COLUMN IF NOT EXISTS release_id INTEGER REFERENCES releases (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_sprints_release ON sprints (release_id);

CREATE OR REPLACE FUNCTION impedir_eliminar_sprint_en_release() RETURNS TRIGGER AS $$
DECLARE
    nombre_release TEXT;
BEGIN
    IF OLD.release_id IS NULL OR NOT EXISTS (SELECT 1 FROM proyectos WHERE id = OLD.proyecto_id) THEN
        RETURN OLD;
    END IF;
    SELECT nombre INTO nombre_release FROM releases WHERE id = OLD.release_id;
    RAISE EXCEPTION 'El sprint "%" pertenece al release "%": quitalo del release antes de eliminarlo.', OLD.nombre, nombre_release
        USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_sprint_en_release ON sprints;

CREATE TRIGGER tg_sprint_en_release BEFORE DELETE ON sprints FOR EACH ROW EXECUTE FUNCTION impedir_eliminar_sprint_en_release();

-- reuniones Scrum dentro de eventos_calendario
ALTER TABLE eventos_calendario
ALTER COLUMN sprint_id DROP NOT NULL;

ALTER TABLE eventos_calendario
ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'generado';

ALTER TABLE eventos_calendario
ADD COLUMN IF NOT EXISTS proyecto_id INTEGER REFERENCES proyectos (id) ON DELETE CASCADE;

ALTER TABLE eventos_calendario
ADD COLUMN IF NOT EXISTS notas TEXT;

ALTER TABLE eventos_calendario
ADD COLUMN IF NOT EXISTS creado_por INTEGER REFERENCES usuarios (id) ON DELETE SET NULL;

ALTER TABLE eventos_calendario
ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ;

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_origen_check;

ALTER TABLE eventos_calendario
ADD CONSTRAINT eventos_calendario_origen_check CHECK (origen IN ('generado', 'reunion'));

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_origen_coherente;

ALTER TABLE eventos_calendario
ADD CONSTRAINT eventos_calendario_origen_coherente CHECK (
    (origen = 'generado' AND sprint_id IS NOT NULL) OR (origen = 'reunion' AND proyecto_id IS NOT NULL AND sprint_id IS NULL)
);

ALTER TABLE eventos_calendario
DROP CONSTRAINT IF EXISTS eventos_calendario_reunion_horario;

ALTER TABLE eventos_calendario
ADD CONSTRAINT eventos_calendario_reunion_horario CHECK (origen <> 'reunion' OR termina_en > inicia_en);

CREATE INDEX IF NOT EXISTS ix_eventos_reuniones ON eventos_calendario (proyecto_id, inicia_en) WHERE origen = 'reunion';

CREATE TABLE IF NOT EXISTS eventos_participantes (
    evento_id INTEGER NOT NULL REFERENCES eventos_calendario (id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    PRIMARY KEY (evento_id, usuario_id)
);

COMMIT;
