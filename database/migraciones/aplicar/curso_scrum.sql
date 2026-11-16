/**
  @file curso_scrum.sql
  @description Crea las tablas, índices y ajusta la columna posicion_scroll a INTEGER del microcurso de Scrum.
  Esquema de base de datos del microcurso de Scrum, basado en la Guía de Scrum.

  @author Stephanie Elizdeth Hernández Prieto
*/

-- Configuración de codificación UTF-8 para evitar errores de acentos
SET
  client_encoding = 'UTF8';

-- 1. TABLA: curso_lecciones
CREATE TABLE
  IF NOT EXISTS curso_lecciones (
    id SERIAL PRIMARY KEY,
    orden INTEGER NOT NULL UNIQUE,
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    seccion TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW ()
  );

CREATE INDEX IF NOT EXISTS ix_curso_lecciones_orden ON curso_lecciones (orden);

-- 2. TABLA: curso_progreso_lecciones
CREATE TABLE
  IF NOT EXISTS curso_progreso_lecciones (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    leccion_id INTEGER NOT NULL REFERENCES curso_lecciones (id) ON DELETE CASCADE,
    completada BOOLEAN NOT NULL DEFAULT FALSE,
    posicion_scroll INTEGER NOT NULL DEFAULT 0, -- Definido como INTEGER para evitar desbordamiento numeric
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (usuario_id, leccion_id)
  );

CREATE INDEX IF NOT EXISTS ix_curso_progreso_usuario ON curso_progreso_lecciones (usuario_id);

CREATE INDEX IF NOT EXISTS ix_curso_progreso_leccion ON curso_progreso_lecciones (leccion_id);

-- 3. TABLA: curso_quizzes
CREATE TABLE
  IF NOT EXISTS curso_quizzes (
    id SERIAL PRIMARY KEY,
    leccion_id INTEGER NOT NULL REFERENCES curso_lecciones (id) ON DELETE CASCADE,
    pregunta TEXT NOT NULL,
    opciones JSONB NOT NULL,
    respuesta_correcta INTEGER NOT NULL
  );

CREATE INDEX IF NOT EXISTS ix_curso_quizzes_leccion ON curso_quizzes (leccion_id);

-- 4. TABLA: curso_intentos_quizzes
CREATE TABLE
  IF NOT EXISTS curso_intentos_quizzes (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    leccion_id INTEGER NOT NULL REFERENCES curso_lecciones (id) ON DELETE CASCADE,
    calificacion NUMERIC(5, 2) NOT NULL DEFAULT 0,
    aprobado BOOLEAN NOT NULL DEFAULT FALSE,
    intentos INTEGER NOT NULL DEFAULT 1,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (usuario_id, leccion_id)
  );

CREATE INDEX IF NOT EXISTS ix_curso_intentos_usuario ON curso_intentos_quizzes (usuario_id);

CREATE INDEX IF NOT EXISTS ix_curso_intentos_leccion ON curso_intentos_quizzes (leccion_id);

-- 5. TABLA: curso_certificados
CREATE TABLE
  IF NOT EXISTS curso_certificados (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    emitido_en TIMESTAMPTZ NOT NULL DEFAULT NOW (),
    UNIQUE (usuario_id)
  );

CREATE INDEX IF NOT EXISTS ix_curso_certificados_usuario ON curso_certificados (usuario_id);

-- Asegurar tipo INTEGER en instalaciones previas de la BD
ALTER TABLE curso_progreso_lecciones
ALTER COLUMN posicion_scroll TYPE INTEGER USING ROUND(posicion_scroll);