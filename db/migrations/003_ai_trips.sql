-- Roteiros gerados por IA: guarda a origem e as preferências informadas
-- pelo turista, para consulta posterior.
BEGIN;

ALTER TABLE trips ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
  CHECK (origin IN ('manual', 'ai'));
ALTER TABLE trips ADD COLUMN preferences JSONB;

COMMIT;
