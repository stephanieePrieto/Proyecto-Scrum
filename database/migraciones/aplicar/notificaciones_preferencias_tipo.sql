/**
  @file notificaciones_preferencias_tipo.sql
  @description Agrega las claves nuevas con su valor por defecto y respeta las que ya estén guardadas.

  @author Citlaly Morales Viveros
*/
BEGIN;

UPDATE usuarios
SET
  preferencias_notif = jsonb_build_object (
    'interna',
    CAST(
      '{"asignacion": true, "mencion": true, "desviacion": true, "impedimento": true}' AS jsonb
    ) || COALESCE(
      preferencias_notif - > 'interna',
      CAST('{}' AS jsonb)
    ),
    'correo',
    CAST(
      '{"asignacion": false, "mencion": false, "desviacion": false, "impedimento": false}' AS jsonb
    ) || COALESCE(
      preferencias_notif - > 'correo',
      CAST('{}' AS jsonb)
    )
  )
WHERE
  preferencias_notif ? 'interna';

ALTER TABLE usuarios
ALTER COLUMN preferencias_notif
SET DEFAULT CAST(
  '{"interna": {"asignacion": true, "mencion": true, "desviacion": true, "impedimento": true}, "correo": {"asignacion": false, "mencion": false, "desviacion": false, "impedimento": false}}' AS jsonb
);

COMMIT;