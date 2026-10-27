-- Revierte la migracion sesiones.sql: elimina la tabla sesiones (ninguna otra tabla depende de ella).
-- Al revertir tambien hay que volver al codigo anterior, porque los tokens nuevos llevan sid.
--   psql -U postgres -d scrumflow -f .\database\migraciones\sesiones_revertir.sql

DROP TABLE IF EXISTS sesiones;
