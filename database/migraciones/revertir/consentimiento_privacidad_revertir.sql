/**
    @file consentimiento_privacidad_revertir.sql
    @description Revierte consentimiento_privacidad.sql: quita las columnas agregadas a usuarios, el trigger y la tabla
    avisos_privacidad. ADVERTENCIA: elimina el historial de versiones del aviso y las aceptaciones registradas.
    Usar solo en ambientes de desarrollo o si ninguna cuenta ha aceptado aún una versión.
    Debe ejecutarlo el propietario de la tabla.

    @author Citlaly Morales Viveros
 */
BEGIN;

ALTER TABLE usuarios
DROP COLUMN IF EXISTS eliminado_en;

ALTER TABLE usuarios
DROP COLUMN IF EXISTS version_aviso_privacidad;

DROP TRIGGER IF EXISTS tg_avisos_privacidad_inmutable ON avisos_privacidad;

DROP TABLE IF EXISTS avisos_privacidad;

DROP FUNCTION IF EXISTS bloquear_cambios_avisos ();

COMMIT;