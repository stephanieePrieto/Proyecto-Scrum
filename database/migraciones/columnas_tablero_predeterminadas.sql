-- Los limites WIP (5 y 3) deben coincidir con el INSERT de columnas por defecto de seed.sql. Si cambias uno, cambia el otro.
-- Columnas predeterminadas del tablero para los proyectos que todavía no tienen ninguna.
-- No borra ni modifica columnas existentes: un proyecto con columnas propias (aunque sea una sola)
-- queda intacto. Es seguro correrla varias veces. Va aparte de schema.sql porque solo agrega filas.
INSERT INTO
  columnas_tablero (proyecto_id, nombre, orden, limite_wip, es_final)
SELECT
  p.id,
  c.nombre,
  c.orden,
  c.limite_wip,
  c.es_final
FROM
  proyectos p
  CROSS JOIN (
    VALUES
      ('Por hacer', 1, 5, FALSE),
      ('En progreso', 2, 3, FALSE),
      ('En revision', 3, NULL, FALSE),
      ('Hecho', 4, NULL, TRUE)
  ) AS c (nombre, orden, limite_wip, es_final)
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      columnas_tablero ct
    WHERE
      ct.proyecto_id = p.id
  ) ON CONFLICT (proyecto_id, nombre) DO NOTHING;