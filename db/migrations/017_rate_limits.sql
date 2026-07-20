-- Rate-limit persistente (opcional): usado quando RATE_LIMIT_STORE=db, para
-- funcionar com múltiplas instâncias do servidor. Sem isso, o limite fica em
-- memória (padrão, suficiente para instância única).
BEGIN;

CREATE TABLE rate_limits (
  bucket     TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_rate_limits_reset ON rate_limits (reset_at);

COMMIT;
