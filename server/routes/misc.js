import { Router } from 'express';
import { query } from '../db.js';
import { hashPassword } from '../auth.js';
import { audit } from '../audit.js';

export const misc = Router();

// ─── Equipe: múltiplos administradores ──────────────────────────────────────
misc.get('/admins', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, created_at FROM users WHERE role = 'admin' ORDER BY created_at`);
  res.json({ admins: rows });
});

misc.post('/admins', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Informe nome, e-mail e senha (mínimo 8 caracteres)' });
  }
  try {
    const { rows: [u] } = await query(
      `INSERT INTO users (name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, 'admin', now()) RETURNING id, name, email, created_at`,
      [name.trim(), email.trim().toLowerCase(), hashPassword(password)]
    );
    audit(req, 'admin.created', `${u.name} <${u.email}>`);
    res.status(201).json(u);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    throw err;
  }
});

// ─── Auditoria das ações administrativas ────────────────────────────────────
misc.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await query(
    'SELECT id, admin_name, action, target, created_at FROM audit_log ORDER BY id DESC LIMIT $1',
    [limit]
  );
  res.json({ entries: rows });
});

// ─── Exportação CSV ─────────────────────────────────────────────────────────
function toCSV(rows, columns) {
  const cell = v => {
    const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n');
}

const EXPORTS = {
  producers: {
    columns: ['id', 'name', 'kind', 'status', 'plan', 'city', 'email', 'created_at'],
    sql: `SELECT p.id, p.name, p.kind, p.status, p.plan, p.city, u.email, p.created_at
          FROM producers p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id`,
  },
  tourists: {
    columns: ['id', 'name', 'email', 'city', 'created_at'],
    sql: 'SELECT id, name, email, city, created_at FROM tourists ORDER BY id',
  },
  transactions: {
    columns: ['id', 'listing_id', 'listing_title', 'amount_cents', 'created_at'],
    sql: `SELECT t.id, t.listing_id, l.title AS listing_title, t.amount_cents, t.created_at
          FROM transactions t LEFT JOIN listings l ON l.id = t.listing_id ORDER BY t.id`,
  },
};

misc.get('/export/:kind', async (req, res) => {
  const kind = req.params.kind.replace(/\.csv$/, '');
  const exp = EXPORTS[kind];
  if (!exp) return res.status(404).json({ error: 'Exportação inexistente — use producers, tourists ou transactions' });
  const { rows } = await query(exp.sql);
  audit(req, 'export.csv', `${kind} (${rows.length} linhas)`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}.csv"`);
  res.send('﻿' + toCSV(rows, exp.columns)); // BOM: acentos corretos no Excel
});

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
            u.email AS account_email, u.created_at AS account_since, u.avatar_path,
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
    `SELECT id, title, meta, severity, read_at, created_at
     FROM alerts ORDER BY (read_at IS NULL) DESC, created_at DESC LIMIT $1`,
    [limit]
  );
  const { rows: [{ unread }] } = await query(
    'SELECT count(*) AS unread FROM alerts WHERE read_at IS NULL');
  res.json({ alerts: rows, unread: Number(unread) });
});

misc.post('/alerts/:id/read', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE alerts SET read_at = now() WHERE id = $1 AND read_at IS NULL', [req.params.id]);
  res.json({ ok: true, updated: rowCount });
});

misc.post('/alerts/read-all', async (_req, res) => {
  const { rowCount } = await query('UPDATE alerts SET read_at = now() WHERE read_at IS NULL');
  res.json({ ok: true, updated: rowCount });
});

misc.delete('/alerts/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM alerts WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Notificação não encontrada' });
  res.json({ ok: true });
});

misc.get('/itineraries', async (_req, res) => {
  const { rows } = await query(
    `SELECT id, title, region, duration, offline_ready, updated_at
     FROM itineraries WHERE published ORDER BY updated_at DESC`
  );
  res.json({ itineraries: rows });
});
