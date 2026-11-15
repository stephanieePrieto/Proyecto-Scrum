/** 
    @file sesiones_revertir.sql
    @description Revierte la migracion sesiones.sql: elimina la tabla sesiones (ninguna otra tabla depende de ella).

    @author Citlaly Morales Viveros
*/
DROP TABLE IF EXISTS sesiones;