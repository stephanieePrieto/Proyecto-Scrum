-- Revierte permisos de 2FA
-- Ejecutar para eliminar permisos de scrumflow_app sobre tablas de 2FA
--
-- @author Citlaly Morales Viveros
\set ON_ERROR_STOP on

-- Revocar permisos sobre tablas de 2FA
REVOKE ALL ON TABLE autenticacion_2fa FROM scrumflow_app;
REVOKE ALL ON TABLE codigos_respaldo FROM scrumflow_app;
REVOKE ALL ON TABLE dispositivos_confianza FROM scrumflow_app;
REVOKE ALL ON TABLE otp_correo FROM scrumflow_app;
REVOKE ALL ON TABLE intentos_2fa FROM scrumflow_app;
REVOKE ALL ON TABLE intentos_2fa_usuario FROM scrumflow_app;

-- Revocar permisos sobre secuencias
REVOKE ALL ON SEQUENCE codigos_respaldo_id_seq FROM scrumflow_app;
REVOKE ALL ON SEQUENCE otp_correo_id_seq FROM scrumflow_app;

-- Revocar permisos sobre funcion
REVOKE ALL ON FUNCTION limpiar_codigos_2fa_expirados() FROM scrumflow_app;