-- Caminhos do Caparaó — schema inicial
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Usuários administrativos ───────────────────────────────────────────────
CREATE TABLE admins (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- formato: scrypt$<salt-hex>$<hash-hex>
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Turistas ───────────────────────────────────────────────────────────────
CREATE TABLE tourists (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  city       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tourists_created_at ON tourists (created_at);

-- ─── Produtores / comerciantes ──────────────────────────────────────────────
CREATE TYPE approval_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');

CREATE TABLE producers (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,            -- ex.: "Café especial · Alto Caparaó"
  initials     TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#1C6B4A',
  status       approval_status NOT NULL DEFAULT 'pending',
  city         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ
);
CREATE INDEX idx_producers_status ON producers (status);

-- ─── Anúncios (produtos, serviços e eventos) ────────────────────────────────
CREATE TYPE listing_type AS ENUM ('product', 'service', 'event');

CREATE TABLE listings (
  id          SERIAL PRIMARY KEY,
  producer_id INTEGER NOT NULL REFERENCES producers (id) ON DELETE CASCADE,
  type        listing_type NOT NULL,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  image_label TEXT,                      -- descrição da imagem (mock sem upload)
  image_kind  TEXT NOT NULL DEFAULT 'cafe',  -- cafe | arte | verde | sage (gradiente do card)
  glyph       TEXT NOT NULL DEFAULT '◉',
  status      approval_status NOT NULL DEFAULT 'pending',
  listed_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_listings_type_status ON listings (type, status);
CREATE INDEX idx_listings_created_at ON listings (created_at);

-- ─── Transações do marketplace ──────────────────────────────────────────────
CREATE TABLE transactions (
  id           SERIAL PRIMARY KEY,
  listing_id   INTEGER REFERENCES listings (id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_created_at ON transactions (created_at);

-- ─── Buscas dos turistas (mapa de calor 12×6) ───────────────────────────────
CREATE TABLE search_events (
  id         SERIAL PRIMARY KEY,
  spot       TEXT NOT NULL,              -- ex.: "Pico da Bandeira"
  grid_row   SMALLINT NOT NULL CHECK (grid_row BETWEEN 0 AND 5),
  grid_col   SMALLINT NOT NULL CHECK (grid_col BETWEEN 0 AND 11),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_events_created ON search_events (created_at);
CREATE INDEX idx_search_events_cell ON search_events (grid_row, grid_col);

-- ─── Itinerários (disponíveis offline no PWA) ───────────────────────────────
CREATE TABLE itineraries (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  region        TEXT,
  duration      TEXT,
  offline_ready BOOLEAN NOT NULL DEFAULT false,
  published     BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Chat interno ───────────────────────────────────────────────────────────
CREATE TABLE chat_messages (
  id              SERIAL PRIMARY KEY,
  sender_name     TEXT NOT NULL,
  sender_initials TEXT NOT NULL,
  avatar_color    TEXT NOT NULL DEFAULT '#1C6B4A',
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_created ON chat_messages (created_at);

-- ─── Alertas do sistema ─────────────────────────────────────────────────────
CREATE TABLE alerts (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  meta       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info',  -- info | warning | success
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
