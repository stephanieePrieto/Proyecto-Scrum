-- Migracion: Tabla para recuperación de cuenta sin 2FA
-- @author Citlaly Morales Viveros

CREATE TABLE IF NOT EXISTS recuperacion_2fa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'cancelada', 'completada', 'expirada'
    token_cancelacion VARCHAR(64) NOT NULL,
    token_confirmacion VARCHAR(64),
    solicitado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    espera_hasta TIMESTAMPTZ NOT NULL,
    expira_en TIMESTAMPTZ NOT NULL,
    enlace_expira_en TIMESTAMPTZ,
    ultimo_envio_correo TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE recuperacion_2fa IS 'Registro de solicitudes de recuperación de cuenta por pérdida de 2FA.';

CREATE INDEX IF NOT EXISTS ix_recuperacion_2fa_usuario ON recuperacion_2fa (usuario_id);
CREATE INDEX IF NOT EXISTS ix_recuperacion_2fa_cancelacion ON recuperacion_2fa (token_cancelacion);
CREATE INDEX IF NOT EXISTS ix_recuperacion_2fa_confirmacion ON recuperacion_2fa (token_confirmacion);

-- Los permisos de la aplicación no se otorgan aquí: los asigna permisos_aplicacion.sql, que se vuelve a ejecutar
-- después de cada migración y es quien crea los roles si todavía no existen.