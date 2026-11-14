-- Preferencias de apariencia y accesibilidad (tema, texto grande, alto contraste y animaciones).
-- Autora: Citlaly Morales Viveros
-- Agrega la columna con su valor por defecto. No modifica filas existentes: quedan con los valores por defecto.

BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS preferencias_app JSONB NOT NULL DEFAULT
    '{"tema": "sistema", "textoGrande": false, "altoContraste": false, "reducirAnimaciones": false}'::jsonb;

COMMIT;