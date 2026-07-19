-- Segurança de conta: verificação de e-mail e revogação de sessões.
BEGIN;

-- Verificação de e-mail (não bloqueia o uso; dá confiança à base)
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE email_verifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_verifications_user ON email_verifications (user_id);

-- Revogação de sessões: o cookie carrega a época; trocar a senha (ou
-- excluir a conta) incrementa a época e derruba as sessões antigas.
ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;

COMMIT;
