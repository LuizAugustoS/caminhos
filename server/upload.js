// Upload de imagens (multer em memória) validado por tipo/tamanho, gravado
// pela camada de storage (disco ou S3/R2). Campos: avatar, foto do
// estabelecimento e fotos de anúncio. JPG/PNG/WebP até 5 MB.
import multer from 'multer';
import { putObject, removeObject, UPLOADS_DIR } from './storage.js';

export { UPLOADS_DIR };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Envie uma imagem JPG, PNG ou WebP'));
  },
});

// Middleware: aceita multipart no campo 'image', salva no storage e expõe
// req.file.publicPath (o caminho/URL a guardar no banco). Erros de validação
// respondem 400 em vez de derrubar a requisição.
export function acceptImage(req, res, next) {
  upload.single('image')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    try {
      req.file.publicPath = await putObject(req.file.buffer, req.file.mimetype);
      next();
    } catch (e) {
      console.error('upload falhou:', e.message);
      res.status(500).json({ error: 'Não foi possível salvar a imagem' });
    }
  });
}

// Remove um arquivo salvo (disco ou S3), tolerante a falhas.
export const removeUpload = removeObject;
