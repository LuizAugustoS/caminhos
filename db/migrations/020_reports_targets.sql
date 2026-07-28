-- Denúncias genéricas: além de anúncios, a equipe passa a moderar denúncias
-- sobre PRODUTORES (feitas por turistas) e TURISTAS (feitas por produtores).
-- Reaproveita a tabela listing_reports, agora polimórfica via target_type/target_id.

ALTER TABLE listing_reports ADD COLUMN target_type TEXT NOT NULL DEFAULT 'listing';
ALTER TABLE listing_reports ADD COLUMN target_id INTEGER;

-- Backfill: denúncias existentes são todas de anúncios.
UPDATE listing_reports SET target_id = listing_id WHERE target_id IS NULL;

-- listing_id deixa de ser obrigatório (denúncias de produtor/turista não o têm).
ALTER TABLE listing_reports ALTER COLUMN listing_id DROP NOT NULL;

-- Um usuário não abre duas denúncias abertas para o mesmo alvo (genérico).
DROP INDEX IF EXISTS uniq_open_report_per_user;
CREATE UNIQUE INDEX uniq_open_report_per_target_user
  ON listing_reports (target_type, target_id, reporter_id)
  WHERE status = 'open' AND reporter_id IS NOT NULL;

CREATE INDEX idx_reports_target ON listing_reports (target_type, target_id, status);
