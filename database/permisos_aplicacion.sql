-- Crea, si no existen, el rol propietario de la estructura y el rol con el que se conecta la aplicacion.
-- Transfiere al propietario las tablas, vistas, secuencias y funciones del esquema public (excepto las de la bitacora, que
-- maneja bitacora_permisos.sql) y deja a la aplicacion solo con permisos de lectura y escritura de datos.
-- No define contrasenas: la del rol de la aplicacion se establece despues con \password.
--
-- Se ejecuta con un superusuario, antes de bitacora_permisos.sql:
--   psql -U postgres -d BASE -v rol_app=scrumflow_app -v rol_propietario=scrumflow_admin -f permisos_aplicacion.sql
--
-- Es seguro correrlo varias veces. Volver a correrlo, y despues bitacora_permisos.sql, cuando se agreguen tablas
-- nuevas al esquema. No borra ni modifica registros.
--
-- @author Citlaly Morales Viveros
\set ON_ERROR_STOP on

SELECT set_config('permisos.rol_app', :'rol_app', false);
SELECT set_config('permisos.rol_propietario', :'rol_propietario', false);

DO $$
DECLARE
  app TEXT := current_setting('permisos.rol_app');
  propietario TEXT := current_setting('permisos.rol_propietario');
  nombre TEXT;
BEGIN
  IF app = propietario THEN
    RAISE EXCEPTION 'rol_app y rol_propietario deben ser roles distintos.';
  END IF;
  FOREACH nombre IN ARRAY ARRAY[app, propietario] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = nombre AND rolsuper) THEN
      RAISE EXCEPTION 'El rol "%" es superusuario y no puede usarse como rol de la aplicacion ni como propietario.', nombre;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app) THEN
    EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', app);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = propietario) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION', propietario);
  END IF;
END
$$;

GRANT USAGE, CREATE ON SCHEMA public TO :"rol_propietario";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"rol_app";
GRANT USAGE ON SCHEMA public TO :"rol_app";

DO $$
DECLARE
  app TEXT := current_setting('permisos.rol_app');
  propietario TEXT := current_setting('permisos.rol_propietario');
  objeto RECORD;
BEGIN
  FOR objeto IN SELECT tablename AS nombre FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'bitacora' ORDER BY tablename LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', objeto.nombre, propietario);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', objeto.nombre, app);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', objeto.nombre, app);
  END LOOP;

  FOR objeto IN SELECT viewname AS nombre FROM pg_views WHERE schemaname = 'public' ORDER BY viewname LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO %I', objeto.nombre, propietario);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', objeto.nombre, app);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I', objeto.nombre, app);
  END LOOP;

  FOR objeto IN SELECT sequencename AS nombre FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> 'bitacora_id_seq' ORDER BY sequencename LOOP
    IF (SELECT sequenceowner FROM pg_sequences WHERE schemaname = 'public' AND sequencename = objeto.nombre) <> propietario THEN
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', objeto.nombre, propietario);
    END IF;
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM %I', objeto.nombre, app);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I', objeto.nombre, app);
  END LOOP;

  FOR objeto IN
    SELECT p.proname AS nombre, pg_get_function_identity_arguments(p.oid) AS argumentos
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'bloquear_cambios_bitacora'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) OWNER TO %I', objeto.nombre, objeto.argumentos, propietario);
  END LOOP;
END
$$;
