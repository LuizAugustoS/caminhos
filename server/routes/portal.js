// Portal do produtor/comerciante: vitrine de anúncios, perfil do
// estabelecimento e visão geral. Toda rota exige papel 'producer'.
import { Router } from 'express';
import { query } from '../db.js';
import { acceptImage, removeUpload } from '../upload.js';
import { PLAN_KEYS, planOf } from '../plans.js';
import { portalBookings } from './bookings.js';

export const portal = Router();

// Carrega o produtor vinculado à conta e o injeta na requisição
portal.use(async (req, res, next) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.status, p.initials, p.avatar_color, p.plan, e.id AS establishment_id
     FROM producers p LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE p.user_id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nenhum estabelecimento vinculado a esta conta' });
  req.producer = rows[0];
  req.plan = planOf(rows[0].plan);
  next();
});

// Reservas do produtor (usa req.producer carregado acima)
portal.use('/bookings', portalBookings);

portal.get('/overview', async (req, res) => {
  const { rows: [stats] } = await query(
    `SELECT count(*) FILTER (WHERE status = 'approved') AS approved,
            count(*) FILTER (WHERE status IN ('pending', 'in_review')) AS pending,
            count(*) FILTER (WHERE status = 'rejected') AS rejected
     FROM listings WHERE producer_id = $1`,
    [req.producer.id]
  );
  const { rows: [unread] } = await query(
    `SELECT count(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE c.producer_id = $1 AND m.read_at IS NULL AND m.sender_id <> $2`,
    [req.producer.id, req.user.id]
  );
  const { rows: [rating] } = await query(
    `SELECT round(avg(rating)::numeric, 1) AS avg, count(*) AS n
     FROM reviews WHERE producer_id = $1 AND NOT hidden`,
    [req.producer.id]
  );
  const active = Number(stats.approved) + Number(stats.pending);
  res.json({
    producer: req.producer,
    plan: { ...req.plan, active_listings: active },
    listings: { approved: Number(stats.approved), pending: Number(stats.pending), rejected: Number(stats.rejected) },
    unreadMessages: Number(unread.n),
    rating: { avg: rating.avg, count: Number(rating.n) },
  });
});

// ─── Perfil do estabelecimento ──────────────────────────────────────────────
portal.get('/establishment', async (req, res) => {
  const { rows } = await query('SELECT * FROM establishments WHERE producer_id = $1', [req.producer.id]);
  res.json(rows[0] || null);
});

