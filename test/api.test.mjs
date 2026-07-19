// Testes de API de ponta a ponta: sobem o servidor real contra o banco
// configurado (rode `npm run db:setup` antes — o CI faz isso).
// Execução: npm test
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const PORT = process.env.TEST_PORT || 3210;
const BASE = `http://localhost:${PORT}`;
const uniq = Math.random().toString(36).slice(2, 8);

let server;
let serverLog = '';

before(async () => {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT, DISABLE_RATE_LIMIT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  // Espera o servidor responder
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Servidor não subiu:\n${serverLog}`);
});

after(() => server?.kill());

// Cliente HTTP com sessão (guarda o cookie entre chamadas)
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');
    return res;
  };
}

// Extrai do log do servidor o link enviado por e-mail (modo dev), olhando
// apenas o que foi logado depois de `mark` — evita pegar token de outro teste.
async function tokenFromLog(pattern, mark = 0) {
  for (let i = 0; i < 20; i++) {
    const m = [...serverLog.slice(mark).matchAll(pattern)].pop();
    if (m) return m[1];
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Token não apareceu no log (${pattern})`);
}

test('saúde do serviço', async () => {
  const r = await fetch(`${BASE}/api/health`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).db, 'up');
});

test('planos públicos: 3 planos com limites', async () => {
  const { plans } = await (await fetch(`${BASE}/api/plans`)).json();
  assert.equal(plans.length, 3);
  assert.equal(plans[0].key, 'gratuito');
  assert.equal(plans[0].max_listings, 3);
  assert.equal(plans[2].featured, true);
});

test('cadastro de turista, sessão e login inválido', async () => {
  const c = client();
  const r = await c('/api/register', { method: 'POST', body: {
    name: 'Teste API', email: `t-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  assert.equal(r.status, 201);
  const me = await (await c('/api/me')).json();
  assert.equal(me.email, `t-${uniq}@test.com`);
  assert.equal(me.email_verified, false);
  const bad = await c('/api/login', { method: 'POST', body: { email: me.email, password: 'errada123' } });
  assert.equal(bad.status, 401);
});

test('verificação de e-mail com token de uso único', async () => {
  const c = client();
  await c('/api/register', { method: 'POST', body: {
    name: 'Verifica', email: `v-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  // token do e-mail enviado exatamente para este destinatário
  const token = await tokenFromLog(new RegExp(
    `para: v-${uniq}@test\\.com[\\s\\S]{0,500}?verificar\\?token=([a-f0-9]{64})`, 'g'));
  const ok = await fetch(`${BASE}/api/email/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(ok.status, 200);
  assert.equal((await (await c('/api/me')).json()).email_verified, true);
  const reuse = await fetch(`${BASE}/api/email/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(reuse.status, 400);
});

test('trocar a senha derruba as outras sessões (época)', async () => {
  const email = `ep-${uniq}@test.com`;
  const a = client(), b = client();
  await a('/api/register', { method: 'POST', body: { name: 'Época', email, password: 'senha1234', role: 'tourist' } });
  await b('/api/login', { method: 'POST', body: { email, password: 'senha1234' } });
  const ch = await a('/api/me/password', { method: 'PUT', body: { current_password: 'senha1234', new_password: 'senhaNova1' } });
  assert.equal(ch.status, 200);
  assert.equal((await a('/api/me')).status, 200);   // quem trocou continua
  assert.equal((await b('/api/me')).status, 401);   // a outra sessão cai
});

test('redefinição de senha por e-mail', async () => {
  const email = `rs-${uniq}@test.com`;
  const c = client();
  await c('/api/register', { method: 'POST', body: { name: 'Reset', email, password: 'senha1234', role: 'tourist' } });
  await fetch(`${BASE}/api/password/forgot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const token = await tokenFromLog(new RegExp(
    `para: ${email.replace('.', '\\.')}[\\s\\S]{0,500}?reset\\?token=([a-f0-9]{64})`, 'g'));
  const ok = await fetch(`${BASE}/api/password/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'trocada123' }) });
  assert.equal(ok.status, 200);
  const login = client();
  assert.equal((await login('/api/login', { method: 'POST', body: { email, password: 'trocada123' } })).status, 200);
});

test('plano gratuito limita 3 anúncios ativos', async () => {
  const c = client();
  await c('/api/register', { method: 'POST', body: {
    name: 'Produtor Limite', email: `pl-${uniq}@test.com`, password: 'senha1234',
    role: 'producer', establishment: `Sítio Limite ${uniq}`, plan: 'gratuito' } });
  for (let i = 1; i <= 3; i++) {
    const r = await c('/api/portal/listings', { method: 'POST', body: { type: 'product', title: `Item ${i}` } });
    assert.equal(r.status, 201, `anúncio ${i} deveria passar`);
  }
  const r4 = await c('/api/portal/listings', { method: 'POST', body: { type: 'product', title: 'Item 4' } });
  assert.equal(r4.status, 403);
  assert.match((await r4.json()).error, /Gratuito/);
});

test('explorar: premium primeiro e busca sem acento', async () => {
  const { listings } = await (await fetch(`${BASE}/api/explore/listings?limit=10`)).json();
  assert.ok(listings.length > 3);
  const firstNonPremium = listings.findIndex(l => l.plan !== 'premium');
  const lastPremium = listings.map(l => l.plan).lastIndexOf('premium');
  if (firstNonPremium !== -1 && lastPremium !== -1) {
    assert.ok(lastPremium < firstNonPremium || firstNonPremium > 0, 'premium deve vir antes');
  }
  const { listings: byCafe } = await (await fetch(`${BASE}/api/explore/listings?q=cafe`)).json();
  assert.ok(byCafe.some(l => /Café/.test(l.title)), '"cafe" deve achar "Café"');
});

test('reserva completa: pedido → confirmar → concluir → avaliação', async () => {
  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Turista Fluxo', email: `fx-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  // pedido no anúncio 6 (Tour de Colheita, do produtor demo)
  const bk = await (await t('/api/bookings', { method: 'POST', body: {
    listing_id: 6, qty: 2, client_uid: `fx-${uniq}` } })).json();
  assert.equal(bk.status, 'pending');

  const p = client();
  await p('/api/login', { method: 'POST', body: { email: 'produtor@demo.com', password: 'caparao2026' } });
  for (const status of ['confirmed', 'completed']) {
    const r = await p(`/api/portal/bookings/${bk.id}/status`, { method: 'POST', body: { status } });
    assert.equal(r.status, 200, `transição para ${status}`);
  }

  // avaliação da reserva concluída aparece na média pública
  const before = await (await fetch(`${BASE}/api/explore/listings/6`)).json();
  const rv = await t('/api/reviews', { method: 'POST', body: { booking_id: bk.id, rating: 5, comment: 'Fluxo completo!' } });
  assert.equal(rv.status, 201);
  const after = await (await fetch(`${BASE}/api/explore/listings/6`)).json();
  assert.equal(after.rating_count, (before.rating_count || 0) + 1);
  // reserva de outra pessoa não pode ser avaliada
  const other = await p('/api/reviews', { method: 'POST', body: { booking_id: bk.id, rating: 1 } });
  assert.equal(other.status, 403); // produtor não é turista
});

test('página pública do anúncio com OG tags', async () => {
  const ok = await fetch(`${BASE}/p/6`);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /og:title/);
  assert.match(html, /Tour de Colheita/);
  assert.equal((await fetch(`${BASE}/p/999999`)).status, 404);
});

