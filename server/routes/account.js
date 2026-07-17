// Conta do usuário logado (qualquer papel): dados, edição de perfil,
// troca de senha e avatar.
import { Router } from 'express';
import { query } from '../db.js';
import { hashPassword, setSession, verifyPassword } from '../auth.js';
import { acceptImage, removeUpload } from '../upload.js';

export const account = Router();

const profileOf = u => ({
  id: u.id, name: u.name, role: u.role, email: u.email,
  city: u.city || null, avatar_path: u.avatar_path || null,
});

account.get('/', async (req, res) => {
  const { rows: [u] } = await query(
    'SELECT id, name, email, role, city, avatar_path FROM users WHERE id = $1', [req.user.id]);
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
     RETURNING id, name, email, role, city, avatar_path`,
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
  await query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [hashPassword(new_password), req.user.id]);
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
