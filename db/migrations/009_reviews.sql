-- Avaliações: turista avalia o anúncio após uma reserva concluída.
-- Uma avaliação por reserva (editável); admin pode ocultar (moderação).
BEGIN;

CREATE TABLE reviews (
  id          SERIAL PRIMARY KEY,
  booking_id  INTEGER NOT NULL UNIQUE REFERENCES bookings (id) ON DELETE CASCADE,
  listing_id  INTEGER NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  producer_id INTEGER NOT NULL REFERENCES producers (id) ON DELETE CASCADE,
  tourist_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  hidden      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_listing ON reviews (listing_id) WHERE NOT hidden;
CREATE INDEX idx_reviews_producer ON reviews (producer_id) WHERE NOT hidden;

COMMIT;
