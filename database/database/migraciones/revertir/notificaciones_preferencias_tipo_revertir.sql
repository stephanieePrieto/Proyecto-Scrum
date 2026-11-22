/**
  @file notificaciones_preferencias_tipo_revertir.sql
  @description Revierte notificaciones_preferencias_tipo.sql, quita desviación e impedimento de la matriz.

  @author Citlaly Morales Viveros
*/
BEGIN;

UPDATE usuarios
    SET preferencias_notif = preferencias_notif
      #- '{interna,desviacion}' #- '{interna,impedimento}'
      #- '{correo,desviacion}'  #- '{correo,impedimento}'
  WHERE preferencias_notif ? 'interna';

ALTER TABLE usuarios ALTER COLUMN preferencias_notif SET DEFAULT
  CAST('{"interna": {"asignacion": true, "mencion": true}, "correo": {"asignacion": false, "mencion": false}}' AS jsonb);

COMMIT;