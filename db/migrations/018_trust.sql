-- Confiança: selo de produtor verificado e denúncia de anúncios.

-- Selo "Verificado" — reconhecimento da equipe, independente do plano pago.
ALTER TABLE producers ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;

-- Denúncias de anúncios feitas por turistas; a equipe modera pela fila.
CREATE TABLE listing_reports (
  id          SERIAL PRIMARY KEY,
  listing_id  INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,                       -- motivo (categoria)
  detail      TEXT,                                -- descrição opcional
  status      TEXT NOT NULL DEFAULT 'open',        -- open | reviewed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_listing_reports_status ON listing_reports (status);
-- Um mesmo usuário não abre duas denúncias abertas para o mesmo anúncio.
CREATE UNIQUE INDEX uniq_open_report_per_user
  ON listing_reports (listing_id, reporter_id)
  WHERE status = 'open' AND reporter_id IS NOT NULL;
