/**
    @file curso_scrum_revertir.sql
    @description Revierte la migración del microcurso de Scrum eliminando sus tablas en orden inverso (los índices se eliminan junto con cada tabla).
    Elimina también el progreso, los intentos de quiz y los certificados del microcurso. No elimina la tabla usuarios.

    @author Stephanie Elizdeth Hernández Prieto
*/
DROP TABLE IF EXISTS curso_certificados;

DROP TABLE IF EXISTS curso_intentos_quizzes;

DROP TABLE IF EXISTS curso_quizzes;

DROP TABLE IF EXISTS curso_progreso_lecciones;

DROP TABLE IF EXISTS curso_lecciones;