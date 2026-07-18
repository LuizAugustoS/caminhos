// Reservas/pedidos do marketplace.
// Turista solicita em um anúncio aprovado; o produtor confirma, recusa ou
// conclui. Concluir registra uma transação real (dashboard do admin).
import { Router } from 'express';
import { query } from '../db.js';
import { notify } from './events.js';

export const bookings = Router();        // /api/bookings (turista)
export const portalBookings = Router();  // /api/portal/bookings (produtor; recebe req.producer)

const BOOKING_LABEL = {
  pending: 'Aguardando produtor', confirmed: 'Confirmada', declined: 'Recusada',
  completed: 'Concluída', cancelled: 'Cancelada',
};

// ─── Turista ────────────────────────────────────────────────────────────────
bookings.post('/', async (req, res) => {
  if (req.user.role !== 'tourist') return res.status(403).json({ error: 'Apenas turistas fazem reservas' });
  const { listing_id, qty, requested_date, note, client_uid } = req.body || {};
  const n = Math.max(1, Math.min(Number(qty) || 1, 50));
  const { rows: [l] } = await query(
    `SELECT l.id, l.title, l.producer_id, l.price_cents, l.price_unit, p.user_id AS producer_user_id
     FROM listings l JOIN producers p ON p.id = l.producer_id
     WHERE l.id = $1 AND l.status = 'approved' AND p.status = 'approved'`,
    [Number(listing_id)]
  );
  if (!l) return res.status(404).json({ error: 'Anúncio não encontrado ou indisponível' });

  const { rows: [b] } = await query(
    `INSERT INTO bookings (listing_id, tourist_id, producer_id, qty, requested_date, note, client_uid)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tourist_id, client_uid) DO UPDATE SET client_uid = EXCLUDED.client_uid
     RETURNING *`,
    [l.id, req.user.id, l.producer_id, n, requested_date || null,
     (note || '').trim() || null, client_uid || null]
  );

  // A reserva também vira mensagem na conversa — o produtor vê o contexto no chat
  const { rows: [conv] } = await query(
    `INSERT INTO conversations (tourist_id, producer_id) VALUES ($1, $2)
     ON CONFLICT (tourist_id, producer_id) DO UPDATE SET tourist_id = EXCLUDED.tourist_id
     RETURNING id`,
    [req.user.id, l.producer_id]
  );
  const when = b.requested_date ? ` para ${new Date(b.requested_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : '';
  await query(
    `INSERT INTO messages (conversation_id, sender_id, client_uid, body)
     VALUES ($1, $2, $3, $4) ON CONFLICT (conversation_id, client_uid) DO NOTHING`,
    [conv.id, req.user.id, `booking-${b.id}`,
     `Pedido de reserva: ${b.qty} × ${l.title}${when}.${b.note ? ` Obs.: ${b.note}` : ''}`]
  );

  if (l.producer_user_id) {
    notify(l.producer_user_id, 'booking', { id: b.id, title: l.title, from: req.user.name });
    notify(l.producer_user_id, 'chat', { conversation_id: conv.id, from: req.user.name });
  }
  res.status(201).json({ ...b, status_label: BOOKING_LABEL[b.status] });
});

bookings.get('/', async (req, res) => {
  if (req.user.role !== 'tourist') return res.status(403).json({ error: 'Apenas turistas' });
  const { rows } = await query(
    `SELECT b.*, l.title, l.price_cents, l.price_unit, l.image_path, l.image_kind, l.glyph,
            p.name AS producer_name, p.id AS producer_id,
            r.rating AS my_rating, r.comment AS my_comment
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN producers p ON p.id = b.producer_id
     LEFT JOIN reviews r ON r.booking_id = b.id
     WHERE b.tourist_id = $1
     ORDER BY b.created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ bookings: rows.map(b => ({ ...b, status_label: BOOKING_LABEL[b.status] })) });
});

bookings.post('/:id/cancel', async (req, res) => {
  const { rows: [b] } = await query(
    `UPDATE bookings SET status = 'cancelled', responded_at = now()
     WHERE id = $1 AND tourist_id = $2 AND status = 'pending'
     RETURNING id, producer_id`,
    [req.params.id, req.user.id]
  );
  if (!b) return res.status(404).json({ error: 'Reserva não encontrada ou já respondida' });
  const { rows: [p] } = await query('SELECT user_id FROM producers WHERE id = $1', [b.producer_id]);
  if (p?.user_id) notify(p.user_id, 'booking', { id: b.id });
  res.json({ ok: true });
});

// ─── Produtor ───────────────────────────────────────────────────────────────
portalBookings.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, l.title, l.price_cents, l.price_unit, u.name AS tourist_name
     FROM bookings b
     JOIN listings l ON l.id = b.listing_id
     JOIN users u ON u.id = b.tourist_id
     WHERE b.producer_id = $1
     ORDER BY (b.status = 'pending') DESC, b.created_at DESC LIMIT 100`,
    [req.producer.id]
  );
  const pending = rows.filter(b => b.status === 'pending').length;
  res.json({ bookings: rows.map(b => ({ ...b, status_label: BOOKING_LABEL[b.status] })), pending });
});

const TRANSITIONS = {
  confirmed: ['pending'],
  declined: ['pending'],
  completed: ['confirmed'],
};

portalBookings.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!TRANSITIONS[status]) return res.status(400).json({ error: 'status deve ser confirmed, declined ou completed' });
  const { rows: [b] } = await query(
    `UPDATE bookings
     SET status = $1::booking_status,
         responded_at = CASE WHEN responded_at IS NULL THEN now() ELSE responded_at END,
         completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE completed_at END
     WHERE id = $2 AND producer_id = $3 AND status = ANY($4::booking_status[])
     RETURNING *`,
    [status, req.params.id, req.producer.id, TRANSITIONS[status]]
  );
  if (!b) return res.status(404).json({ error: 'Reserva não encontrada ou transição inválida' });

  const { rows: [l] } = await query('SELECT title, price_cents FROM listings WHERE id = $1', [b.listing_id]);
  // Reserva concluída com preço definido = venda registrada no marketplace
  if (status === 'completed' && l?.price_cents) {
    await query('INSERT INTO transactions (listing_id, amount_cents) VALUES ($1, $2)',
      [b.listing_id, l.price_cents * b.qty]);
  }
  notify(b.tourist_id, 'booking', {
    id: b.id, title: l?.title, status, status_label: BOOKING_LABEL[status],
  });
  res.json({ ...b, status_label: BOOKING_LABEL[b.status] });
});
