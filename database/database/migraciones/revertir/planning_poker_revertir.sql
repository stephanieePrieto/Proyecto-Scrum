/**
    @file planning_poker_revertir.sql
    @description Revierte planning_poker.sql: elimina las tablas poker_votos y poker_sesiones, incluidos sus votos.
    Ejecutar despues de planning_poker_historial_revertir.sql.

    @author Citlaly Morales Viveros
*/
DROP TABLE IF EXISTS poker_votos;
DROP TABLE IF EXISTS poker_sesiones;