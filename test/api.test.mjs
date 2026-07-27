// Testes de API de ponta a ponta: sobem o servidor real contra o banco
// configurado (rode `npm run db:setup` antes — o CI faz isso).
// Execução: npm test
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

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

test('produtor: overview traz o estado dos primeiros passos', async () => {
  // Produtor recém-cadastrado: sem anúncio nem foto e perfil incompleto
  const c = client();
  await c('/api/register', { method: 'POST', body: {
    name: 'Produtor Novo', email: `pn-${uniq}@test.com`, password: 'senha1234',
    role: 'producer', establishment: `Sítio Novo ${uniq}`, plan: 'gratuito' } });
  const ov1 = await (await c('/api/portal/overview')).json();
  assert.deepEqual(
    { p: ov1.onboarding.profileComplete, l: ov1.onboarding.hasListing, f: ov1.onboarding.hasPhoto },
    { p: false, l: false, f: false }, 'começa com tudo pendente');

  // Após publicar um anúncio, hasListing vira true (mas ainda sem foto)
  await c('/api/portal/listings', { method: 'POST', body: { type: 'product', title: 'Primeiro' } });
  const ov2 = await (await c('/api/portal/overview')).json();
  assert.equal(ov2.onboarding.hasListing, true, 'hasListing após publicar');
  assert.equal(ov2.onboarding.hasPhoto, false, 'ainda sem foto');
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

test('explorar: filtro por cidade e ordenação', async () => {
  const { cities } = await (await fetch(`${BASE}/api/explore/cities`)).json();
  assert.ok(Array.isArray(cities) && cities.length > 0, 'lista de cidades presente');

  const city = cities[0];
  const { listings: inCity } = await (await fetch(
    `${BASE}/api/explore/listings?city=${encodeURIComponent(city)}`)).json();
  assert.ok(inCity.length > 0, 'cidade com anúncios');
  assert.ok(inCity.every(l => l.city === city), 'todos os anúncios são da cidade filtrada');

  // ordenar por preço muda a sequência (premium primeiro, depois preço)
  const ids = j => j.listings.map(l => l.id).join(',');
  const asc = await (await fetch(`${BASE}/api/explore/listings?sort=price_asc&limit=20`)).json();
  const desc = await (await fetch(`${BASE}/api/explore/listings?sort=price_desc&limit=20`)).json();
  assert.notEqual(ids(asc), ids(desc), 'ordenar por preço deve mudar a ordem');
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

  // o produtor responde à avaliação e a resposta aparece no detalhe público
  const { reviews } = await (await p('/api/portal/reviews')).json();
  const mine = reviews.find(r => r.comment === 'Fluxo completo!');
  assert.ok(mine, 'produtor vê a avaliação recebida');
  assert.equal((await p(`/api/portal/reviews/${mine.id}/reply`, {
    method: 'POST', body: { reply: 'Obrigado pela visita!' } })).status, 200);
  const withReply = await (await fetch(`${BASE}/api/explore/listings/6`)).json();
  assert.ok(withReply.reviews.some(r => r.reply === 'Obrigado pela visita!'), 'resposta visível no detalhe');
  // responder a avaliação inexistente / de outro parceiro → 404
  assert.equal((await p('/api/portal/reviews/999999/reply', { method: 'POST', body: { reply: 'x' } })).status, 404);
});

test('paginação do chat: página + carregar anteriores', async () => {
  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Chat Page', email: `cp-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  const conv = await (await t('/api/conversations', { method: 'POST', body: { producer_id: 1 } })).json();
  // manda 35 mensagens
  for (let i = 1; i <= 35; i++) {
    await t(`/api/conversations/${conv.id}/messages`, { method: 'POST', body: {
      body: `msg ${i}`, client_uid: `cp-${uniq}-${i}` } });
  }
  const first = await (await t(`/api/conversations/${conv.id}/messages?limit=30`)).json();
  assert.equal(first.messages.length, 30);
  assert.equal(first.hasMore, true);
  assert.equal(first.messages.at(-1).body, 'msg 35'); // ordem cronológica
  const older = await (await t(`/api/conversations/${conv.id}/messages?limit=30&before=${first.oldestId}`)).json();
  assert.equal(older.messages.length, 5);
  assert.equal(older.hasMore, false);
  assert.equal(older.messages[0].body, 'msg 1');
});

test('estoque: reserva respeita e concluir venda decrementa/esgota', async () => {
  const p = client();
  await p('/api/register', { method: 'POST', body: {
    name: 'Estoque', email: `st-${uniq}@test.com`, password: 'senha1234',
    role: 'producer', establishment: `Sítio Estoque ${uniq}`, plan: 'gratuito' } });
  const created = await (await p('/api/portal/listings', { method: 'POST', body: {
    type: 'product', title: `Item Estoque ${uniq}`, price_cents: 1000, stock: 2 } })).json();
  // aprova produtor e anúncio como admin
  const a = client();
  await a('/api/login', { method: 'POST', body: { email: 'admin@caminhosdocaparao.com.br', password: 'caparao2026' } });
  const { producers } = await (await a(`/api/producers?limit=100&q=Estoque ${uniq}`)).json();
  await a(`/api/producers/${producers[0].id}/status`, { method: 'POST', body: { status: 'approved' } });
  await a(`/api/listings/${created.id}/status`, { method: 'POST', body: { status: 'approved' } });

  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Comprador', email: `cmp-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  // pedir mais que o estoque falha
  const over = await t('/api/bookings', { method: 'POST', body: {
    listing_id: created.id, qty: 5, client_uid: `over-${uniq}` } });
  assert.equal(over.status, 409);
  // pedir 2 e concluir zera o estoque → some do Explorar
  const bk = await (await t('/api/bookings', { method: 'POST', body: {
    listing_id: created.id, qty: 2, client_uid: `ok-${uniq}` } })).json();
  await p(`/api/portal/bookings/${bk.id}/status`, { method: 'POST', body: { status: 'confirmed' } });
  await p(`/api/portal/bookings/${bk.id}/status`, { method: 'POST', body: { status: 'completed' } });
  assert.equal((await fetch(`${BASE}/api/explore/listings/${created.id}`)).status, 404);
  const { listings } = await (await p('/api/portal/listings')).json();
  assert.equal(listings.find(l => l.id === created.id).stock, 0);
});

test('página pública do anúncio com OG tags', async () => {
  const ok = await fetch(`${BASE}/p/6`);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /og:title/);
  assert.match(html, /Tour de Colheita/);
  assert.equal((await fetch(`${BASE}/p/999999`)).status, 404);
});

test('dados estruturados (JSON-LD) nas páginas públicas', async () => {
  const grab = html => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
  };
  const p = grab(await (await fetch(`${BASE}/p/6`)).text());
  assert.ok(p && ['Product', 'Event'].includes(p['@type']), 'anúncio tem Product/Event');
  assert.equal(p.offers.priceCurrency, 'BRL');
  const e = grab(await (await fetch(`${BASE}/e/1`)).text());
  assert.equal(e['@type'], 'LocalBusiness');
  assert.equal(e.address['@type'], 'PostalAddress');
});

