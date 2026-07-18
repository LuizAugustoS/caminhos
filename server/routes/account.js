// Conta do usuário logado (qualquer papel): dados, edição de perfil,
// troca de senha e avatar.
import { Router } from 'express';
import { query } from '../db.js';
import { clearSession, hashPassword, setSession, verifyPassword } from '../auth.js';
import { acceptImage, removeUpload } from '../upload.js';

export const account = Router();

const profileOf = u => ({
  id: u.id, name: u.name, role: u.role, email: u.email,
  city: u.city || null, avatar_path: u.avatar_path || null,
  email_verified: u.email_verified_at != null,
});

account.get('/', async (req, res) => {
  const { rows: [u] } = await query(
    'SELECT id, name, email, role, city, avatar_path, email_verified_at FROM users WHERE id = $1',
    [req.user.id]);
  if (!u) return res.status(401).json({ error: 'Não autenticado' });
  res.json(profileOf(u));
});

// Edição do perfil (nome e cidade). O nome do estabelecimento do produtor
// é editado no portal — aqui é a conta da pessoa.
account.put('/', async (req, res) => {
  const { name, city } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Informe seu nome' });
  const { rows: [u] } = await query(
    `UPDATE users SET name = $1, city = $2 WHERE id = $3
     RETURNING id, name, email, role, city, avatar_path, email_verified_at, session_epoch`,
    [name.trim(), city?.trim() || null, req.user.id]
  );
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (u.role === 'tourist') {
    await query('UPDATE tourists SET name = $1, city = $2 WHERE user_id = $3',
      [u.name, u.city, u.id]);
  }
  setSession(res, u); // renova o cookie com o novo nome
  res.json(profileOf(u));
});

// Troca de senha exige a senha atual
account.put('/password', async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'A nova senha precisa de pelo menos 8 caracteres' });
  }
  const { rows: [u] } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!u || !verifyPassword(current_password || '', u.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta' });
  }
  // Nova época derruba as sessões antigas; o cookie desta é renovado
  const { rows: [updated] } = await query(
    `UPDATE users SET password_hash = $1, session_epoch = session_epoch + 1
     WHERE id = $2 RETURNING id, name, role, session_epoch`,
    [hashPassword(new_password), req.user.id]);
  setSession(res, updated);
  res.json({ ok: true });
});

// Exclusão de conta (LGPD): exige a senha; apaga o usuário e, no caso do
// produtor, o estabelecimento e os anúncios (com as fotos do disco).
account.delete('/', async (req, res) => {
  const { rows: [u] } = await query('SELECT password_hash, role FROM users WHERE id = $1', [req.user.id]);
  if (!u || !verifyPassword(req.body?.password || '', u.password_hash)) {
    return res.status(400).json({ error: 'Senha incorreta' });
  }
  // Arquivos a remover do disco depois que o banco confirmar
  const { rows: files } = await query(
    `SELECT avatar_path AS path FROM users WHERE id = $1 AND avatar_path IS NOT NULL
     UNION ALL
     SELECT e.photo_path FROM establishments e
       JOIN producers p ON p.id = e.producer_id WHERE p.user_id = $1 AND e.photo_path IS NOT NULL
     UNION ALL
     SELECT li.path FROM listing_images li
       JOIN listings l ON l.id = li.listing_id
       JOIN producers p ON p.id = l.producer_id WHERE p.user_id = $1`,
    [req.user.id]
  );
  // Produtor: apaga o perfil público inteiro (cascateia anúncios, reservas,
  // conversas e avaliações recebidas)
  await query('DELETE FROM producers WHERE user_id = $1', [req.user.id]);
  await query('DELETE FROM users WHERE id = $1', [req.user.id]);
  for (const f of files) await removeUpload(f.path);
  clearSession(res);
  res.json({ ok: true });
});

// Avatar do usuário (multipart, campo 'image'); substitui o anterior
account.post('/avatar', acceptImage, async (req, res) => {
  const newPath = `/uploads/${req.file.filename}`;
  const { rows: [old] } = await query('SELECT avatar_path FROM users WHERE id = $1', [req.user.id]);
  if (!old) {
    await removeUpload(newPath);
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  await query('UPDATE users SET avatar_path = $1 WHERE id = $2', [newPath, req.user.id]);
  await removeUpload(old.avatar_path);
  res.json({ avatar_path: newPath });
});
