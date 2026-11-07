-- Migracion: Autenticacion en dos pasos (2FA)
-- Aplicar DESPUES de schema.sql y sesiones.sql. Es seguro correrla varias veces (usa IF NOT EXISTS).
--
-- Tablas para soportar:
--   - Configuracion de 2FA por usuario (TOTP y correo)
--   - Codigos de respaldo (backup codes)
--   - Dispositivos de confianza
--   - Codigos OTP enviados por correo
--   - Bloqueo temporal por intentos fallidos de 2FA

-- ===========================================================================
-- Configuracion general de 2FA por usuario
-- ===========================================================================
CREATE TABLE IF NOT EXISTS autenticacion_2fa (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  -- TOTP (Google Authenticator)
  secreto_totp_cifrado TEXT,
  -- Si el usuario ha configurado TOTP
  totp_activado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de activacion de TOTP
  totp_activado_en TIMESTAMPTZ,
  -- Correo electronico para 2FA
  correo_2fa_activado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de activacion de correo 2FA
  correo_2fa_activado_en TIMESTAMPTZ,
  -- Si el 2FA esta habilitado para esta cuenta (al menos un metodo activo)
  habilitado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de creacion/actualizacion
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE autenticacion_2fa IS 'Configuracion de autenticacion en dos pasos por usuario. Almacena el estado de TOTP y correo como metodos de 2FA.';
COMMENT ON COLUMN autenticacion_2fa.secreto_totp_cifrado IS 'Secreto TOTP cifrado con AES-256-GCM. La clave de cifrado esta en la variable de entorno TOTP_ENCRYPTION_KEY.';

CREATE INDEX IF NOT EXISTS ix_autenticacion_2fa_usuario ON autenticacion_2fa (usuario_id);

-- ===========================================================================
-- Codigos de respaldo (backup codes)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS codigos_respaldo (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Hash del codigo de respaldo (sha256)
  codigo_hash TEXT NOT NULL,
  -- Si el codigo ya fue utilizado
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de creacion
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Fecha de uso
  usado_en TIMESTAMPTZ,
  -- Grupo al que pertenece (para invalidar todos de un grupo al regenerar)
  grupo_id UUID NOT NULL DEFAULT gen_random_uuid()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_codigos_respaldo_codigo_hash ON codigos_respaldo (codigo_hash);
CREATE INDEX IF NOT EXISTS ix_codigos_respaldo_usuario ON codigos_respaldo (usuario_id);
CREATE INDEX IF NOT EXISTS ix_codigos_respaldo_grupo ON codigos_respaldo (grupo_id);

COMMENT ON TABLE codigos_respaldo IS 'Codigos de respaldo de un solo uso para 2FA. Cada usuario tiene 10 codigos activos.';
COMMENT ON COLUMN codigos_respaldo.grupo_id IS 'Identificador del grupo de codigos. Al regenerar, todos los codigos del grupo anterior se invalidan.';

-- ===========================================================================
-- Dispositivos de confianza
-- ===========================================================================
CREATE TABLE IF NOT EXISTS dispositivos_confianza (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Hash del identificador del dispositivo (user-agent + ip + fingerprint)
  dispositivo_hash TEXT NOT NULL,
  -- Token de confianza (para validar sin 2FA)
  token_confianza TEXT NOT NULL,
  -- Fecha de creacion
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Fecha de expiracion (14 dias despues de creado_en)
  expira_en TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  -- IP desde la que se registro
  ip_registro TEXT,
  -- User-Agent del dispositivo
  user_agent TEXT,
  -- Nombre opcional del dispositivo
  nombre TEXT,
  -- Si fue revocado manualmente
  revocado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de revocacion
  revocado_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_dispositivos_confianza_usuario ON dispositivos_confianza (usuario_id);
CREATE INDEX IF NOT EXISTS ix_dispositivos_confianza_token ON dispositivos_confianza (token_confianza);
CREATE INDEX IF NOT EXISTS ix_dispositivos_confianza_expira ON dispositivos_confianza (expira_en);
CREATE INDEX IF NOT EXISTS ix_dispositivos_confianza_hash ON dispositivos_confianza (dispositivo_hash);

COMMENT ON TABLE dispositivos_confianza IS 'Dispositivos de confianza que pueden omitir el 2FA durante 14 dias.';

-- ===========================================================================
-- Codigos OTP enviados por correo (para autenticacion 2FA)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS otp_correo (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Hash del codigo OTP
  codigo_hash TEXT NOT NULL,
  -- Codigo en texto plano (se elimina despues de usar o expirar)
  codigo_plano TEXT,
  -- Fecha de expiracion (3 minutos)
  expira_en TIMESTAMPTZ NOT NULL,
  -- Si fue utilizado
  usado BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha de uso
  usado_en TIMESTAMPTZ,
  -- IP que solicito el codigo
  ip_solicitud TEXT,
  -- User-Agent
  user_agent TEXT,
  --Fecha de creacion
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_otp_correo_usuario ON otp_correo (usuario_id);
CREATE INDEX IF NOT EXISTS ix_otp_correo_hash ON otp_correo (codigo_hash);
CREATE INDEX IF NOT EXISTS ix_otp_correo_expira ON otp_correo (expira_en);

COMMENT ON TABLE otp_correo IS 'Codigos OTP de un solo uso enviados por correo para 2FA. Expiran en 3 minutos.';

-- ===========================================================================
-- Intentos fallidos de 2FA
-- ===========================================================================
CREATE TABLE IF NOT EXISTS intentos_2fa (
  ip TEXT PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios (id) ON DELETE CASCADE,
  intentos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_intentos_2fa_usuario ON intentos_2fa (usuario_id);

COMMENT ON TABLE intentos_2fa IS 'Registro de intentos fallidos de verificacion 2FA por IP y usuario. Bloquea despues de 5 intentos.';

-- ===========================================================================
-- Funcion para limpiar automaticamente codigos expirados y usados
-- NOTA: Esta funcion se puede llamar manualmente o mediante una tarea programada
-- ===========================================================================
CREATE OR REPLACE FUNCTION limpiar_codigos_2fa_expirados() RETURNS VOID AS $$
BEGIN
  -- Eliminar OTP de correo expirados o usados
  DELETE FROM otp_correo WHERE expira_en < NOW() OR usado = TRUE;
  
  -- Eliminar dispositivos de confianza expirados o revocados
  DELETE FROM dispositivos_confianza WHERE expira_en < NOW() OR revocado = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Ejecutar limpieza automatica (opcional, se puede hacer via cron o aplicacion)
-- SELECT limpiar_codigos_2fa_expirados();

-- ===========================================================================
-- Indices adicionales para optimizar consultas
-- Nota: Se evitan predicados con NOW() ya que no es IMMUTABLE en PostgreSQL
-- ===========================================================================
CREATE INDEX IF NOT EXISTS ix_otp_correo_no_usados ON otp_correo (usuario_id, usado, expira_en);
CREATE INDEX IF NOT EXISTS ix_dispositivos_validos ON dispositivos_confianza (usuario_id, revocado, expira_en);
CREATE INDEX IF NOT EXISTS ix_codigos_respaldo_validos ON codigos_respaldo (usuario_id, usado, grupo_id);

-- ===========================================================================
-- Comentarios finales
-- ===========================================================================
COMMENT ON SCHEMA public IS 'Base de datos de ScrumFlow con soporte para autenticacion en dos pasos (2FA).';
