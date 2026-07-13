// Autenticação por sessão via cookie HMAC-assinado (sem dependências extras).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool, query } from './db.js';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-inseguro';
const COOKIE = 'caparao_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas

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

export function setSession(res, admin) {
  const token = sign({ id: admin.id, name: admin.name, role: admin.role, exp: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

export function requireAuth(req, res, next) {
  const session = verify(parseCookies(req)[COOKIE]);
  if (!session) return res.status(401).json({ error: 'Não autenticado' });
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
  const { rows } = await query('SELECT id, name, email, password_hash, role FROM users WHERE email = $1', [email]);
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
  const { name, email, password, role, city, establishment } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Informe nome, e-mail e senha (mínimo 8 caracteres)' });
  }
  if (!['tourist', 'producer'].includes(role)) {
    return res.status(400).json({ error: "Perfil deve ser 'tourist' ou 'producer'" });
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
        `INSERT INTO producers (name, kind, initials, status, city, user_id)
         VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING id`,
        [estName, 'Novo parceiro · aguardando revisão', initialsOf(estName), city || null, user.id]
      );
      await client.query(
        `INSERT INTO establishments (producer_id, name, city) VALUES ($1, $2, $3)`,
        [producer.id, estName, city || null]
      );
    }
    await client.query('COMMIT');
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

export function me(req, res) {
  res.json({ id: req.user.id, name: req.user.name, role: req.user.role });
}
