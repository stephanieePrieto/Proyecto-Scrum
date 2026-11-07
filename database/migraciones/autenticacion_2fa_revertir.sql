-- Reversion: Autenticacion en dos pasos (2FA)
-- Deshace todos los cambios de autenticacion_2fa.sql
-- Ejecutar solo si es necesario revertir la migracion

-- Eliminar indices
DROP INDEX IF EXISTS ix_autenticacion_2fa_usuario;
DROP INDEX IF EXISTS ix_codigos_respaldo_usuario;
DROP INDEX IF EXISTS ix_codigos_respaldo_grupo;
DROP INDEX IF EXISTS ix_otp_correo_usuario;
DROP INDEX IF EXISTS ix_otp_correo_hash;
DROP INDEX IF EXISTS ix_otp_correo_expira;
DROP INDEX IF EXISTS ix_dispositivos_confianza_usuario;
DROP INDEX IF EXISTS ix_dispositivos_confianza_token;
DROP INDEX IF EXISTS ix_dispositivos_confianza_expira;
DROP INDEX IF EXISTS ix_dispositivos_confianza_hash;
DROP INDEX IF EXISTS ix_intentos_2fa_usuario;
DROP INDEX IF EXISTS ix_otp_correo_no_usados;
DROP INDEX IF EXISTS ix_dispositivos_validos;
DROP INDEX IF EXISTS ix_codigos_respaldo_validos;
DROP INDEX IF EXISTS ux_codigos_respaldo_codigo_hash;
DROP INDEX IF EXISTS ix_dispositivos_confianza;

-- Eliminar tablas (en orden inverso para respetar dependencias)
DROP TABLE IF EXISTS intentos_2fa;
DROP TABLE IF EXISTS otp_correo;
DROP TABLE IF EXISTS dispositivos_confianza;
DROP TABLE IF EXISTS codigos_respaldo;
DROP TABLE IF EXISTS autenticacion_2fa;

-- Eliminar funcion
DROP FUNCTION IF EXISTS limpiar_codigos_2fa_expirados();
