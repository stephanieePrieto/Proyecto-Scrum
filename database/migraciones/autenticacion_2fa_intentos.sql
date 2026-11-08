-- Migracion: intentos fallidos de 2FA por usuario
-- Aplicar DESPUES de autenticacion_2fa.sql. Es seguro correrla varias veces (usa IF NOT EXISTS).
--
-- intentos_2fa tiene la IP como llave primaria, asi que guarda una sola fila por IP y no sirve
-- para limitar los intentos de una cuenta. Esta tabla cuenta por usuario, sin importar desde
-- cuantas IP se intente, y no modifica ni borra nada de la tabla anterior.

CREATE TABLE IF NOT EXISTS intentos_2fa_usuario (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  -- Intentos de verificacion contados desde el ultimo reinicio del conteo
  intentos INTEGER NOT NULL DEFAULT 0,
  -- Momento del ultimo intento permitido; de aqui se calcula cuando termina el bloqueo
  ultimo_intento TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE intentos_2fa_usuario IS 'Intentos de verificacion 2FA por usuario. Al agotar MAX_INTENTOS_2FA la cuenta queda bloqueada BLOQUEO_MINUTOS desde el ultimo intento; un codigo correcto borra la fila.';