test('pausar anúncio o tira do Explorar e da página pública', async () => {
  const p = client();
  await p('/api/login', { method: 'POST', body: { email: 'produtor@demo.com', password: 'caparao2026' } });
  await p('/api/portal/listings/6/availability', { method: 'POST', body: { available: false } });
  assert.equal((await fetch(`${BASE}/api/explore/listings/6`)).status, 404);
  assert.equal((await fetch(`${BASE}/p/6`)).status, 404);
  await p('/api/portal/listings/6/availability', { method: 'POST', body: { available: true } });
  assert.equal((await fetch(`${BASE}/api/explore/listings/6`)).status, 200);
});

test('roteiros: upsert idempotente por client_uid', async () => {
  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Roteiro', email: `rt-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  const uid = `trip-${uniq}`;
  for (let i = 0; i < 2; i++) { // reenvio da fila offline não duplica
    const r = await t(`/api/trips/${uid}`, { method: 'PUT', body: {
      title: 'Fim de semana', notes: null, items: [{ client_uid: `i-${uniq}`, label: 'Mirante' }] } });
    assert.ok(r.status < 300);
  }
  const { trips } = await (await t('/api/trips')).json();
  assert.equal(trips.filter(x => x.client_uid === uid).length, 1);
});

test('exclusão de conta (LGPD) remove o acesso', async () => {
  const email = `del-${uniq}@test.com`;
  const c = client();
  await c('/api/register', { method: 'POST', body: { name: 'Del', email, password: 'senha1234', role: 'tourist' } });
  const wrong = await c('/api/me', { method: 'DELETE', body: { password: 'errada123' } });
  assert.equal(wrong.status, 400);
  const del = await c('/api/me', { method: 'DELETE', body: { password: 'senha1234' } });
  assert.equal(del.status, 200);
  const login = client();
  assert.equal((await login('/api/login', { method: 'POST', body: { email, password: 'senha1234' } })).status, 401);
});

test('admin: troca de plano, auditoria e CSV', async () => {
  const a = client();
  const r = await a('/api/login', { method: 'POST', body: {
    email: 'admin@caminhosdocaparao.com.br', password: 'caparao2026' } });
  assert.equal(r.status, 200);

  await a('/api/producers/3/plan', { method: 'POST', body: { plan: 'profissional' } });
  const { producers } = await (await a('/api/producers?limit=100&plan=profissional')).json();
  assert.ok(producers.some(p => p.id === 3));
  await a('/api/producers/3/plan', { method: 'POST', body: { plan: 'gratuito' } });

  const { entries } = await (await a('/api/audit')).json();
  assert.ok(entries.some(e => e.action === 'plan.changed'));

  const csv = await a('/api/export/producers.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(await csv.text(), /name,kind,status,plan/);

  // rotas de admin fecham para quem não é admin
  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Não Admin', email: `na-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  assert.equal((await t('/api/audit')).status, 403);
});
