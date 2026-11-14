-- Revierte notificaciones_preferencias_canales.sql a las claves globales.
-- Autora: Citlaly Morales Viveros
-- El correo global queda activo si algún tipo tenía correo activo.

BEGIN;

UPDATE usuarios
   SET preferencias_notif = jsonb_build_object(
       'asignaciones', COALESCE((preferencias_notif->'interna'->>'asignacion')::boolean, TRUE),
       'menciones',    COALESCE((preferencias_notif->'interna'->>'mencion')::boolean, TRUE),
       'correo', COALESCE((preferencias_notif->'correo'->>'asignacion')::boolean, FALSE)
              OR COALESCE((preferencias_notif->'correo'->>'mencion')::boolean, FALSE))
 WHERE preferencias_notif ? 'interna';

ALTER TABLE usuarios ALTER COLUMN preferencias_notif SET DEFAULT
  '{"asignaciones": true, "menciones": true, "correo": false}'::jsonb;

COMMIT;