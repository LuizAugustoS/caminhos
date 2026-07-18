// Recuperação de senha: "esqueci a senha" envia um link por e-mail com
// token de uso único (1h de validade). A resposta do /forgot é sempre a
// mesma, exista o e-mail ou não — sem enumeração de contas.
import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { query } from '../db.js';
import { hashPassword, rateLimit } from '../auth.js';
import { sendMail } from '../mailer.js';

export const password = Router();

const sha256 = s => createHash('sha256').update(s).digest('hex');

const forgotLimiter = rateLimit(
  req => `forgot:${req.ip}`,
  5, 60 * 60 * 1000,
  'Muitas solicitações — tente novamente mais tarde'
);

password.post('/forgot', forgotLimiter, async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const reply = () => res.json({ ok: true, message: 'Se o e-mail estiver cadastrado, enviamos um link de redefinição' });
  if (!email) return reply();

  const { rows: [user] } = await query('SELECT id, name, email FROM users WHERE email = $1', [email]);
  if (!user) return reply();

  const token = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [user.id, sha256(token)]
  );
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/reset?token=${token}`;
  sendMail({
    to: user.email,
    subject: 'Redefinição de senha — Caminhos do Caparaó',
    text: `Olá, ${user.name}!\n\n` +
      `Recebemos um pedido para redefinir a senha da sua conta. ` +
      `Abra o link abaixo para escolher uma nova senha (válido por 1 hora):\n\n${link}\n\n` +
      `Se você não pediu a redefinição, ignore este e-mail — sua senha continua a mesma.`,
  });
  reply();
});

password.post('/reset', async (req, res) => {
  const { token, password: newPassword } = req.body || {};
  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Informe o token e uma nova senha (mínimo 8 caracteres)' });
  }
  const { rows: [reset] } = await query(
    `SELECT id, user_id FROM password_resets
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token)]
  );
  if (!reset) return res.status(400).json({ error: 'Link inválido ou expirado — peça uma nova redefinição' });

  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), reset.user_id]);
  // Consome o token usado e invalida os demais pendentes do usuário
  await query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [reset.user_id]);
  res.json({ ok: true });
});
