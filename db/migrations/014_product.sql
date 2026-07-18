-- Produto: busca sem acento, pausa de anúncio e contador de visualizações.
BEGIN;

-- Busca ignorando acentos sem depender da extensão unaccent (que exige
-- privilégio em alguns provedores): função imutável de transliteração.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS $$
  SELECT translate(lower($1),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ',
    'aaaaaaeeeeiiiiooooouuuucnyy')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Pausar/reativar anúncio sem excluir (some do Explorar, volta quando quiser)
ALTER TABLE listings ADD COLUMN available BOOLEAN NOT NULL DEFAULT true;

-- Visualizações de detalhe por dia (estatística para o produtor)
CREATE TABLE listing_views (
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  day        DATE NOT NULL DEFAULT CURRENT_DATE,
  views      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day)
);

COMMIT;
