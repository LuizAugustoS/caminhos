// Executa as migrations SQL pendentes em db/migrations, em ordem alfabética.
import '../server/env.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgres://caminhos:caminhos@localhost:5432/caminhos',
});

await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

const applied = new Set(
  (await client.query('SELECT filename FROM schema_migrations')).rows.map(r => r.filename)
);

const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`Aplicando migration ${file}…`);
  const sql = await readFile(join(dir, file), 'utf8');
  await client.query(sql);
  await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
}

console.log('Migrations em dia.');
await client.end();
