-- Recuperação de senha: tokens de uso único com validade de 1 hora.
-- Guardamos apenas o hash SHA-256 do token — o valor real vai só no e-mail.
BEGIN;

CREATE TABLE password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_resets_user ON password_resets (user_id);

COMMIT;
