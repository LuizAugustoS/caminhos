// Exploração pública (turista): anúncios aprovados, estabelecimentos e
// itinerários publicados. Sem autenticação — conteúdo de vitrine.
import { Router } from 'express';
import { query } from '../db.js';

export const explore = Router();

// ─── Monitoramento de turismo: cada busca real alimenta o mapa de calor ─────
// Célula(s) do grid 12×6 associadas a cada localidade da região.
const SPOT_CELLS = {
  'Pico da Bandeira':      [[3, 4], [4, 4], [2, 3]],
  'Alto Caparaó':          [[3, 7], [4, 7], [2, 7]],
  'Ibitirama':             [[3, 2], [2, 2], [4, 2]],
  'Dores do Rio Preto':    [[4, 3], [5, 4], [3, 3]],
  'Divino de S. Lourenço': [[4, 8], [5, 5], [3, 8]],
  'Iúna':                  [[1, 3], [1, 8]],
  'Espera Feliz':          [[4, 10], [3, 10]],
  'Manhuaçu':              [[1, 1], [2, 1]],
};
const SPOTS = Object.keys(SPOT_CELLS);
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Infere a localidade: termo buscado → cidade dos resultados → destaque da região.
function inferSpot(q, resultCities) {
  const nq = norm(q);
  const bySearch = SPOTS.find(s => nq.includes(norm(s)) || norm(s).includes(nq));
  if (bySearch) return bySearch;
  for (const city of resultCities) {
    const byCity = SPOTS.find(s => norm(s) === norm(city));
    if (byCity) return byCity;
  }
  return 'Pico da Bandeira'; // destaque regional como atribuição padrão
}

// Registro assíncrono (nunca atrasa nem derruba a resposta da busca)
function trackSearch(q, resultCities) {
  if (!q) return;
  const spot = inferSpot(q, resultCities);
  const cells = SPOT_CELLS[spot];
  const [row, col] = cells[Math.floor(Math.random() * cells.length)];
  query(
    'INSERT INTO search_events (spot, grid_row, grid_col) VALUES ($1, $2, $3)',
    [spot, row, col]
  ).catch(err => console.warn('trackSearch falhou:', err.message));
}

explore.get('/listings', async (req, res) => {
  const { type, q } = req.query;
  if (type && !['product', 'service', 'event'].includes(type)) {
    return res.status(400).json({ error: 'type deve ser product, service ou event' });
  }
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_path, l.listed_at,
            l.price_cents, l.price_unit, l.event_date, l.event_time, l.event_place,
            p.id AS producer_id, p.name AS producer_name, p.initials AS producer_initials,
            p.avatar_color AS producer_color, p.plan, coalesce(e.city, p.city) AS city,
            r.rating_avg, r.rating_count
     FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     LEFT JOIN establishments e ON e.producer_id = p.id
     LEFT JOIN (SELECT listing_id, round(avg(rating)::numeric, 1) AS rating_avg, count(*) AS rating_count
                FROM reviews WHERE NOT hidden GROUP BY listing_id) r ON r.listing_id = l.id
     WHERE l.status = 'approved'
       AND l.image_label <> 'Foto do anúncio'
       AND ($1::text IS NULL OR l.type = $1::listing_type)
       AND ($2::text = '' OR l.title ILIKE '%' || $2 || '%' OR l.subtitle ILIKE '%' || $2 || '%'
            OR p.name ILIKE '%' || $2 || '%')
     ORDER BY (p.plan = 'premium') DESC, l.listed_at DESC
     LIMIT $3`,
    [type || null, (q || '').trim(), limit]
  );
  trackSearch((q || '').trim(), rows.map(r => r.city));
  res.json({ listings: rows });
});

// Detalhe de um anúncio aprovado, com dados do parceiro e do estabelecimento
explore.get('/listings/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_path, l.listed_at,
            l.price_cents, l.price_unit, l.event_date, l.event_time, l.event_place,
            p.id AS producer_id, p.name AS producer_name, p.initials AS producer_initials,
            p.avatar_color AS producer_color, p.kind AS producer_kind, p.plan,
            e.name AS est_name, e.description AS est_description, e.category AS est_category,
            e.city, e.address, e.phone, e.open_hours
     FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE l.id = $1 AND l.status = 'approved'`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  const { rows: images } = await query(
    'SELECT path FROM listing_images WHERE listing_id = $1 ORDER BY position, id',
    [req.params.id]
  );
  const { rows: revs } = await query(
    `SELECT r.rating, r.comment, r.created_at, u.name AS tourist_name
     FROM reviews r JOIN users u ON u.id = r.tourist_id
     WHERE r.listing_id = $1 AND NOT r.hidden
     ORDER BY r.created_at DESC LIMIT 10`,
    [req.params.id]
  );
  const { rows: [agg] } = await query(
    `SELECT round(avg(rating)::numeric, 1) AS rating_avg, count(*) AS rating_count
     FROM reviews WHERE listing_id = $1 AND NOT hidden`,
    [req.params.id]
  );
  res.json({ ...rows[0], images: images.map(i => i.path), reviews: revs,
             rating_avg: agg.rating_avg, rating_count: Number(agg.rating_count) });
});

explore.get('/establishments', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 24, 60);
  const { rows } = await query(
    `SELECT e.id, e.name, e.description, e.category, e.city, e.address, e.phone, e.open_hours,
            e.photo_path, p.id AS producer_id, p.initials, p.avatar_color, p.kind, p.plan,
            r.rating_avg, r.rating_count
     FROM establishments e
     JOIN producers p ON p.id = e.producer_id AND p.status = 'approved'
     LEFT JOIN (SELECT producer_id, round(avg(rating)::numeric, 1) AS rating_avg, count(*) AS rating_count
                FROM reviews WHERE NOT hidden GROUP BY producer_id) r ON r.producer_id = p.id
     WHERE ($1 = '' OR e.name ILIKE '%' || $1 || '%' OR e.category ILIKE '%' || $1 || '%'
            OR e.city ILIKE '%' || $1 || '%')
     ORDER BY (p.plan = 'premium') DESC, e.name
     LIMIT $2`,
    [q, limit]
  );
  trackSearch(q, rows.map(r => r.city));
  res.json({ establishments: rows });
});

explore.get('/itineraries', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, region, duration, offline_ready, updated_at
     FROM itineraries WHERE published ORDER BY offline_ready DESC, title`
  );
  res.json({ itineraries: rows });
});
