/**
  @file planning_poker_historial.sql
  @description Permitir nuevas sesiones tras cerrar una estimación y volver a «Sin estimar».

  @author Jetzaly Josmery Tello Campos
*/
BEGIN;

ALTER TABLE poker_sesiones
DROP CONSTRAINT IF EXISTS poker_sesiones_proyecto_id_historia_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_poker_sesion_activa_historia ON poker_sesiones (proyecto_id, historia_id)
WHERE
  estado <> 'cerrada';

COMMIT;