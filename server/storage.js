// Armazenamento de imagens enviadas. Padrão: disco local (/uploads).
// Com S3_BUCKET configurado, envia para S3/Cloudflare R2 e serve pela URL
// pública — resolve o problema de disco efêmero em PaaS (as fotos somem no
// redeploy). O driver S3 usa @aws-sdk/client-s3 (dependência opcional):
//   npm i @aws-sdk/client-s3
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

export const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
const S3_BUCKET = process.env.S3_BUCKET;
export const storageDriver = S3_BUCKET ? 's3' : 'disk';

// ─── Disco (padrão) ─────────────────────────────────────────────────────────
if (storageDriver === 'disk' && !existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── S3/R2 (opcional) ───────────────────────────────────────────────────────
// Carrega o SDK sob demanda e memoiza o client.
let s3Client = null;
async function s3() {
  if (s3Client) return s3Client;
  let mod;
  try {
    mod = await import('@aws-sdk/client-s3');
  } catch {
    throw new Error('S3_BUCKET configurado, mas @aws-sdk/client-s3 não está instalado (npm i @aws-sdk/client-s3)');
  }
  const client = new mod.S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined, // R2/S3-compatível
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    } : undefined,
  });
  s3Client = { client, cmd: mod };
  return s3Client;
}
// URL pública das imagens no S3/R2 (bucket público ou CDN à frente)
const s3PublicBase = () => (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');

// Salva o buffer e devolve o caminho/URL público a guardar no banco.
export async function putObject(buffer, mimetype) {
  const key = `${randomUUID()}${EXT[mimetype] || ''}`;
  if (storageDriver === 's3') {
    const { client, cmd } = await s3();
    await client.send(new cmd.PutObjectCommand({
      Bucket: S3_BUCKET, Key: key, Body: buffer, ContentType: mimetype,
      CacheControl: 'public, max-age=2592000, immutable',
    }));
    return `${s3PublicBase()}/${key}`;
  }
  await writeFile(join(UPLOADS_DIR, key), buffer);
  return `/uploads/${key}`;
}

// Remove um objeto salvo (ignora caminhos externos e falhas).
export async function removeObject(publicPath) {
  if (!publicPath) return;
  if (storageDriver === 's3') {
    const base = s3PublicBase();
    if (!base || !publicPath.startsWith(base + '/')) return;
    const key = publicPath.slice(base.length + 1);
    const { client, cmd } = await s3();
    await client.send(new cmd.DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })).catch(() => {});
    return;
  }
  if (!publicPath.startsWith('/uploads/')) return;
  await unlink(join(UPLOADS_DIR, publicPath.slice('/uploads/'.length))).catch(() => {});
}
