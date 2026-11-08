-- Reversion: Tabla para recuperación de cuenta sin 2FA
-- @author Citlaly Morales Viveros

REVOKE ALL ON TABLE recuperacion_2fa FROM scrumflow_app;
DROP TABLE IF EXISTS recuperacion_2fa;