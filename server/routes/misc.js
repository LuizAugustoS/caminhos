import { Router } from 'express';
import { query } from '../db.js';

export const misc = Router();

// Lista de turistas cadastrados (tela "Turistas" do admin)
misc.get('/tourists', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const { rows } = await query(
    `SELECT id, name, email, city, created_at, user_id IS NOT NULL AS has_account
     FROM tourists
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%'
            OR city ILIKE '%' || $1 || '%')
     ORDER BY created_at DESC
     LIMIT $2`,
    [q, limit]
  );
  const { rows: [{ total }] } = await query('SELECT count(*) AS total FROM tourists');
  res.json({ tourists: rows, total: Number(total) });
});

// Detalhe do turista: conta e atividade na plataforma
misc.get('/tourists/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.name, t.email, t.city, t.created_at, t.user_id,
            u.email AS account_email, u.created_at AS account_since,
            (SELECT count(*) FROM trips tr WHERE tr.user_id = t.user_id) AS trips,
            (SELECT count(*) FROM trips tr WHERE tr.user_id = t.user_id AND tr.origin = 'ai') AS ai_trips,
            (SELECT count(*) FROM favorites f WHERE f.user_id = t.user_id) AS favorites,
            (SELECT count(*) FROM conversations c WHERE c.tourist_id = t.user_id) AS conversations
     FROM tourists t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Turista não encontrado' });
  res.json(rows[0]);
});

misc.get('/chat', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 3, 50);
  const { rows } = await query(
    `SELECT id, sender_name, sender_initials, avatar_color, body, created_at
     FROM chat_messages ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ messages: rows });
});

misc.post('/chat', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Mensagem vazia' });
  const { rows } = await query(
    `INSERT INTO chat_messages (sender_name, sender_initials, avatar_color, body)
     VALUES ($1, $2, '#14402E', $3)
     RETURNING id, sender_name, sender_initials, avatar_color, body, created_at`,
    [req.admin.name, req.admin.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), body]
  );
  res.status(201).json(rows[0]);
});

misc.get('/alerts', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 3, 50);
  const { rows } = await query(
    `SELECT id, title, meta, severity, created_at
     FROM alerts ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({ alerts: rows });
});

misc.get('/itineraries', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, region, duration, offline_ready, updated_at
     FROM itineraries WHERE published ORDER BY updated_at DESC`
  );
  res.json({ itineraries: rows });
});
