-- Separa al propietario de la bitacora del usuario con el que se conecta la aplicacion.
-- La aplicacion queda solo con SELECT e INSERT sobre la tabla y USAGE sobre su secuencia, de modo que no puede
-- hacer UPDATE, DELETE ni TRUNCATE, ni desactivar o eliminar el trigger, ni reemplazar su funcion, ni borrar la tabla.
--
-- Se ejecuta a mano con un rol que sea superusuario o miembro de ambos roles:
--   psql -d BASE -v rol_app=USUARIO_DE_LA_APP -v rol_propietario=ROL_PROPIETARIO -f bitacora_permisos.sql
--
-- Requisitos: ambos roles ya existen, son distintos, y rol_app no es superusuario ni miembro de rol_propietario.
-- Es seguro correrlo varias veces. No borra ni modifica registros.
--
-- @author Citlaly Morales Viveros
\set ON_ERROR_STOP on

SELECT set_config('bitacora.rol_app', :'rol_app', false);
SELECT set_config('bitacora.rol_propietario', :'rol_propietario', false);

DO $$
DECLARE
  app TEXT := current_setting('bitacora.rol_app');
  propietario TEXT := current_setting('bitacora.rol_propietario');
BEGIN
  IF app = propietario THEN
    RAISE EXCEPTION 'rol_app y rol_propietario deben ser roles distintos.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app) THEN
    RAISE EXCEPTION 'El rol de la aplicacion "%" no existe.', app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = propietario) THEN
    RAISE EXCEPTION 'El rol propietario "%" no existe.', propietario;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = app) THEN
    RAISE EXCEPTION 'El rol de la aplicacion "%" es superusuario: ningun permiso ni trigger lo limita.', app;
  END IF;
  IF pg_has_role(app, propietario, 'USAGE') THEN
    RAISE EXCEPTION 'El rol de la aplicacion "%" hereda los privilegios de "%": quitale esa pertenencia.', app, propietario;
  END IF;
END
$$;

ALTER TABLE bitacora OWNER TO :"rol_propietario";
ALTER FUNCTION bloquear_cambios_bitacora() OWNER TO :"rol_propietario";

REVOKE ALL ON TABLE bitacora FROM PUBLIC;
REVOKE ALL ON TABLE bitacora FROM :"rol_app";
GRANT SELECT, INSERT ON TABLE bitacora TO :"rol_app";

REVOKE ALL ON SEQUENCE bitacora_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE bitacora_id_seq FROM :"rol_app";
GRANT USAGE ON SEQUENCE bitacora_id_seq TO :"rol_app";
