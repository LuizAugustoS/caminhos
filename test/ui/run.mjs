// Roda todas as suítes de UI (test/ui/*.ui.mjs) em sequência, sobe o servidor
// se ainda não estiver de pé e agrega o resultado. Uso: npm run test:ui
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..', '..');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PORT = new URL(BASE).port || '3000';

async function up() {
  try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
}

let server = null;
if (!(await up())) {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT }, stdio: 'inherit',
  });
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 200));
  if (!(await up())) { console.error('Servidor não subiu'); process.exit(1); }
}

const suites = readdirSync(dir).filter(f => f.endsWith('.ui.mjs'));
let failed = false;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const code = await new Promise(res => {
    spawn(process.execPath, [join(dir, suite)], { cwd: root, stdio: 'inherit', env: process.env })
      .on('exit', res);
  });
  if (code !== 0) failed = true;
}

server?.kill();
process.exit(failed ? 1 : 0);
