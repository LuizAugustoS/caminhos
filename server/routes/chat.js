// Chat assimétrico turista ↔ produtor.
// Turista inicia conversas com produtores; o produtor responde pela sua conta.
// Envio idempotente por client_uid (suporta a fila offline do PWA).
import { Router } from 'express';
import { query } from '../db.js';

export const conversations = Router();

// Produtor vinculado à conta logada (null para turistas)
async function myProducerId(userId) {
  const { rows } = await query('SELECT id FROM producers WHERE user_id = $1', [userId]);
  return rows[0]?.id ?? null;
}

async function canAccess(convId, user) {
  const { rows } = await query(
    `SELECT c.id, c.tourist_id, c.producer_id, p.user_id AS producer_user_id
     FROM conversations c JOIN producers p ON p.id = c.producer_id
     WHERE c.id = $1`,
    [convId]
  );
  const conv = rows[0];
  if (!conv) return null;
  if (user.role === 'tourist' && conv.tourist_id === user.id) return conv;
  if (user.role === 'producer' && conv.producer_user_id === user.id) return conv;
  if (user.role === 'admin') return conv;
  return null;
}

conversations.get('/', async (req, res) => {
  const producerId = req.user.role === 'producer' ? await myProducerId(req.user.id) : null;
  const { rows } = await query(
    `SELECT c.id, c.created_at,
            p.id AS producer_id, p.name AS producer_name, p.initials AS producer_initials,
            p.avatar_color AS producer_color,
            u.id AS tourist_id, u.name AS tourist_name,
            (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_at,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id
               AND m.read_at IS NULL AND m.sender_id <> $1) AS unread
     FROM conversations c
     JOIN producers p ON p.id = c.producer_id
     JOIN users u ON u.id = c.tourist_id
     WHERE ($2::int IS NOT NULL AND c.producer_id = $2)
        OR ($2::int IS NULL AND c.tourist_id = $1)
     ORDER BY last_at DESC NULLS LAST`,
    [req.user.id, producerId]
  );
  res.json({ conversations: rows });
});

// Turista abre (ou reencontra) conversa com um produtor
conversations.post('/', async (req, res) => {
  if (req.user.role !== 'tourist') {
    return res.status(403).json({ error: 'Apenas turistas iniciam conversas' });
  }
  const producerId = Number(req.body?.producer_id);
  if (!producerId) return res.status(400).json({ error: 'Informe producer_id' });
  const { rows } = await query(
    `INSERT INTO conversations (tourist_id, producer_id) VALUES ($1, $2)
     ON CONFLICT (tourist_id, producer_id) DO UPDATE SET tourist_id = EXCLUDED.tourist_id
     RETURNING id, tourist_id, producer_id, created_at`,
    [req.user.id, producerId]
  );
  res.status(201).json(rows[0]);
});

conversations.get('/:id/messages', async (req, res) => {
  const conv = await canAccess(req.params.id, req.user);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  const { rows } = await query(
    `SELECT m.id, m.sender_id, m.client_uid, m.body, m.created_at, m.read_at, u.name AS sender_name
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at`,
    [conv.id]
  );
  // Marca como lidas as mensagens recebidas
  await query(
    `UPDATE messages SET read_at = now()
     WHERE conversation_id = $1 AND sender_id <> $2 AND read_at IS NULL`,
    [conv.id, req.user.id]
  );
  res.json({ messages: rows });
});

conversations.post('/:id/messages', async (req, res) => {
  const conv = await canAccess(req.params.id, req.user);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Mensagem vazia' });
  const clientUid = req.body?.client_uid || null;
  const { rows } = await query(
    `INSERT INTO messages (conversation_id, sender_id, client_uid, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (conversation_id, client_uid)
     DO UPDATE SET client_uid = EXCLUDED.client_uid  -- reenvio da fila offline: devolve a original
     RETURNING id, sender_id, client_uid, body, created_at`,
    [conv.id, req.user.id, clientUid, body]
  );
  res.status(201).json(rows[0]);
});
