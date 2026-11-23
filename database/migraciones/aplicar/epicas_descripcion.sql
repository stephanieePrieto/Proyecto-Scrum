-- Sprint 6 / C2: agregar descripcion a las epicas existentes.
-- Conserva las epicas y sus datos actuales.
-- Las nuevas epicas deben validar descripcion obligatoria en el backend.
BEGIN;
ALTER TABLE public.epicas
    ADD COLUMN IF NOT EXISTS descripcion TEXT;
COMMIT;
