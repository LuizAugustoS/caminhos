// Avaliações do marketplace: o turista avalia um anúncio depois que a
// reserva foi concluída pelo produtor. Uma avaliação por reserva, editável.
// O admin modera ocultando/exibindo (a avaliação some das médias públicas).
import { Router } from 'express';
import { query } from '../db.js';
import { audit } from '../audit.js';

export const reviews = Router();       // /api/reviews (turista)
export const adminReviews = Router();  // /api/admin/reviews (admin)

reviews.post('/', async (req, res) => {
  const { booking_id, rating, comment } = req.body || {};
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'A nota deve ser de 1 a 5 estrelas' });
  }
  const { rows: [b] } = await query(
    `SELECT id, listing_id, producer_id FROM bookings
     WHERE id = $1 AND tourist_id = $2 AND status = 'completed'`,
    [Number(booking_id), req.user.id]
  );
  if (!b) return res.status(404).json({ error: 'Só é possível avaliar reservas concluídas' });

  const { rows: [r] } = await query(
    `INSERT INTO reviews (booking_id, listing_id, producer_id, tourist_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (booking_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
     RETURNING id, booking_id, rating, comment, created_at`,
    [b.id, b.listing_id, b.producer_id, req.user.id, stars, (comment || '').trim() || null]
  );
  res.status(201).json(r);
});

// Moderação: ocultar/exibir uma avaliação
adminReviews.post('/:id/visibility', async (req, res) => {
  const { hidden } = req.body || {};
  if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'hidden deve ser true ou false' });
  const { rows } = await query(
    'UPDATE reviews SET hidden = $1 WHERE id = $2 RETURNING id, hidden',
    [hidden, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Avaliação não encontrada' });
  audit(req, hidden ? 'review.hidden' : 'review.shown', `avaliação #${rows[0].id}`);
  res.json(rows[0]);
});