portal.put('/establishment', async (req, res) => {
  const { name, description, category, city, address, phone, open_hours, lat, lng } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Informe o nome do estabelecimento' });
  // Coordenadas: opcionais, mas sempre o par completo e dentro dos limites
  const hasLat = lat != null, hasLng = lng != null;
  if (hasLat !== hasLng) return res.status(400).json({ error: 'Informe latitude e longitude juntas' });
  if (hasLat && (typeof lat !== 'number' || typeof lng !== 'number'
      || lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }
  const { rows } = await query(
    `UPDATE establishments
     SET name = $1, description = $2, category = $3, city = $4,
         address = $5, phone = $6, open_hours = $7, lat = $8, lng = $9, updated_at = now()
     WHERE producer_id = $10
     RETURNING *`,
    [name.trim(), description || null, category || null, city || null,
     address || null, phone || null, open_hours || null,
     hasLat ? lat : null, hasLng ? lng : null, req.producer.id]
  );
  await query('UPDATE producers SET name = $1, city = $2 WHERE id = $3', [name.trim(), city || null, req.producer.id]);
  res.json(rows[0]);
});

// ─── Vitrine (anúncios) ─────────────────────────────────────────────────────
const LISTING_TYPES = ['product', 'service', 'event'];
const IMAGE_KINDS = ['cafe', 'arte', 'verde', 'sage'];

portal.get('/listings', async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_path, l.status,
            l.listed_at, l.created_at, l.available, l.stock,
            l.price_cents, l.price_unit, l.event_date, l.event_time, l.event_place,
            coalesce(v.views_30d, 0) AS views_30d
     FROM listings l
     LEFT JOIN (SELECT listing_id, sum(views) AS views_30d FROM listing_views
                WHERE day > CURRENT_DATE - 30 GROUP BY listing_id) v ON v.listing_id = l.id
     WHERE l.producer_id = $1 ORDER BY l.created_at DESC`,
    [req.producer.id]
  );
  res.json({ listings: rows });
});

// Pausar/reativar anúncio (some do Explorar sem passar pela moderação de novo)
portal.post('/listings/:id/availability', async (req, res) => {
  const { available } = req.body || {};
  if (typeof available !== 'boolean') return res.status(400).json({ error: 'available deve ser true ou false' });
  const { rows } = await query(
    `UPDATE listings SET available = $1 WHERE id = $2 AND producer_id = $3
     RETURNING id, available`,
    [available, req.params.id, req.producer.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json(rows[0]);
});

// Solicitação de mudança de plano — vira alerta para a equipe (a cobrança
// é combinada fora da plataforma)
portal.post('/plan-request', async (req, res) => {
  const { plan, note } = req.body || {};
  if (!PLAN_KEYS.includes(plan)) return res.status(400).json({ error: 'Plano inválido' });
  if (plan === req.producer.plan) return res.status(400).json({ error: 'Este já é o seu plano atual' });
  await query(
    `INSERT INTO alerts (title, meta, severity) VALUES ($1, $2, 'info')`,
    [`Pedido de plano: ${req.producer.name}`,
     `${planOf(req.producer.plan).label} → ${planOf(plan).label}${note?.trim() ? ` · "${note.trim().slice(0, 140)}"` : ''}`]
  );
  res.status(201).json({ ok: true });
});

function validListing(body) {
  const { type, title, price_cents, stock } = body || {};
  if (!LISTING_TYPES.includes(type)) return 'type deve ser product, service ou event';
  if (!title?.trim()) return 'Informe o título do anúncio';
  if (price_cents != null && (!Number.isInteger(price_cents) || price_cents <= 0)) {
    return 'Preço inválido';
  }
  if (stock != null && (!Number.isInteger(stock) || stock < 0)) {
    return 'Estoque inválido — deixe vazio para não controlar';
  }
  return null;
}

// Normaliza os campos opcionais de preço, evento e estoque
function listingFields(body) {
  const isEvent = body.type === 'event';
  return [
    body.price_cents ?? null,
    (body.price_unit || '').trim() || null,
    isEvent ? body.event_date || null : null,
    isEvent ? (body.event_time || '').trim() || null : null,
    isEvent ? (body.event_place || '').trim() || null : null,
    body.stock ?? null,
  ];
}

portal.post('/listings', async (req, res) => {
  const invalid = validListing(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  // Limite de anúncios ativos do plano (recusados não contam)
  if (req.plan.max_listings != null) {
    const { rows: [{ n }] } = await query(
      `SELECT count(*) AS n FROM listings WHERE producer_id = $1 AND status <> 'rejected'`,
      [req.producer.id]
    );
    if (Number(n) >= req.plan.max_listings) {
      return res.status(403).json({
        error: `Seu plano ${req.plan.label} permite até ${req.plan.max_listings} anúncios ativos — fale com a equipe para mudar de plano`,
      });
    }
  }
  const { type, title, subtitle, image_kind } = req.body;
  const glyph = { product: '◉', service: '✤', event: '⛰' }[type];
  const { rows } = await query(
    `INSERT INTO listings (producer_id, type, title, subtitle, glyph, image_kind, image_label, status,
                           price_cents, price_unit, event_date, event_time, event_place, stock)
     VALUES ($1, $2, $3, $4, $5, $6, $3, 'pending', $7, $8, $9, $10, $11, $12)
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at,
               price_cents, price_unit, event_date, event_time, event_place, stock`,
    [req.producer.id, type, title.trim(), subtitle || null, glyph,
     IMAGE_KINDS.includes(image_kind) ? image_kind : 'verde', ...listingFields(req.body)]
  );
  res.status(201).json(rows[0]);
});

// Edição volta para a fila de moderação
portal.put('/listings/:id', async (req, res) => {
  const invalid = validListing(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const { type, title, subtitle, image_kind } = req.body;
  const { rows } = await query(
    `UPDATE listings
     SET type = $1, title = $2, subtitle = $3, image_kind = $4, status = 'pending', reviewed_at = NULL,
         price_cents = $7, price_unit = $8, event_date = $9, event_time = $10, event_place = $11, stock = $12
     WHERE id = $5 AND producer_id = $6
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at,
               price_cents, price_unit, event_date, event_time, event_place, stock`,
    [type, title.trim(), subtitle || null,
     IMAGE_KINDS.includes(image_kind) ? image_kind : 'verde',
     req.params.id, req.producer.id, ...listingFields(req.body)]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json(rows[0]);
});

// ─── Galeria de fotos do anúncio ────────────────────────────────────────────
// listings.image_path é a capa (primeira foto), mantida em sincronia aqui.
async function syncCover(listingId) {
  const { rows: [first] } = await query(
    'SELECT path FROM listing_images WHERE listing_id = $1 ORDER BY position, id LIMIT 1',
    [listingId]
  );
  await query('UPDATE listings SET image_path = $1 WHERE id = $2', [first?.path || null, listingId]);
}

async function ownListing(req) {
  const { rows } = await query(
    'SELECT id FROM listings WHERE id = $1 AND producer_id = $2',
    [req.params.id, req.producer.id]
  );
  return rows[0] || null;
}

portal.get('/listings/:id/images', async (req, res) => {
  if (!await ownListing(req)) return res.status(404).json({ error: 'Anúncio não encontrado' });
  const { rows } = await query(
    'SELECT id, path FROM listing_images WHERE listing_id = $1 ORDER BY position, id',
    [req.params.id]
  );
  res.json({ images: rows, max_photos: req.plan.max_photos });
});

// Adiciona uma foto à galeria (multipart, campo 'image'), até o limite do plano
portal.post('/listings/:id/images', acceptImage, async (req, res) => {
  const newPath = `/uploads/${req.file.filename}`;
  if (!await ownListing(req)) {
    await removeUpload(newPath);
    return res.status(404).json({ error: 'Anúncio não encontrado' });
  }
  const { rows: [{ n }] } = await query(
    'SELECT count(*) AS n FROM listing_images WHERE listing_id = $1', [req.params.id]
  );
  if (req.plan.max_photos != null && Number(n) >= req.plan.max_photos) {
    await removeUpload(newPath);
    return res.status(403).json({
      error: `Seu plano ${req.plan.label} permite até ${req.plan.max_photos} foto${req.plan.max_photos > 1 ? 's' : ''} por anúncio — fale com a equipe para mudar de plano`,
    });
  }
  const { rows: [img] } = await query(
    `INSERT INTO listing_images (listing_id, path, position)
     VALUES ($1, $2, coalesce((SELECT max(position) + 1 FROM listing_images WHERE listing_id = $1), 0))
     RETURNING id, path`,
    [req.params.id, newPath]
  );
  await syncCover(req.params.id);
  res.status(201).json(img);
});

portal.delete('/listings/:id/images/:imageId', async (req, res) => {
  if (!await ownListing(req)) return res.status(404).json({ error: 'Anúncio não encontrado' });
  const { rows: [img] } = await query(
    'DELETE FROM listing_images WHERE id = $1 AND listing_id = $2 RETURNING path',
    [req.params.imageId, req.params.id]
  );
  if (!img) return res.status(404).json({ error: 'Foto não encontrada' });
  await removeUpload(img.path);
  await syncCover(req.params.id);
  res.json({ ok: true });
});

// Foto do estabelecimento (multipart, campo 'image'); substitui a anterior
portal.post('/establishment/photo', acceptImage, async (req, res) => {
  const newPath = `/uploads/${req.file.filename}`;
  const { rows: [old] } = await query(
    'SELECT photo_path FROM establishments WHERE producer_id = $1',
    [req.producer.id]
  );
  if (!old) {
    await removeUpload(newPath);
    return res.status(404).json({ error: 'Estabelecimento não encontrado' });
  }
  await query(
    'UPDATE establishments SET photo_path = $1, updated_at = now() WHERE producer_id = $2',
    [newPath, req.producer.id]
  );
  await removeUpload(old.photo_path);
  res.json({ photo_path: newPath });
});

portal.delete('/listings/:id', async (req, res) => {
  const { rows: images } = await query(
    `SELECT path FROM listing_images WHERE listing_id IN
       (SELECT id FROM listings WHERE id = $1 AND producer_id = $2)`,
    [req.params.id, req.producer.id]
  );
  const { rowCount } = await query(
    'DELETE FROM listings WHERE id = $1 AND producer_id = $2',
    [req.params.id, req.producer.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Anúncio não encontrado' });
  for (const img of images) await removeUpload(img.path);
  res.json({ ok: true });
});
