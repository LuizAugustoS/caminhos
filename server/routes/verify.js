// Verificação de e-mail: o cadastro envia um link com token de uso único
// (48h). Não bloqueia o uso do app — marca a conta como confirmada.
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { rateLimit, requireAuth } from '../auth.js';
import { sendMail } from '../mailer.js';

export const emailVerify = Router();

const sha256 = s => createHash('sha256').update(s).digest('hex');

// Cria o token e envia o e-mail — usado no cadastro e no reenvio
export async function sendVerificationEmail(user, baseUrl) {
  const token = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '48 hours')`,
    [user.id, sha256(token)]
  );
  sendMail({
    to: user.email,
    subject: 'Confirme seu e-mail — Caminhos do Caparaó',
    text: `Olá, ${user.name}!\n\n` +
      `Confirme seu e-mail para a gente saber que essa conta é sua mesmo. ` +
      `Basta abrir o link abaixo (válido por 48 horas):\n\n` +
      `${baseUrl}/verificar?token=${token}\n\n` +
      `Se você não criou uma conta no Caminhos do Caparaó, ignore este e-mail.`,
  });
}

export const baseUrlOf = req => process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

// Público: o link do e-mail cai aqui
emailVerify.post('/verify', async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Informe o token' });
  const { rows: [v] } = await query(
    `SELECT id, user_id FROM email_verifications
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token)]
  );
  if (!v) return res.status(400).json({ error: 'Link inválido ou expirado — peça um novo reenvio dentro do app' });
  await query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [v.user_id]);
  await query('UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [v.user_id]);
  res.json({ ok: true });
});

const resendLimiter = rateLimit(
  req => `verify-resend:${req.user?.id || req.ip}`,
  3, 60 * 60 * 1000,
  'Muitos reenvios — confira a caixa de spam e tente de novo mais tarde'
);

// Logado: reenvia o link (banner "confirme seu e-mail")
emailVerify.post('/resend', requireAuth, resendLimiter, async (req, res) => {
  const { rows: [u] } = await query(
    'SELECT id, name, email, email_verified_at FROM users WHERE id = $1', [req.user.id]);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (u.email_verified_at) return res.json({ ok: true, verified: true });
  await sendVerificationEmail(u, baseUrlOf(req));
  res.json({ ok: true });
});
