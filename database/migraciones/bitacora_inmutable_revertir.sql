-- Revierte bitacora_inmutable.sql: quita el bloqueo de TRUNCATE. No toca tg_bitacora_inmutable ni los datos.
-- Debe ejecutarlo el propietario de la tabla.
--
-- @author Citlaly Morales Viveros
DROP TRIGGER IF EXISTS tg_bitacora_sin_truncate ON bitacora;
