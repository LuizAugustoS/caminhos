-- Geolocalização dos estabelecimentos: coordenadas para o mapa do Explorar
-- e o "como chegar". Opcionais — o produtor marca o ponto no próprio perfil.
BEGIN;

ALTER TABLE establishments
  ADD COLUMN lat DOUBLE PRECISION CHECK (lat BETWEEN -90 AND 90),
  ADD COLUMN lng DOUBLE PRECISION CHECK (lng BETWEEN -180 AND 180);

COMMIT;
