UPDATE columnas_tablero actual
   SET nombre = cambios.nombre_nuevo
  FROM (VALUES
    ('Por hacer', 'Por empezar', 1),
    ('En revision', 'En revisión', 3),
    ('Hecho', 'Terminado', 4)
  ) AS cambios(nombre_anterior, nombre_nuevo, orden)
 WHERE actual.nombre = cambios.nombre_anterior
   AND actual.orden = cambios.orden
   AND NOT EXISTS (
     SELECT 1
       FROM columnas_tablero duplicada
      WHERE duplicada.proyecto_id = actual.proyecto_id
        AND duplicada.nombre = cambios.nombre_nuevo
   );
