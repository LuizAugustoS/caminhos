// Conta do usuário logado (qualquer papel): dados da sessão e avatar.
import { Router } from 'express';
import { query } from '../db.js';
import { acceptImage, removeUpload } from '../upload.js';

export const account = Router();

account.get('/', async (req, res) => {
  const { rows: [u] } = await query('SELECT avatar_path FROM users WHERE id = $1', [req.user.id]);
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role, avatar_path: u?.avatar_path || null });
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
