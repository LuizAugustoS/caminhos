import './env.js'; // primeiro: os módulos abaixo leem process.env no load
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { login, loginLimiter, logout, register, registerLimiter, requireAuth, requireRole } from './auth.js';
import { account } from './routes/account.js';
import { events } from './routes/events.js';
import { bookings } from './routes/bookings.js';
import { dashboard } from './routes/dashboard.js';
import { producers, listings } from './routes/moderation.js';
import { misc } from './routes/misc.js';
import { explore } from './routes/explore.js';
import { trips, favorites } from './routes/trips.js';
import { conversations } from './routes/chat.js';
import { portal } from './routes/portal.js';
import { reviews, adminReviews } from './routes/reviews.js';
import { password } from './routes/password.js';
import { push } from './routes/push.js';
import { emailVerify } from './routes/verify.js';
import { publicPages } from './routes/public.js';
import { UPLOADS_DIR } from './upload.js';
import { pool } from './db.js';
import { PLANS } from './plans.js';
import { captureError } from './errors.js';

const app = express();
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Atrás de um proxy/CDN (deploy com HTTPS), respeita X-Forwarded-* para
// req.ip (rate-limit) e req.secure (cookie Secure) funcionarem.
app.set('trust proxy', 1);

// ─── Cabeçalhos de segurança ────────────────────────────────────────────────
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // style inline é usado pelo design (atributos style=) — fontes via Google Fonts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  // Tiles do OpenStreetMap para o mapa do Explorar (Leaflet servido localmente)
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
  "manifest-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // geolocation=self: o produtor pode usar a própria localização no mapa do perfil
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json());

// Log conciso das requisições de API (método, rota, status, duração).
// Desative com LOG_REQUESTS=0; erros 5xx sempre são registrados.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path === '/api/events') return next();
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
    const line = `${req.method} ${req.path} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) console.error('[req]', line);
    else if (process.env.LOG_REQUESTS !== '0') console.log('[req]', line);
  });
  next();
});

// ─── API ────────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// Planos de produtor (público: a landing mostra antes do cadastro)
app.get('/api/plans', (_req, res) => res.json({ plans: Object.values(PLANS) }));

app.post('/api/login', loginLimiter, login);
app.post('/api/register', registerLimiter, register);
app.use('/api/password', password);
app.use('/api/email', emailVerify);
app.post('/api/logout', logout);
app.use('/api/me', requireAuth, account);
app.use('/api/events', requireAuth, events);
app.use('/api/push', requireAuth, push);

// Público (vitrine para turistas, mesmo sem conta)
app.use('/api/explore', explore);

// Turista
app.use('/api/trips', requireRole('tourist'), trips);
app.use('/api/favorites', requireRole('tourist'), favorites);
app.use('/api/bookings', requireRole('tourist'), bookings);
app.use('/api/reviews', requireRole('tourist'), reviews);

// Turista + produtor (chat assimétrico)
app.use('/api/conversations', requireRole('tourist', 'producer', 'admin'), conversations);

// Produtor
app.use('/api/portal', requireRole('producer'), portal);

// Admin
app.use('/api/admin/reviews', requireRole('admin'), adminReviews);
app.use('/api/dashboard', requireRole('admin'), dashboard);
app.use('/api/producers', requireRole('admin'), producers);
app.use('/api/listings', requireRole('admin'), listings);
app.use('/api', requireRole('admin'), misc);

// Fotos enviadas pelos usuários (imutáveis: nome de arquivo aleatório)
app.use('/uploads', express.static(UPLOADS_DIR, { immutable: true, maxAge: '30d' }));

// ─── PWA estático ───────────────────────────────────────────────────────────
app.use(express.static(publicDir, {
  setHeaders(res, path) {
    // O service worker precisa ser revalidado a cada carga para updates rápidos
    if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use(publicPages); // /p/:id e /e/:id — páginas compartilháveis com OG tags
app.get('/termos', (_req, res) => res.sendFile(join(publicDir, 'termos.html')));
app.get('/privacidade', (_req, res) => res.sendFile(join(publicDir, 'privacidade.html')));
app.get('/admin', (_req, res) => res.sendFile(join(publicDir, 'admin.html')));
app.get('/app', (_req, res) => res.sendFile(join(publicDir, 'tourist.html')));
app.get('/portal', (_req, res) => res.sendFile(join(publicDir, 'producer.html')));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err);
  captureError(err, { path: req.path, method: req.method });
  res.status(500).json({ error: 'Erro interno do servidor' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Caminhos do Caparaó — admin em http://localhost:${port}`));
