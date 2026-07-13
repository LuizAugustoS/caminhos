import { Router } from 'express';
import { query } from '../db.js';

export const misc = Router();

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
