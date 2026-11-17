/**
    @file consentimiento_privacidad.sql
    @description Migracion: consentimiento del aviso de privacidad y eliminacion lógica de cuentas.
    Crea el historial de versiones del aviso (inmutable: una vez publicada una versión no se edita ni se borra),
    y agrega a usuarios la versión aceptada y la fecha de eliminación. acepto_privacidad_en ya existe en schema.sql;
    se agrega con IF NOT EXISTS por si la base fue creada con una versión anterior.
    Aplicar DESPUES de schema.sql. Es seguro correrla varias veces (usa IF NOT EXISTS).
    Despues de aplicarla, volver a ejecutar permisos_aplicacion.sql para que el rol de la aplicacion pueda leer la nueva tabla.
    No modifica ni borra registros existentes. Las cuentas existentes quedan sin versión aceptada, por lo que deben
    aceptar el aviso en su siguiente inicio de sesión.
    Para revertir: consentimiento_privacidad_revertir.sql
    
    @author Citlaly Morales Viveros
*/
BEGIN;

CREATE TABLE IF NOT EXISTS avisos_privacidad (
  version TEXT PRIMARY KEY CHECK (version ~ '^v[0-9]+(\.[0-9]+)*$'),
  -- Texto completo de la versión, tal como se publicó
  contenido TEXT NOT NULL CHECK (LENGTH(TRIM(contenido)) > 0),
  publicado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE avisos_privacidad IS 'Historial de versiones del aviso de privacidad. Una versión publicada no se edita ni se borra.';

-- Las versiones publicadas no se modifican: si el texto cambia, se publica una versión nueva
CREATE OR REPLACE FUNCTION bloquear_cambios_avisos() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Las versiones publicadas del aviso de privacidad no se pueden editar ni borrar';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_avisos_privacidad_inmutable ON avisos_privacidad;
CREATE TRIGGER tg_avisos_privacidad_inmutable
  BEFORE UPDATE OR DELETE ON avisos_privacidad
  FOR EACH ROW EXECUTE FUNCTION bloquear_cambios_avisos();

-- Versión aceptada por la cuenta y fecha de aceptación
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acepto_privacidad_en TIMESTAMPTZ;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS version_aviso_privacidad TEXT REFERENCES avisos_privacidad (version);

-- Momento en que la cuenta fue anonimizada. NULL mientras la cuenta no ha sido eliminada.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ;

COMMENT ON COLUMN usuarios.version_aviso_privacidad IS 'Versión del aviso de privacidad aceptada por la cuenta. NULL si todavía no la acepta.';
COMMENT ON COLUMN usuarios.eliminado_en IS 'Fecha en que la cuenta fue eliminada y anonimizada. NULL mientras la cuenta existe.';

COMMIT;
