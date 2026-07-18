import { Router } from 'express';
import { query } from '../db.js';
import { PLAN_KEYS } from '../plans.js';
import { sendMail } from '../mailer.js';
import { audit } from '../audit.js';

export const producers = Router();
export const listings = Router();

const REVIEW_STATUSES = new Set(['approved', 'rejected']);

// ─── Produtores ─────────────────────────────────────────────────────────────
producers.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 100);
  const q = (req.query.q || '').trim();
  const { rows } = await query(
    `SELECT id, name, kind, initials, avatar_color, status, city, plan, created_at
     FROM producers
     WHERE ($1::text IS NULL OR status = $1::approval_status)
       AND ($4::text IS NULL OR plan = $4::producer_plan)
       AND ($3 = '' OR name ILIKE '%' || $3 || '%' OR kind ILIKE '%' || $3 || '%'
            OR city ILIKE '%' || $3 || '%')
     ORDER BY (status IN ('pending', 'in_review')) DESC, created_at DESC
     LIMIT $2`,
    [req.query.status || null, limit, q, PLAN_KEYS.includes(req.query.plan) ? req.query.plan : null]
  );
  const pending = await query(`SELECT count(*) AS n FROM producers WHERE status IN ('pending', 'in_review')`);
  res.json({ producers: rows, pendingCount: Number(pending.rows[0].n) });
});

// Detalhe completo do produtor: perfil, estabelecimento, conta e anúncios —
// tudo que o admin precisa para decidir uma aprovação.
producers.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.name, p.kind, p.initials, p.avatar_color, p.status, p.city, p.plan,
            p.created_at, p.reviewed_at,
            e.name AS est_name, e.description AS est_description, e.category AS est_category,
            e.address, e.phone, e.open_hours, e.photo_path, e.lat, e.lng,
            u.email AS account_email, u.name AS account_name, u.created_at AS account_since,
            u.avatar_path
     FROM producers p
     LEFT JOIN establishments e ON e.producer_id = p.id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Produtor não encontrado' });
  const { rows: producerListings } = await query(
    `SELECT id, type, title, subtitle, glyph, image_kind, image_path, status, listed_at
     FROM listings
     WHERE producer_id = $1 AND image_label <> 'Foto do anúncio'
     ORDER BY created_at DESC
     LIMIT 12`,
    [req.params.id]
  );
  const { rows: [msgs] } = await query(
    `SELECT count(DISTINCT c.id) AS conversations
     FROM conversations c WHERE c.producer_id = $1`,
    [req.params.id]
  );
  const { rows: [rating] } = await query(
    `SELECT round(avg(rating)::numeric, 1) AS avg, count(*) AS n
     FROM reviews WHERE producer_id = $1 AND NOT hidden`,
    [req.params.id]
  );
  res.json({ producer: rows[0], listings: producerListings, conversations: Number(msgs.conversations),
             rating: { avg: rating.avg, count: Number(rating.n) } });
});

producers.post('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ error: "status deve ser 'approved' ou 'rejected'" });
  }
  const { rows } = await query(
    `UPDATE producers SET status = $1, reviewed_at = now() WHERE id = $2
     RETURNING id, name, status, user_id`,
    [status, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Produtor não encontrado' });
  audit(req, `producer.${status}`, rows[0].name);

  // Avisa o parceiro por e-mail (quando há conta vinculada)
  if (rows[0].user_id) {
    const { rows: [u] } = await query('SELECT name, email FROM users WHERE id = $1', [rows[0].user_id]);
    if (u) {
      sendMail(status === 'approved'
        ? { to: u.email, subject: 'Cadastro aprovado — Caminhos do Caparaó',
            text: `Olá, ${u.name}!\n\nSeu estabelecimento "${rows[0].name}" foi aprovado. ` +
              `Sua vitrine já pode receber anúncios e os turistas podem falar com você pelo app.\n\nBoas vendas!` }
        : { to: u.email, subject: 'Cadastro não aprovado — Caminhos do Caparaó',
            text: `Olá, ${u.name}.\n\nInfelizmente o cadastro de "${rows[0].name}" não foi aprovado desta vez. ` +
              `Responda este e-mail se quiser entender o motivo ou ajustar as informações.` });
    }
  }
  res.json(rows[0]);
});

// Troca de plano pelo admin (a cobrança acontece fora da plataforma)
producers.post('/:id/plan', async (req, res) => {
  const { plan } = req.body || {};
  if (!PLAN_KEYS.includes(plan)) return res.status(400).json({ error: 'Plano inválido' });
  const { rows } = await query(
    `UPDATE producers SET plan = $1 WHERE id = $2 RETURNING id, name, plan`,
    [plan, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Produtor não encontrado' });
  audit(req, 'plan.changed', `${rows[0].name} → ${plan}`);
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
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_path, l.image_label,
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

// Detalhe completo do anúncio, com o parceiro e o estabelecimento
listings.get('/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.glyph, l.image_kind, l.image_path,
            l.image_label, l.status, l.listed_at, l.created_at, l.reviewed_at,
            l.price_cents, l.price_unit, l.event_date, l.event_time, l.event_place,
            p.id AS producer_id, p.name AS producer_name, p.initials AS producer_initials,
            p.avatar_color AS producer_color, p.kind AS producer_kind, p.status AS producer_status,
            p.plan,
            e.name AS est_name, e.category AS est_category, coalesce(e.city, p.city) AS city,
            e.address, e.phone, e.open_hours
     FROM listings l
     JOIN producers p ON p.id = l.producer_id
     LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE l.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Anúncio não encontrado' });
  const { rows: images } = await query(
    'SELECT path FROM listing_images WHERE listing_id = $1 ORDER BY position, id',
    [req.params.id]
  );
  // Todas as avaliações (inclusive ocultas) — o admin modera daqui
  const { rows: revs } = await query(
    `SELECT r.id, r.rating, r.comment, r.hidden, r.created_at, u.name AS tourist_name
     FROM reviews r JOIN users u ON u.id = r.tourist_id
     WHERE r.listing_id = $1
     ORDER BY r.created_at DESC LIMIT 30`,
    [req.params.id]
  );
  res.json({ ...rows[0], images: images.map(i => i.path), reviews: revs });
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
  audit(req, `listing.${status}`, rows[0].title);
  res.json(rows[0]);
});
