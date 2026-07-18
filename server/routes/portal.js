// Portal do produtor/comerciante: vitrine de anúncios, perfil do
// estabelecimento e visão geral. Toda rota exige papel 'producer'.
import { Router } from 'express';
import { query } from '../db.js';
import { acceptImage, removeUpload } from '../upload.js';
import { planOf } from '../plans.js';
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
  const active = Number(stats.approved) + Number(stats.pending);
  res.json({
    producer: req.producer,
    plan: { ...req.plan, active_listings: active },
    listings: { approved: Number(stats.approved), pending: Number(stats.pending), rejected: Number(stats.rejected) },
    unreadMessages: Number(unread.n),
  });
});

// ─── Perfil do estabelecimento ──────────────────────────────────────────────
portal.get('/establishment', async (req, res) => {
  const { rows } = await query('SELECT * FROM establishments WHERE producer_id = $1', [req.producer.id]);
  res.json(rows[0] || null);
});

portal.put('/establishment', async (req, res) => {
  const { name, description, category, city, address, phone, open_hours } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Informe o nome do estabelecimento' });
  const { rows } = await query(
    `UPDATE establishments
     SET name = $1, description = $2, category = $3, city = $4,
         address = $5, phone = $6, open_hours = $7, updated_at = now()
     WHERE producer_id = $8
     RETURNING *`,
    [name.trim(), description || null, category || null, city || null,
     address || null, phone || null, open_hours || null, req.producer.id]
  );
  await query('UPDATE producers SET name = $1, city = $2 WHERE id = $3', [name.trim(), city || null, req.producer.id]);
  res.json(rows[0]);
});

// ─── Vitrine (anúncios) ─────────────────────────────────────────────────────
const LISTING_TYPES = ['product', 'service', 'event'];
const IMAGE_KINDS = ['cafe', 'arte', 'verde', 'sage'];

portal.get('/listings', async (req, res) => {
  const { rows } = await query(
    `SELECT id, type, title, subtitle, glyph, image_kind, image_path, status, listed_at, created_at,
            price_cents, price_unit, event_date, event_time, event_place
     FROM listings WHERE producer_id = $1 ORDER BY created_at DESC`,
    [req.producer.id]
  );
  res.json({ listings: rows });
});

function validListing(body) {
  const { type, title, price_cents } = body || {};
  if (!LISTING_TYPES.includes(type)) return 'type deve ser product, service ou event';
  if (!title?.trim()) return 'Informe o título do anúncio';
  if (price_cents != null && (!Number.isInteger(price_cents) || price_cents <= 0)) {
    return 'Preço inválido';
  }
  return null;
}

// Normaliza os campos opcionais de preço e evento
function listingFields(body) {
  const isEvent = body.type === 'event';
  return [
    body.price_cents ?? null,
    (body.price_unit || '').trim() || null,
    isEvent ? body.event_date || null : null,
    isEvent ? (body.event_time || '').trim() || null : null,
    isEvent ? (body.event_place || '').trim() || null : null,
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
                           price_cents, price_unit, event_date, event_time, event_place)
     VALUES ($1, $2, $3, $4, $5, $6, $3, 'pending', $7, $8, $9, $10, $11)
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at,
               price_cents, price_unit, event_date, event_time, event_place`,
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
         price_cents = $7, price_unit = $8, event_date = $9, event_time = $10, event_place = $11
     WHERE id = $5 AND producer_id = $6
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at,
               price_cents, price_unit, event_date, event_time, event_place`,
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
