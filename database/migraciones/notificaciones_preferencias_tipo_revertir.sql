-- Revierte notificaciones_preferencias_tipos.sql: quita desviación e impedimento de la matriz.
-- Autora: Citlaly Morales Viveros

BEGIN;

UPDATE usuarios
   SET preferencias_notif = preferencias_notif
       #- '{interna,desviacion}' #- '{interna,impedimento}'
       #- '{correo,desviacion}'  #- '{correo,impedimento}'
 WHERE preferencias_notif ? 'interna';

ALTER TABLE usuarios ALTER COLUMN preferencias_notif SET DEFAULT
  '{"interna": {"asignacion": true, "mencion": true}, "correo": {"asignacion": false, "mencion": false}}'::jsonb;

COMMIT;