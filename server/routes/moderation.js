import { Router } from 'express';
import { query } from '../db.js';

export const producers = Router();
export const listings = Router();

const REVIEW_STATUSES = new Set(['approved', 'rejected']);

// ─── Produtores ─────────────────────────────────────────────────────────────
producers.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 100);
  const q = (req.query.q || '').trim();
  const { rows } = await query(
    `SELECT id, name, kind, initials, avatar_color, status, city, created_at
     FROM producers
     WHERE ($1::text IS NULL OR status = $1::approval_status)
       AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR kind ILIKE '%' || $3 || '%'
            OR city ILIKE '%' || $3 || '%')
     ORDER BY (status IN ('pending', 'in_review')) DESC, created_at DESC
     LIMIT $2`,
    [req.query.status || null, limit, q]
  );
  const pending = await query(`SELECT count(*) AS n FROM producers WHERE status IN ('pending', 'in_review')`);
  res.json({ producers: rows, pendingCount: Number(pending.rows[0].n) });
});

producers.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ error: "status deve ser 'approved' ou 'rejected'" });
  }
  const { rows } = await query(
    `UPDATE producers SET status = $1, reviewed_at = now() WHERE id = $2
     RETURNING id, name, status`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Produtor não encontrado' });
  res.json(rows[0]);
});

// ─── Anúncios (produtos / serviços / eventos) ───────────────────────────────
listings.get('/', async (req, res) => {
  const { type, status } = req.query;
  if (type && !['product', 'service', 'event'].includes(type)) {
    return res.status(400).json({ error: 'type deve ser product, service ou event' });
  }
  if (status && !['pending', 'in_review', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  const limit = Math.min(Number(req.query.limit) || 4, 100);
  const q = (req.query.q || '').trim();
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_label,
            l.status, l.listed_at,
            p.name AS producer_name, p.initials AS producer_initials, p.avatar_color AS producer_color
     FROM listings l
     JOIN producers p ON p.id = l.producer_id
     WHERE ($1::text IS NULL OR l.type = $1::listing_type)
       AND ($3::text IS NULL OR l.status = $3::approval_status)
       AND ($4 = '' OR l.title ILIKE '%' || $4 || '%' OR p.name ILIKE '%' || $4 || '%')
       AND l.image_label <> 'Foto do anúncio'      -- oculta massa de demonstração
     ORDER BY (l.status IN ('pending', 'in_review')) DESC, l.listed_at DESC
     LIMIT $2`,
    [type || null, limit, status || null, q]
  );
  res.json({ listings: rows });
});

listings.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ error: "status deve ser 'approved' ou 'rejected'" });
  }
  const { rows } = await query(
    `UPDATE listings SET status = $1, reviewed_at = now() WHERE id = $2
     RETURNING id, title, status`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json(rows[0]);
});
