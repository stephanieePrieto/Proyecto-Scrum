BEGIN;

UPDATE columnas_tablero AS actual
   SET nombre = U&'En revisi\00F3n'
 WHERE actual.nombre = U&'En revisi\00C3\00B3n'
   AND actual.orden = 3
   AND NOT EXISTS (
       SELECT 1
         FROM columnas_tablero AS duplicada
        WHERE duplicada.proyecto_id = actual.proyecto_id
          AND duplicada.nombre = U&'En revisi\00F3n'
   );

COMMIT;
