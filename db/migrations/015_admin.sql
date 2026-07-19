-- Log de auditoria das ações administrativas (moderações, planos, equipe).
BEGIN;

CREATE TABLE audit_log (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  admin_name TEXT NOT NULL,
  action     TEXT NOT NULL,       -- ex.: 'producer.approved', 'plan.changed'
  target     TEXT NOT NULL,       -- descrição legível do alvo
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

COMMIT;
