-- Autora: Citlaly Morales Viveros
-- Convierte las claves globales (asignaciones, menciones, correo) a la forma por canal.
-- El correo de cada tipo queda activo solo si antes estaban activos el tipo y el correo global,
-- para no enviar correos que antes no se enviaban.

BEGIN;

UPDATE usuarios
   SET preferencias_notif = jsonb_build_object(
       'interna', jsonb_build_object(
           'asignacion', COALESCE((preferencias_notif->>'asignaciones')::boolean, TRUE),
           'mencion',    COALESCE((preferencias_notif->>'menciones')::boolean, TRUE)),
       'correo', jsonb_build_object(
           'asignacion', COALESCE((preferencias_notif->>'asignaciones')::boolean, TRUE)
                         AND COALESCE((preferencias_notif->>'correo')::boolean, FALSE),
           'mencion',    COALESCE((preferencias_notif->>'menciones')::boolean, TRUE)
                         AND COALESCE((preferencias_notif->>'correo')::boolean, FALSE)))
 WHERE NOT (preferencias_notif ? 'interna');

ALTER TABLE usuarios ALTER COLUMN preferencias_notif SET DEFAULT
  '{"interna": {"asignacion": true, "mencion": true}, "correo": {"asignacion": false, "mencion": false}}'::jsonb;

COMMIT;