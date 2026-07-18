-- Marketplace de verdade: preço nos anúncios, dados de evento e reservas.
BEGIN;

-- Preço opcional (NULL = "sob consulta") e unidade de venda ("500g", "por pessoa"…)
ALTER TABLE listings ADD COLUMN price_cents INTEGER CHECK (price_cents > 0);
ALTER TABLE listings ADD COLUMN price_unit  TEXT;

-- Eventos: quando e onde acontecem (só faz sentido para type = 'event')
ALTER TABLE listings ADD COLUMN event_date  DATE;
ALTER TABLE listings ADD COLUMN event_time  TEXT;
ALTER TABLE listings ADD COLUMN event_place TEXT;

-- Reservas/pedidos: turista solicita, produtor confirma/recusa e conclui.
-- Ao concluir, vira uma transação real (alimenta o dashboard do admin).
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'declined', 'completed', 'cancelled');

CREATE TABLE bookings (
  id             SERIAL PRIMARY KEY,
  listing_id     INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  tourist_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  producer_id    INTEGER NOT NULL REFERENCES producers (id) ON DELETE CASCADE,
  status         booking_status NOT NULL DEFAULT 'pending',
  qty            INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  requested_date DATE,
  note           TEXT,
  client_uid     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at   TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  UNIQUE (tourist_id, client_uid)
);
CREATE INDEX idx_bookings_producer ON bookings (producer_id, status);
CREATE INDEX idx_bookings_tourist ON bookings (tourist_id, created_at);

COMMIT;
