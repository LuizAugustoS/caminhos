// Portal do produtor/comerciante: vitrine de anúncios, perfil do
// estabelecimento e visão geral. Toda rota exige papel 'producer'.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { query } from '../db.js';

export const portal = Router();

// ─── Upload de fotos dos anúncios ───────────────────────────────────────────
export const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error('Envie uma imagem JPG, PNG ou WebP'));
  },
});

// Carrega o produtor vinculado à conta e o injeta na requisição
portal.use(async (req, res, next) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.status, p.initials, p.avatar_color, e.id AS establishment_id
     FROM producers p LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE p.user_id = $1`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nenhum estabelecimento vinculado a esta conta' });
  req.producer = rows[0];
  next();
});

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
  res.json({
    producer: req.producer,
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
    `SELECT id, type, title, subtitle, glyph, image_kind, image_path, status, listed_at, created_at
     FROM listings WHERE producer_id = $1 ORDER BY created_at DESC`,
    [req.producer.id]
  );
  res.json({ listings: rows });
});

function validListing(body) {
  const { type, title } = body || {};
  if (!LISTING_TYPES.includes(type)) return 'type deve ser product, service ou event';
  if (!title?.trim()) return 'Informe o título do anúncio';
  return null;
}

portal.post('/listings', async (req, res) => {
  const invalid = validListing(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const { type, title, subtitle, image_kind } = req.body;
  const glyph = { product: '◉', service: '✤', event: '⛰' }[type];
  const { rows } = await query(
    `INSERT INTO listings (producer_id, type, title, subtitle, glyph, image_kind, image_label, status)
     VALUES ($1, $2, $3, $4, $5, $6, $3, 'pending')
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at`,
    [req.producer.id, type, title.trim(), subtitle || null, glyph,
     IMAGE_KINDS.includes(image_kind) ? image_kind : 'verde']
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
     SET type = $1, title = $2, subtitle = $3, image_kind = $4, status = 'pending', reviewed_at = NULL
     WHERE id = $5 AND producer_id = $6
     RETURNING id, type, title, subtitle, glyph, image_kind, status, listed_at`,
    [type, title.trim(), subtitle || null,
     IMAGE_KINDS.includes(image_kind) ? image_kind : 'verde',
     req.params.id, req.producer.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json(rows[0]);
});

// Foto do anúncio (multipart, campo 'image'); substitui a anterior
portal.post('/listings/:id/image', (req, res, next) => {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
  const newPath = `/uploads/${req.file.filename}`;
  const { rows: [old] } = await query(
    'SELECT image_path FROM listings WHERE id = $1 AND producer_id = $2',
    [req.params.id, req.producer.id]
  );
  if (!old) {
    await unlink(join(UPLOADS_DIR, req.file.filename)).catch(() => {});
    return res.status(404).json({ error: 'Anúncio não encontrado' });
  }
  await query('UPDATE listings SET image_path = $1 WHERE id = $2', [newPath, req.params.id]);
  if (old.image_path?.startsWith('/uploads/')) {
    await unlink(join(UPLOADS_DIR, old.image_path.slice('/uploads/'.length))).catch(() => {});
  }
  res.json({ id: Number(req.params.id), image_path: newPath });
});

portal.delete('/listings/:id', async (req, res) => {
  const { rowCount } = await query(
    'DELETE FROM listings WHERE id = $1 AND producer_id = $2',
    [req.params.id, req.producer.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Anúncio não encontrado' });
  res.json({ ok: true });
});
