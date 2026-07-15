-- Fotos reais nos anúncios (upload pela vitrine do produtor).
-- image_path aponta para /uploads/<arquivo>; quando nulo, a UI usa o
-- gradiente do design (image_kind) como capa.
BEGIN;

ALTER TABLE listings ADD COLUMN image_path TEXT;

COMMIT;
