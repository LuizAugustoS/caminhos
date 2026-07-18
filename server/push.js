// Web Push (VAPID). Com VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY configuradas o
// servidor envia notificações mesmo com o app fechado; sem elas o recurso
// fica desligado e o restante da plataforma segue normal.
// Gere um par de chaves com: npm run push:keys
import webpush from 'web-push';
import { query } from './db.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

export const pushEnabled = Boolean(PUBLIC_KEY && PRIVATE_KEY);
export const pushPublicKey = PUBLIC_KEY || null;

if (pushEnabled) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:contato@caminhosdocaparao.com.br',
    PUBLIC_KEY, PRIVATE_KEY
  );
}

// Envia para todos os aparelhos do usuário; inscrições mortas (404/410 do
// serviço de push) são removidas. Nunca derruba a rota que disparou.
export async function pushToUser(userId, payload) {
  if (!pushEnabled || !userId) return;
  const { rows } = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
      } else {
        console.warn(`push falhou (user ${userId}):`, err.message);
      }
    }
  }));
}
