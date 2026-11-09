-- Otorga permisos a scrumflow_app sobre las tablas de 2FA
-- Ejecutar DESPUES de autenticacion_2fa.sql como superusuario o scrumflow_admin
--
-- @author Citlaly Morales Viveros
-- Transferir propiedad de tablas 2FA a scrumflow_admin
ALTER TABLE IF EXISTS autenticacion_2fa OWNER TO scrumflow_admin;
ALTER TABLE IF EXISTS codigos_respaldo OWNER TO scrumflow_admin;
ALTER TABLE IF EXISTS dispositivos_confianza OWNER TO scrumflow_admin;
ALTER TABLE IF EXISTS otp_correo OWNER TO scrumflow_admin;
ALTER TABLE IF EXISTS intentos_2fa OWNER TO scrumflow_admin;
ALTER TABLE IF EXISTS intentos_2fa_usuario OWNER TO scrumflow_admin;

-- Otorgar permisos completos a scrumflow_app sobre las tablas de 2FA
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE autenticacion_2fa TO scrumflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE codigos_respaldo TO scrumflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dispositivos_confianza TO scrumflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE otp_correo TO scrumflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intentos_2fa TO scrumflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE intentos_2fa_usuario TO scrumflow_app;

-- Otorgar permisos sobre secuencias de las tablas de 2FA
GRANT USAGE, SELECT ON SEQUENCE codigos_respaldo_id_seq TO scrumflow_app;
GRANT USAGE, SELECT ON SEQUENCE otp_correo_id_seq TO scrumflow_app;

-- Otorgar permisos sobre la funcion de limpieza
ALTER FUNCTION IF EXISTS limpiar_codigos_2fa_expirados() OWNER TO scrumflow_admin;
GRANT EXECUTE ON FUNCTION limpiar_codigos_2fa_expirados() TO scrumflow_app;

-- Verificar permisos otorgados
SELECT table_name, privilege_type 
FROM information_schema.table_privileges 
WHERE grantee = 'scrumflow_app' 
AND table_name IN ('autenticacion_2fa', 'codigos_respaldo', 'dispositivos_confianza', 'otp_correo', 'intentos_2fa', 'intentos_2fa_usuario')
ORDER BY table_name, privilege_type;