test('explorar: ordenar "perto de mim" muda pela posição', async () => {
  const ids = j => j.listings.map(l => l.producer_name).join(',');
  const iuna = await (await fetch(`${BASE}/api/explore/listings?sort=distance&near=-20.346,-41.535&limit=5`)).json();
  const ibiti = await (await fetch(`${BASE}/api/explore/listings?sort=distance&near=-20.594,-41.759&limit=5`)).json();
  assert.ok(iuna.listings.length && ibiti.listings.length);
  assert.notEqual(ids(iuna), ids(ibiti), 'a ordem muda conforme a proximidade');
  // near inválido não quebra (cai para relevância)
  assert.equal((await fetch(`${BASE}/api/explore/listings?sort=distance&near=xyz`)).status, 200);
});

test('produtor: insights de desempenho', async () => {
  const p = client();
  await p('/api/login', { method: 'POST', body: { email: 'produtor@demo.com', password: 'caparao2026' } });
  const ins = await (await p('/api/portal/insights')).json();
  assert.ok(Array.isArray(ins.views.series) && ins.views.series.length === 6, 'série de 6 semanas');
  assert.equal(typeof ins.views.total30d, 'number');
  assert.ok(ins.bookings && typeof ins.bookings.total === 'number');
  assert.ok(ins.confirmationRate === null || (ins.confirmationRate >= 0 && ins.confirmationRate <= 1));
});

