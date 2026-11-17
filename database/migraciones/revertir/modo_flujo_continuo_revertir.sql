-- Responsable: Alfonso - HU-26: revierte modo_flujo_continuo.sql.
/**
    @file modo_flujo_continuo_revertir.sql
    @description Revierte modo_flujo_continuo.sql: quita la columna proyectos.modo_flujo y su restricción.
    ADVERTENCIA: se pierde qué proyectos estaban en modo continuo; todos vuelven a comportarse como Scrum.
    No borra tareas, historias, historial ni sprints. Las tareas creadas sin sprint se conservan,
    pero no se podrán editar desde Planificación hasta asignar su historia a un sprint.

    @author Alfonso Mendoza Vasquez
*/
BEGIN;

ALTER TABLE proyectos
DROP CONSTRAINT IF EXISTS proyectos_modo_flujo_check;

ALTER TABLE proyectos
DROP COLUMN IF EXISTS modo_flujo;

COMMIT;
