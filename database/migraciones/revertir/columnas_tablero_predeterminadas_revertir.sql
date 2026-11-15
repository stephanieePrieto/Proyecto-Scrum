/**
    @file columnas_tablero_predeterminadas_revertir.sql
    @description Revierte columnas_tablero_predeterminadas.sql: borra solo las columnas predeterminadas (Por hacer, En progreso,
    En revision y Hecho, con sus valores originales) que no tengan tareas asignadas. Las columnas personalizadas
    o con tareas no se tocan.

    @author Citlaly Morales Viveros
*/
BEGIN;

DELETE FROM columnas_tablero ct
USING (
    VALUES
        ('Por hacer', 1, 5, FALSE),
        ('En progreso', 2, 3, FALSE),
        ('En revision', 3, NULL, FALSE),
        ('Hecho', 4, NULL, TRUE)
) AS c (nombre, orden, limite_wip, es_final)
WHERE
    ct.nombre = c.nombre
    AND ct.orden = c.orden
    AND ct.limite_wip IS NOT DISTINCT FROM c.limite_wip
    AND ct.es_final = c.es_final
    AND ct.wip_duro = FALSE
    AND NOT EXISTS (
        SELECT 1
        FROM tareas t
        WHERE t.columna_id = ct.id
    );

COMMIT;