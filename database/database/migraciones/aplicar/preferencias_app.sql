/**
    @file preferencias_app.sql
    @description Preferencias de apariencia y accesibilidad (tema, texto grande, alto contraste y animaciones).

    @author Citlaly Morales Viveros
 */
BEGIN;

ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS preferencias_app JSONB NOT NULL DEFAULT CAST(
    '{"tema": "sistema", "textoGrande": false, "altoContraste": false, "reducirAnimaciones": false}' AS jsonb
);

COMMIT;