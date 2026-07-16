// Upload de imagens (multer) compartilhado: fotos de anúncio, avatar do
// usuário e foto do estabelecimento. JPG/PNG/WebP até 5 MB, nome aleatório.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import multer from 'multer';

export const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error('Envie uma imagem JPG, PNG ou WebP'));
  },
});

// Middleware: aceita multipart com o campo 'image' e responde 400 em erro de
// validação (tipo/tamanho) em vez de derrubar a requisição.
export function acceptImage(req, res, next) {
  upload.single('image')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    next();
  });
}

// Remove um arquivo salvo em /uploads (ignora caminhos externos e falhas)
export async function removeUpload(publicPath) {
  if (!publicPath?.startsWith('/uploads/')) return;
  await unlink(join(UPLOADS_DIR, publicPath.slice('/uploads/'.length))).catch(() => {});
}
