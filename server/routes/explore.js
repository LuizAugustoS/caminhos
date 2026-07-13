// Exploração pública (turista): anúncios aprovados, estabelecimentos e
// itinerários publicados. Sem autenticação — conteúdo de vitrine.
import { Router } from 'express';
import { query } from '../db.js';

export const explore = Router();

explore.get('/listings', async (req, res) => {
  const { type, q } = req.query;
  if (type && !['product', 'service', 'event'].includes(type)) {
    return res.status(400).json({ error: 'type deve ser product, service ou event' });
  }
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.listed_at,
            p.id AS producer_id, p.name AS producer_name, p.initials AS producer_initials,
            p.avatar_color AS producer_color, coalesce(e.city, p.city) AS city
     FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE l.status = 'approved'
       AND l.image_label <> 'Foto do anúncio'
       AND ($1::text IS NULL OR l.type = $1::listing_type)
       AND ($2::text = '' OR l.title ILIKE '%' || $2 || '%' OR l.subtitle ILIKE '%' || $2 || '%'
            OR p.name ILIKE '%' || $2 || '%')
     ORDER BY l.listed_at DESC
     LIMIT $3`,
    [type || null, (q || '').trim(), limit]
  );
  res.json({ listings: rows });
});

explore.get('/establishments', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const { rows } = await query(
    `SELECT e.id, e.name, e.description, e.category, e.city, e.address, e.phone, e.open_hours,
            p.id AS producer_id, p.initials, p.avatar_color, p.kind
     FROM establishments e
     JOIN producers p ON p.id = e.producer_id AND p.status = 'approved'
     WHERE ($1 = '' OR e.name ILIKE '%' || $1 || '%' OR e.category ILIKE '%' || $1 || '%'
            OR e.city ILIKE '%' || $1 || '%')
     ORDER BY e.name
     LIMIT $2`,
    [q, limit]
  );
  res.json({ establishments: rows });
});

explore.get('/itineraries', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, region, duration, offline_ready, updated_at
     FROM itineraries WHERE published ORDER BY offline_ready DESC, title`
  );
  res.json({ itineraries: rows });
});
