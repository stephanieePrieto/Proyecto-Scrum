-- Bloquea TRUNCATE sobre la bitacora con un trigger de sentencia que reutiliza bloquear_cambios_bitacora(),
-- la misma funcion que ya bloquea UPDATE y DELETE. Es seguro correrlo varias veces.
-- Los permisos del usuario de conexion se configuran aparte con bitacora_permisos.sql.
-- Para revertir: bitacora_inmutable_revertir.sql
--
-- @author Citlaly Morales Viveros
DROP TRIGGER IF EXISTS tg_bitacora_sin_truncate ON bitacora;
CREATE TRIGGER tg_bitacora_sin_truncate BEFORE TRUNCATE ON bitacora FOR EACH STATEMENT EXECUTE FUNCTION bloquear_cambios_bitacora();
