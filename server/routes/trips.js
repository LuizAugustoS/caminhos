// Roteiros personalizados do turista — API idempotente para sincronização
// offline-first: o dispositivo é a fonte da verdade e envia o roteiro inteiro
// (upsert por client_uid), então repetir uma operação da fila nunca duplica.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { pool, query } from '../db.js';
import { generateItinerary, INTERESTS } from '../ai.js';

export const trips = Router();

trips.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT t.id, t.client_uid, t.title, t.notes, t.updated_at, t.origin, t.preferences,
            coalesce(json_agg(json_build_object(
              'client_uid', i.client_uid, 'position', i.position,
              'listing_id', i.listing_id, 'establishment_id', i.establishment_id,
              'label', i.label, 'note', i.note,
              'listing_title', l.title, 'listing_type', l.type,
              'establishment_name', e.name
            ) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
     FROM trips t
     LEFT JOIN trip_items i ON i.trip_id = t.id
     LEFT JOIN listings l ON l.id = i.listing_id
     LEFT JOIN establishments e ON e.id = i.establishment_id
     WHERE t.user_id = $1
     GROUP BY t.id
     ORDER BY t.updated_at DESC`,
    [req.user.id]
  );
  res.json({ trips: rows });
});

// Gera um roteiro por IA/N8N a partir dos gostos do turista e o salva
// como roteiro normal (aparece em "Meus Roteiros" e funciona offline).
trips.post('/generate', async (req, res) => {
  const { interests, duration, pace, text } = req.body || {};
  const preferences = {
    interests: (Array.isArray(interests) ? interests : []).filter(i => INTERESTS.includes(i)).slice(0, 10),
    duration: ['meio dia', '1 dia', 'fim de semana', '3+ dias'].includes(duration) ? duration : null,
    pace: ['tranquilo', 'moderado', 'intenso'].includes(pace) ? pace : null,
    text: text ? String(text).slice(0, 500) : null,
  };
  if (!preferences.interests.length && !preferences.text) {
    return res.status(400).json({ error: 'Conte seus gostos (selecione interesses ou escreva o que quer viver)' });
  }

  const itinerary = await generateItinerary(preferences);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `INSERT INTO trips (user_id, client_uid, title, notes, origin, preferences)
       VALUES ($1, $2, $3, $4, 'ai', $5)
       RETURNING id, client_uid, title, notes, origin, preferences, updated_at`,
      [req.user.id, randomUUID(), itinerary.title, itinerary.notes,
       JSON.stringify({ ...preferences, provider: itinerary.provider })]
    );
    for (const [pos, item] of itinerary.items.entries()) {
      await client.query(
        `INSERT INTO trip_items (trip_id, client_uid, position, listing_id, label, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [trip.id, randomUUID(), pos, item.listing_id, item.label, item.note]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(trip);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Upsert completo do roteiro (título, notas e itens) — idempotente.
trips.put('/:clientUid', async (req, res) => {
  const { title, notes, items } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Informe o título do roteiro' });
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items deve ser uma lista' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [trip] } = await client.query(
      `INSERT INTO trips (user_id, client_uid, title, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, client_uid)
       DO UPDATE SET title = $3, notes = $4, updated_at = now()
       RETURNING id, client_uid, title, notes, updated_at`,
      [req.user.id, req.params.clientUid, title.trim(), notes || null]
    );
    await client.query('DELETE FROM trip_items WHERE trip_id = $1', [trip.id]);
    for (const [pos, item] of items.entries()) {
      if (!item.client_uid) continue;
      await client.query(
        `INSERT INTO trip_items (trip_id, client_uid, position, listing_id, establishment_id, label, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (trip_id, client_uid) DO NOTHING`,
        [trip.id, item.client_uid, pos, item.listing_id || null,
         item.establishment_id || null, item.label || null, item.note || null]
      );
    }
    await client.query('COMMIT');
    res.json(trip);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

trips.delete('/:clientUid', async (req, res) => {
  await query('DELETE FROM trips WHERE user_id = $1 AND client_uid = $2', [req.user.id, req.params.clientUid]);
  res.json({ ok: true }); // idempotente: apagar o que não existe também é sucesso
});

// ─── Favoritos ──────────────────────────────────────────────────────────────
export const favorites = Router();

favorites.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT f.listing_id, l.title, l.subtitle, l.type, l.glyph, l.image_kind, l.image_path,
            p.name AS producer_name, p.id AS producer_id
     FROM favorites f
     JOIN listings l ON l.id = f.listing_id
     JOIN producers p ON p.id = l.producer_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [req.user.id]
  );
  res.json({ favorites: rows });
});

favorites.put('/:listingId', async (req, res) => {
  await query(
    `INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, req.params.listingId]
  );
  res.json({ ok: true });
});

favorites.delete('/:listingId', async (req, res) => {
  await query('DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2', [req.user.id, req.params.listingId]);
  res.json({ ok: true });
});
