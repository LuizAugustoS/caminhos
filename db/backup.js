// Backup do banco (pg_dump, formato custom) e das fotos enviadas.
// Uso: npm run db:backup  → gera backups/caminhos-<data>.dump e uploads-<data>.tar.gz
// Restauração: pg_restore --clean --no-owner -d $DATABASE_URL backups/caminhos-<data>.dump
import '../server/env.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL || 'postgres://caminhos:caminhos@localhost:5432/caminhos';
const dir = process.env.BACKUP_DIR || join(root, 'backups');
const stamp = new Date().toISOString().replace(/[:]/g, '-').slice(0, 16);
mkdirSync(dir, { recursive: true });

const dumpFile = join(dir, `caminhos-${stamp}.dump`);
const dump = spawnSync('pg_dump', ['--no-owner', '--format=custom', `--file=${dumpFile}`, url], { stdio: 'inherit' });
if (dump.error?.code === 'ENOENT') {
  console.error('pg_dump não encontrado — instale o cliente do PostgreSQL (postgresql-client)');
  process.exit(1);
}
if (dump.status !== 0) process.exit(dump.status ?? 1);
console.log(`Banco: ${dumpFile}`);

const uploadsDir = process.env.UPLOADS_DIR || join(root, 'uploads');
if (existsSync(uploadsDir)) {
  const tarFile = join(dir, `uploads-${stamp}.tar.gz`);
  const tar = spawnSync('tar', ['-czf', tarFile, '-C', dirname(uploadsDir), 'uploads'], { stdio: 'inherit' });
  if (tar.status === 0) console.log(`Fotos: ${tarFile}`);
}
console.log('Backup concluído. Guarde os arquivos fora do servidor (ex.: bucket ou drive).');