test('sitemap.xml e robots.txt', async () => {
  const sm = await fetch(`${BASE}/sitemap.xml`);
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text();
  assert.match(xml, /<urlset/);
  assert.match(xml, /\/p\/\d+/);   // anúncios
  assert.match(xml, /\/e\/\d+/);   // estabelecimentos
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/api\//);
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

test('dashboard: fila de trabalho e totais reais (sem métricas de vaidade)', async () => {
  const a = client();
  await a('/api/login', { method: 'POST', body: {
    email: 'admin@caminhosdocaparao.com.br', password: 'caparao2026' } });
  const d = await (await a('/api/dashboard')).json();
  // Fila de trabalho: contadores inteiros do que espera decisão da equipe.
  for (const k of ['pendingProducers', 'pendingListings', 'openReports']) {
    assert.ok(Number.isInteger(d.queue[k]) && d.queue[k] >= 0, `fila ${k} é inteiro >= 0`);
  }
  // Totais reais da plataforma (o seed tem turistas, produtores e anúncios).
  assert.ok(d.totals.tourists > 0, 'turistas reais do seed');
  assert.ok(d.totals.activeProducers > 0, 'produtores ativos reais do seed');
  assert.ok(d.totals.listings > 0, 'anúncios publicados reais do seed');
  assert.ok(d.totals.withListingsPct >= 0 && d.totals.withListingsPct <= 100, 'percentual coerente');
  // Mais buscados: lista ordenada por contagem (quando há eventos de busca).
  assert.ok(Array.isArray(d.topSearched), 'topSearched é lista');
  for (let i = 1; i < d.topSearched.length; i++) {
    assert.ok(d.topSearched[i - 1].searches >= d.topSearched[i].searches, 'ordenado por buscas desc');
  }
  // A plataforma não processa pagamento — não deve haver volume transacionado.
  assert.equal(d.kpis, undefined, 'sem bloco de KPIs de vaidade');
  assert.equal(d.heatmap, undefined, 'sem mapa de calor');
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

test('selo verificado: admin alterna e registra na auditoria', async () => {
  const a = client();
  await a('/api/login', { method: 'POST', body: {
    email: 'admin@caminhosdocaparao.com.br', password: 'caparao2026' } });
  const { producers } = await (await a('/api/producers?limit=1')).json();
  const id = producers[0].id;

  await a(`/api/producers/${id}/verified`, { method: 'POST', body: { verified: true } });
  const on = await (await a(`/api/producers/${id}`)).json();
  assert.equal(on.producer.verified, true);
  const { entries } = await (await a('/api/audit')).json();
  assert.ok(entries.some(e => e.action === 'producer.verified'));

  await a(`/api/producers/${id}/verified`, { method: 'POST', body: { verified: false } });
  const off = await (await a(`/api/producers/${id}`)).json();
  assert.equal(off.producer.verified, false);
});

test('denúncia de anúncio: turista denuncia, admin vê e resolve', async () => {
  const t = client();
  await t('/api/register', { method: 'POST', body: {
    name: 'Denunciante', email: `dn-${uniq}@test.com`, password: 'senha1234', role: 'tourist' } });
  assert.equal((await t('/api/reports/6', { method: 'POST', body: { reason: 'enganoso', detail: 'preço' } })).status, 201);
  // segunda denúncia do mesmo usuário no mesmo anúncio é tolerada, sem duplicar
  const dup = await t('/api/reports/6', { method: 'POST', body: { reason: 'spam' } });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).already, true);
  // motivo inválido → 400
  assert.equal((await t('/api/reports/6', { method: 'POST', body: { reason: 'qualquer' } })).status, 400);

  const a = client();
  await a('/api/login', { method: 'POST', body: {
    email: 'admin@caminhosdocaparao.com.br', password: 'caparao2026' } });
  const q = await (await a('/api/admin/reports')).json();
  const row = q.reports.find(x => x.listing_id === 6);
  assert.ok(row && row.reports >= 1, 'denúncia aparece na fila do admin');

  assert.equal((await a('/api/admin/reports/6/reviewed', { method: 'POST' })).status, 200);
  const q2 = await (await a('/api/admin/reports')).json();
  assert.ok(!q2.reports.some(x => x.listing_id === 6), 'fila zera após resolver');
});

test('upload de imagem é otimizado e gravado como WebP', async () => {
  // login do produtor e captura do cookie de sessão (multipart não passa pelo
  // client() JSON, então fazemos a chamada crua com FormData)
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'produtor@demo.com', password: 'caparao2026' }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

  // PNG grande e válido (2000x1500) enviado como image/png — a resposta deve
  // vir como .webp, provando que o pipeline de otimização rodou.
  const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#1C6B4A' } })
    .png().toBuffer();
  const form = new FormData();
  form.append('image', new Blob([png], { type: 'image/png' }), 'foto.png');
  const up = await fetch(`${BASE}/api/portal/listings/1/images`, {
    method: 'POST', headers: { cookie }, body: form,
  });
  assert.equal(up.status, 201);
  const img = await up.json();
  assert.match(img.path, /\.webp$/, 'imagem enviada deve ser convertida para WebP');
});
