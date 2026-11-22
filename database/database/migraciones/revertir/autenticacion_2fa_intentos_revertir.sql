/**
    @file autenticacion_2fa_intentos_revertir.sql
    @description Reversion: intentos fallidos de 2FA por usuario. Deshace autenticacion_2fa_intentos.sql. La tabla intentos_2fa no se toca.

    @author Citlaly Morales Viveros
*/
DROP TABLE IF EXISTS intentos_2fa_usuario;