-- Limita cada proyecto a un solo Scrum Master. No borra ni modifica datos: si ya existen proyectos
-- con más de un Scrum Master, se detiene con un aviso para que se corrija primero a mano.
DO $$
DECLARE
  duplicados TEXT;
BEGIN
  SELECT string_agg(proyecto_id::text, ', ') INTO duplicados
  FROM (
    SELECT proyecto_id FROM miembros_proyecto
    WHERE rol = 'scrum_master'
    GROUP BY proyecto_id HAVING COUNT(*) > 1
  ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION 'Proyectos con más de un Scrum Master (ids: %). Deja uno solo en cada proyecto y vuelve a ejecutar la migración.', duplicados;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_un_scrum_master_por_proyecto ON miembros_proyecto (proyecto_id)
WHERE rol = 'scrum_master';