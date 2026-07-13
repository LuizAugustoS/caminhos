import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { login, logout, me, register, requireAuth, requireRole } from './auth.js';
import { dashboard } from './routes/dashboard.js';
import { producers, listings } from './routes/moderation.js';
import { misc } from './routes/misc.js';
import { explore } from './routes/explore.js';
import { trips, favorites } from './routes/trips.js';
import { conversations } from './routes/chat.js';
import { portal } from './routes/portal.js';
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
app.post('/api/register', register);
app.post('/api/logout', logout);
app.get('/api/me', requireAuth, me);

// Público (vitrine para turistas, mesmo sem conta)
app.use('/api/explore', explore);

// Turista
app.use('/api/trips', requireRole('tourist'), trips);
app.use('/api/favorites', requireRole('tourist'), favorites);

// Turista + produtor (chat assimétrico)
app.use('/api/conversations', requireRole('tourist', 'producer', 'admin'), conversations);

// Produtor
app.use('/api/portal', requireRole('producer'), portal);

// Admin
app.use('/api/dashboard', requireRole('admin'), dashboard);
app.use('/api/producers', requireRole('admin'), producers);
app.use('/api/listings', requireRole('admin'), listings);
app.use('/api', requireRole('admin'), misc);

// ─── PWA estático ───────────────────────────────────────────────────────────
app.use(express.static(publicDir, {
  setHeaders(res, path) {
    // O service worker precisa ser revalidado a cada carga para updates rápidos
    if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get('/admin', (_req, res) => res.sendFile(join(publicDir, 'admin.html')));
app.get('/app', (_req, res) => res.sendFile(join(publicDir, 'tourist.html')));
app.get('/portal', (_req, res) => res.sendFile(join(publicDir, 'producer.html')));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Caminhos do Caparaó — admin em http://localhost:${port}`));
