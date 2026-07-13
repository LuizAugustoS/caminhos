import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { login, logout, me, requireAuth } from './auth.js';
import { dashboard } from './routes/dashboard.js';
import { producers, listings } from './routes/moderation.js';
import { misc } from './routes/misc.js';
import { pool } from './db.js';

const app = express();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.use(express.json());

// ─── API ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', requireAuth, me);

app.use('/api/dashboard', requireAuth, dashboard);
app.use('/api/producers', requireAuth, producers);
app.use('/api/listings', requireAuth, listings);
app.use('/api', requireAuth, misc);

// ─── PWA estático ───────────────────────────────────────────────────────────
app.use(express.static(publicDir, {
  setHeaders(res, path) {
    // O service worker precisa ser revalidado a cada carga para updates rápidos
    if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Caminhos do Caparaó — admin em http://localhost:${port}`));
