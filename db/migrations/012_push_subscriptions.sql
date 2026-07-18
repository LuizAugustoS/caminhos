-- Web Push: inscrições de notificação por usuário/dispositivo.
-- Um usuário pode ter várias (celular + desktop); endpoint identifica o aparelho.
BEGIN;

CREATE TABLE push_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

COMMIT;
