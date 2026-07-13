// Autenticação por sessão via cookie HMAC-assinado (sem dependências extras).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

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
  req.admin = session;
  next();
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha' });
  const { rows } = await query('SELECT id, name, email, password_hash, role FROM admins WHERE email = $1', [email]);
  const admin = rows[0];
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos' });
  }
  setSession(res, admin);
  res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
}

export function logout(_req, res) {
  clearSession(res);
  res.json({ ok: true });
}

export function me(req, res) {
  res.json({ id: req.admin.id, name: req.admin.name, role: req.admin.role });
}
