/**
    @file notificaciones_preferencias_canales.sql
    @description Convierte las claves globales (asignaciones, menciones, correo) a la forma por canal.
    El correo de cada tipo queda activo solo si antes estaban activos el tipo y el correo global,
    para no enviar correos que antes no se enviaban.

    @author Citlaly Morales Viveros
*/
BEGIN;

UPDATE usuarios
SET
    preferencias_notif = jsonb_build_object (
        'interna',
        jsonb_build_object (
            'asignacion',
            COALESCE(
                CAST(
                    preferencias_notif - > > 'asignaciones' AS boolean
                ),
                TRUE
            ),
            'mencion',
            COALESCE(
                CAST(preferencias_notif - > > 'menciones' AS boolean),
                TRUE
            )
        ),
        'correo',
        jsonb_build_object (
            'asignacion',
            COALESCE(
                CAST(
                    preferencias_notif - > > 'asignaciones' AS boolean
                ),
                TRUE
            )
            AND COALESCE(
                CAST(preferencias_notif - > > 'correo' AS boolean),
                FALSE
            ),
            'mencion',
            COALESCE(
                CAST(preferencias_notif - > > 'menciones' AS boolean),
                TRUE
            )
            AND COALESCE(
                CAST(preferencias_notif - > > 'correo' AS boolean),
                FALSE
            )
        )
    )
WHERE
    NOT (preferencias_notif ? 'interna');

ALTER TABLE usuarios
ALTER COLUMN preferencias_notif
SET DEFAULT CAST(
    '{"interna": {"asignacion": true, "mencion": true}, "correo": {"asignacion": false, "mencion": false}}' AS jsonb
);

COMMIT;