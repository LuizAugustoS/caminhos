// Upload de imagens (multer em memória) validado por tipo/tamanho e otimizado
// antes de gravar: o buffer passa por sharp (auto-orientação por EXIF,
// redimensionamento e conversão para WebP), o que derruba fotos de vários MB
// para algumas centenas de KB — essencial num app offline-first usado com
// internet ruim na serra. Campos: avatar, foto do estabelecimento e fotos de
// anúncio. Aceita JPG/PNG/WebP até 12 MB na entrada; a saída é sempre WebP.
import multer from 'multer';
import { putObject, removeObject, UPLOADS_DIR } from './storage.js';

export { UPLOADS_DIR };

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Lado maior máximo da imagem otimizada. 1600px cobre bem telas retina sem
// pesar; a qualidade WebP 78 é praticamente indistinguível e comprime muito.
const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 78;

// Carrega o sharp uma vez. Se não estiver instalado (ou falhar de carregar),
// o upload segue gravando o original — a otimização é uma melhoria, não um
// requisito para publicar uma foto.
let sharpMod;
async function loadSharp() {
  if (sharpMod !== undefined) return sharpMod;
  try {
    sharpMod = (await import('sharp')).default;
  } catch (e) {
    console.warn('sharp indisponível — imagens serão gravadas sem otimização:', e.message);
    sharpMod = null;
  }
  return sharpMod;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Envie uma imagem JPG, PNG ou WebP'));
  },
});

// Otimiza o buffer para WebP. Devolve { buffer, mimetype }. Em qualquer falha
// (sharp ausente, imagem corrompida) cai para o original recebido.
async function optimize(buffer, mimetype) {
  const sharp = await loadSharp();
  if (!sharp) return { buffer, mimetype };
  try {
    const out = await sharp(buffer)
      .rotate() // aplica a orientação do EXIF e remove o metadado
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer: out, mimetype: 'image/webp' };
  } catch (e) {
    console.warn('otimização de imagem falhou, gravando original:', e.message);
    return { buffer, mimetype };
  }
}

// Middleware: aceita multipart no campo 'image', otimiza, salva no storage e
// expõe req.file.publicPath (o caminho/URL a guardar no banco). Erros de
// validação respondem 400 em vez de derrubar a requisição.
export function acceptImage(req, res, next) {
  upload.single('image')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    try {
      const { buffer, mimetype } = await optimize(req.file.buffer, req.file.mimetype);
      req.file.publicPath = await putObject(buffer, mimetype);
      next();
    } catch (e) {
      console.error('upload falhou:', e.message);
      res.status(500).json({ error: 'Não foi possível salvar a imagem' });
    }
  });
}

// Remove um arquivo salvo (disco ou S3), tolerante a falhas.
export const removeUpload = removeObject;
