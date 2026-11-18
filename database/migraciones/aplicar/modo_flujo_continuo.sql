/**
    @file modo_flujo_continuo.sql
    @description Agrega proyectos.modo_flujo para que un proyecto pueda trabajar sin sprints (Kanban continuo).
    Todos los proyectos existentes quedan en 'scrum', así que ninguno cambia de comportamiento.
    No modifica ni borra filas. Es seguro correrlo varias veces.
    Para revertir: migraciones/revertir/modo_flujo_continuo_revertir.sql

    @author Alfonso Mendoza Vasquez
*/
BEGIN;

ALTER TABLE proyectos
ADD COLUMN IF NOT EXISTS modo_flujo TEXT NOT NULL DEFAULT 'scrum';

ALTER TABLE proyectos
DROP CONSTRAINT IF EXISTS proyectos_modo_flujo_check;

ALTER TABLE proyectos
ADD CONSTRAINT proyectos_modo_flujo_check CHECK (modo_flujo IN ('scrum', 'continuo'));

COMMIT;
