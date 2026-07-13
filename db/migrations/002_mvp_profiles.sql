-- MVP completo: usuários multi-perfil, estabelecimentos, roteiros do turista,
-- favoritos e chat assimétrico turista ↔ produtor.
BEGIN;

-- ─── Usuários com papéis ────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('tourist', 'producer', 'admin');

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- scrypt$<salt>$<hash>
  role          user_role NOT NULL,
  city          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migra os admins existentes e aposenta a tabela antiga
INSERT INTO users (name, email, password_hash, role, created_at)
SELECT name, email, password_hash, 'admin', created_at FROM admins;
DROP TABLE admins;

-- Vínculos de conta
ALTER TABLE producers ADD COLUMN user_id INTEGER UNIQUE REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE tourists  ADD COLUMN user_id INTEGER UNIQUE REFERENCES users (id) ON DELETE SET NULL;

-- ─── Estabelecimentos (vitrine/perfil do produtor) ──────────────────────────
CREATE TABLE establishments (
  id          SERIAL PRIMARY KEY,
  producer_id INTEGER NOT NULL UNIQUE REFERENCES producers (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  city        TEXT,
  address     TEXT,
  phone       TEXT,
  open_hours  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Roteiros personalizados do turista (offline-first) ─────────────────────
-- client_uid é gerado no dispositivo: garante idempotência na sincronização.
CREATE TABLE trips (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_uid TEXT NOT NULL,
  title      TEXT NOT NULL,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_uid)
);

CREATE TABLE trip_items (
  id               SERIAL PRIMARY KEY,
  trip_id          INTEGER NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  client_uid       TEXT NOT NULL,
  position         INTEGER NOT NULL DEFAULT 0,
  listing_id       INTEGER REFERENCES listings (id) ON DELETE SET NULL,
  establishment_id INTEGER REFERENCES establishments (id) ON DELETE SET NULL,
  label            TEXT,                -- parada livre (sem vínculo)
  note             TEXT,
  UNIQUE (trip_id, client_uid)
);
CREATE INDEX idx_trip_items_trip ON trip_items (trip_id, position);

-- ─── Favoritos ──────────────────────────────────────────────────────────────
CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

-- ─── Chat assimétrico turista ↔ produtor ────────────────────────────────────
CREATE TABLE conversations (
  id          SERIAL PRIMARY KEY,
  tourist_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  producer_id INTEGER NOT NULL REFERENCES producers (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tourist_id, producer_id)
);

CREATE TABLE messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_uid      TEXT,                 -- idempotência do envio offline
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ,
  UNIQUE (conversation_id, client_uid)
);
CREATE INDEX idx_messages_conv ON messages (conversation_id, created_at);

COMMIT;
