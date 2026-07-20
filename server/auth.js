// Autenticação por sessão via cookie HMAC-assinado (sem dependências extras).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool, query } from './db.js';
import { PLAN_KEYS } from './plans.js';
import { baseUrlOf, sendVerificationEmail } from './routes/verify.js';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-inseguro';
const COOKIE = 'caparao_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const SECURE_FLAG = process.env.NODE_ENV === 'production' ? '; Secure' : '';

// ─── Rate limit (login/registro/reenvios) ───────────────────────────────────
// Padrão: em memória (instância única). Com RATE_LIMIT_STORE=db usa o Postgres
// para valer entre múltiplas instâncias.
const attempts = new Map(); // chave → { count, resetAt }
const USE_DB_RATE_LIMIT = process.env.RATE_LIMIT_STORE === 'db';

function memoryHit(key, max, windowMs) {
  const now = Date.now();
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false };
  }
  if (entry.count >= max) return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  entry.count++;
  return { limited: false };
}

// Contagem atômica no banco: upsert que zera a janela expirada e incrementa.
async function dbHit(key, max, windowMs) {
  const { rows: [row] } = await query(
    `INSERT INTO rate_limits (bucket, count, reset_at)
     VALUES ($1, 1, now() + ($2 || ' milliseconds')::interval)
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at < now()
                       THEN now() + ($2 || ' milliseconds')::interval ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [key, windowMs]
  );
  if (row.count > max) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((new Date(row.reset_at) - Date.now()) / 1000)) };
  }
  return { limited: false };
}

// Limpeza periódica dos buckets expirados (só no modo banco)
if (USE_DB_RATE_LIMIT) {
  setInterval(() => {
    query('DELETE FROM rate_limits WHERE reset_at < now()').catch(() => {});
  }, 10 * 60 * 1000).unref();
}

export function rateLimit(keyFn, max, windowMs, message) {
  return async (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next(); // testes automatizados
    try {
      const key = keyFn(req);
      const r = USE_DB_RATE_LIMIT ? await dbHit(key, max, windowMs) : memoryHit(key, max, windowMs);
      if (r.limited) {
        res.setHeader('Retry-After', r.retryAfter);
        return res.status(429).json({ error: message });
      }
      next();
    } catch (err) {
      // Falha no store nunca deve bloquear o serviço — segue sem limitar
      console.warn('rateLimit falhou:', err.message);
      next();
    }
  };
}

export const loginLimiter = rateLimit(
  req => `login:${req.ip}:${(req.body?.email || '').toLowerCase()}`,
  10, 15 * 60 * 1000,
  'Muitas tentativas de login — aguarde alguns minutos e tente novamente'
);
export const registerLimiter = rateLimit(
  req => `register:${req.ip}`,
  5, 60 * 60 * 1000,
  'Muitos cadastros deste endereço — tente novamente mais tarde'
);

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(data).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function setSession(res, user) {
  const token = sign({
    id: user.id, name: user.name, role: user.role,
    ep: user.session_epoch ?? 0,           // época: revoga sessões antigas
    exp: Date.now() + SESSION_TTL_MS,
  });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${SECURE_FLAG}`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${SECURE_FLAG}`);
}

export async function requireAuth(req, res, next) {
  const session = verify(parseCookies(req)[COOKIE]);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });
  // Época da sessão: senha trocada/conta excluída invalida cookies antigos
  const { rows: [u] } = await query('SELECT session_epoch FROM users WHERE id = $1', [session.id]);
  if (!u || u.session_epoch !== (session.ep ?? 0)) {
    clearSession(res);
    return res.status(401).json({ error: 'Sessão expirada — entre novamente' });
  }
  req.user = session;
  req.admin = session; // compatibilidade com rotas antigas
  next();
}

export const requireRole = (...roles) => [requireAuth, (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Acesso negado para este perfil' });
  next();
}];

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha' });
  const { rows } = await query(
    'SELECT id, name, email, password_hash, role, session_epoch FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  setSession(res, user);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
}

const initialsOf = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Cadastro de turista ou produtor. Produtores entram na fila de moderação do admin.
export async function register(req, res) {
  const { name, email, password, role, city, establishment, plan } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Informe nome, e-mail e senha (mínimo 8 caracteres)' });
  }
  if (!['tourist', 'producer'].includes(role)) {
    return res.status(400).json({ error: "Perfil deve ser 'tourist' ou 'producer'" });
  }
  if (role === 'producer' && plan != null && !PLAN_KEYS.includes(plan)) {
    return res.status(400).json({ error: 'Plano inválido' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, city)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role`,
      [name.trim(), email.trim().toLowerCase(), hashPassword(password), role, city || null]
    );
    if (role === 'tourist') {
      await client.query(
        `INSERT INTO tourists (name, email, city, user_id) VALUES ($1, $2, $3, $4)`,
        [user.name, user.email, city || null, user.id]
      );
    } else {
      const estName = establishment?.trim() || `${user.name} — Estabelecimento`;
      const { rows: [producer] } = await client.query(
        `INSERT INTO producers (name, kind, initials, status, city, user_id, plan)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6) RETURNING id`,
        [estName, 'Novo parceiro · aguardando revisão', initialsOf(estName), city || null, user.id,
         plan || 'gratuito']
      );
      await client.query(
        `INSERT INTO establishments (producer_id, name, city) VALUES ($1, $2, $3)`,
        [producer.id, estName, city || null]
      );
    }
    await client.query('COMMIT');
    sendVerificationEmail(user, baseUrlOf(req)).catch(() => {});
    setSession(res, user);
    res.status(201).json(user);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    throw err;
  } finally {
    client.release();
  }
}

export function logout(_req, res) {
  clearSession(res);
  res.json({ ok: true });
}
