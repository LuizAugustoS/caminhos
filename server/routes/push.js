// Inscrição de Web Push do usuário logado (turista e produtor).
import { Router } from 'express';
import { query } from '../db.js';
import { pushEnabled, pushPublicKey } from '../push.js';

export const push = Router();

push.get('/config', (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushPublicKey });
});

push.post('/subscribe', async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'Notificações não estão configuradas no servidor' });
  const { endpoint, keys } = req.body || {};
  if (!endpoint?.startsWith('https://') || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Inscrição de push inválida' });
  }
  await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, endpoint, keys.p256dh, keys.auth]
  );
  res.status(201).json({ ok: true });
});

push.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Informe o endpoint' });
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.user.id]);
  res.json({ ok: true });
});
