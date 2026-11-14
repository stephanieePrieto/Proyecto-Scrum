-- Autora: Citlaly Morales Viveros
-- Requiere haber aplicado antes notificaciones_preferencias_canales.sql.
-- Agrega las claves nuevas con su valor por defecto y respeta las que ya estén guardadas.

BEGIN;

UPDATE usuarios
   SET preferencias_notif = jsonb_build_object(
       'interna', '{"asignacion": true, "mencion": true, "desviacion": true, "impedimento": true}'::jsonb
                  || COALESCE(preferencias_notif->'interna', '{}'::jsonb),
       'correo',  '{"asignacion": false, "mencion": false, "desviacion": false, "impedimento": false}'::jsonb
                  || COALESCE(preferencias_notif->'correo', '{}'::jsonb))
 WHERE preferencias_notif ? 'interna';

ALTER TABLE usuarios ALTER COLUMN preferencias_notif SET DEFAULT
  '{"interna": {"asignacion": true, "mencion": true, "desviacion": true, "impedimento": true}, "correo": {"asignacion": false, "mencion": false, "desviacion": false, "impedimento": false}}'::jsonb;

COMMIT;