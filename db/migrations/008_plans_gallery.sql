-- Planos de produtor (cobrança fora da plataforma) e galeria de fotos por anúncio.
BEGIN;

-- Plano do produtor: define limites de anúncios/fotos, destaque e selo.
CREATE TYPE producer_plan AS ENUM ('gratuito', 'profissional', 'premium');
ALTER TABLE producers ADD COLUMN plan producer_plan NOT NULL DEFAULT 'gratuito';

-- Galeria: várias fotos por anúncio. listings.image_path segue existindo como
-- a capa (primeira foto da galeria), mantida em sincronia pela API.
CREATE TABLE listing_images (
  id         SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listing_images ON listing_images (listing_id, position, id);

-- A foto única enviada antes da galeria vira a primeira foto
INSERT INTO listing_images (listing_id, path, position)
SELECT id, image_path, 0 FROM listings WHERE image_path IS NOT NULL;

COMMIT;
