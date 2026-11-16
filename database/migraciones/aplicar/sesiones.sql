/** 
  @file sesiones.sql
  @description Sesiones (control de inactividad por sesion). Cada inicio de sesion crea una fila; el sid viaja dentro de los tokens.
  ultima_actividad solo avanza cuando la persona interactua con la pantalla (no con renovaciones ni peticiones de fondo).

  @author Citlaly Morales Viveros
*/
CREATE TABLE
  IF NOT EXISTS sesiones (
    id UUID PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    cerrada_en TIMESTAMPTZ
  );

CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON sesiones (usuario_id);