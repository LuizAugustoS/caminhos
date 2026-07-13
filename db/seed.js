// Popula o banco com dados de demonstração coerentes com o painel.
// Idempotente: limpa as tabelas de domínio e recria tudo.
import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL || 'postgres://caminhos:caminhos@localhost:5432/caminhos',
});

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

await client.connect();
await client.query('BEGIN');

await client.query(`TRUNCATE admins, tourists, producers, listings, transactions,
  search_events, itineraries, chat_messages, alerts RESTART IDENTITY CASCADE`);

// ─── Admin ────────────────────────────────────────────────────────────────
const adminEmail = process.env.ADMIN_EMAIL || 'admin@caminhosdocaparao.com.br';
const adminPassword = process.env.ADMIN_PASSWORD || 'caparao2026';
await client.query(
  `INSERT INTO admins (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
  ['Marina Rocha', adminEmail, hashPassword(adminPassword)]
);

// ─── Turistas: ~1.248 nos últimos 30 dias + base anterior (para o delta) ──
await client.query(`
  INSERT INTO tourists (name, email, city, created_at)
  SELECT 'Turista ' || g,
         'turista' || g || '@example.com',
         (ARRAY['Vitória','Belo Horizonte','Rio de Janeiro','São Paulo','Guarapari','Manhuaçu'])[1 + g % 6],
         now() - (random() * interval '30 days')
  FROM generate_series(1, 1248) g`);
await client.query(`
  INSERT INTO tourists (name, email, city, created_at)
  SELECT 'Turista antigo ' || g,
         'antigo' || g || '@example.com',
         (ARRAY['Vitória','Belo Horizonte','Rio de Janeiro','São Paulo'])[1 + g % 4],
         now() - interval '30 days' - (random() * interval '30 days')
  FROM generate_series(1, 1056) g`);

// ─── Produtores em destaque (fila de moderação do painel) ────────────────
const featuredProducers = [
  ['Sítio Boa Esperança', 'Café especial · Alto Caparaó', 'SB', '#1C6B4A', 'pending', 'Alto Caparaó'],
  ['Dona Zélia Artesanatos', 'Artesanato em fibra de bananeira', 'DZ', '#C0714F', 'pending', 'Ibitirama'],
  ['Pousada Vale Verde', 'Hospedagem rural · Ibitirama', 'PV', '#8AA98F', 'approved', 'Ibitirama'],
  ['Trilhas do Bandeira', 'Guias de trekking credenciados', 'TB', '#4A3226', 'approved', 'Alto Caparaó'],
  ['Queijaria Serra Alta', 'Queijos artesanais de altitude', 'QS', '#6B8F5E', 'in_review', 'Dores do Rio Preto'],
  ['Apiário Flor da Serra', 'Mel silvestre de altitude', 'AF', '#8AA98F', 'approved', 'Iúna'],
  ['Rancho do Tião', 'Cavalgadas e passeios rurais', 'RT', '#7A4B2E', 'approved', 'Divino de S. Lourenço'],
  ['Prefeitura de Alto Caparaó', 'Eventos municipais', 'PA', '#1C6B4A', 'approved', 'Alto Caparaó'],
  ['Assoc. de Artesãos', 'Feiras e exposições coletivas', 'AA', '#C0714F', 'approved', 'Ibitirama'],
  ['Clube Astronômico Capixaba', 'Observação de estrelas', 'CA', '#8AA98F', 'approved', 'Alto Caparaó'],
  ['Café da Dona Lú', 'Cafeteria e doces da roça', 'CL', '#9A6224', 'pending', 'Manhuaçu'],
  ['Horta do Vale', 'Orgânicos e cestas semanais', 'HV', '#6B8F5E', 'pending', 'Iúna'],
  ['Cachoeira Park', 'Balneário e camping', 'CP', '#4E8563', 'pending', 'Dores do Rio Preto'],
  ['Doces da Serra', 'Doces artesanais de leite', 'DS', '#B4552F', 'pending', 'Espera Feliz'],
];
for (const [name, kind, initials, color, status, city] of featuredProducers) {
  await client.query(
    `INSERT INTO producers (name, kind, initials, avatar_color, status, city, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - (random() * interval '20 days'))`,
    [name, kind, initials, color, status, city]
  );
}
// Base de produtores aprovados para totalizar 312 ativos
await client.query(`
  INSERT INTO producers (name, kind, initials, avatar_color, status, city, created_at)
  SELECT 'Produtor Rural ' || g,
         (ARRAY['Café de altitude','Hospedagem rural','Artesanato local','Agroindústria familiar','Guia de turismo'])[1 + g % 5],
         'PR', '#5E7F66', 'approved',
         (ARRAY['Alto Caparaó','Ibitirama','Iúna','Dores do Rio Preto','Espera Feliz','Manhuaçu'])[1 + g % 6],
         now() - (random() * interval '360 days')
  FROM generate_series(1, 302) g`);

// ─── Anúncios em destaque (listas do painel) ──────────────────────────────
// [tipo, glyph, image_kind, image_label, título, subtítulo, produtor, data, status]
const featuredListings = [
  ['product', '◉', 'cafe', 'Foto: café torrado', 'Café Arábica Torra Média — 500g', 'Microlote 1.400m · nota 88 SCA', 'Sítio Boa Esperança', '2026-07-11', 'pending'],
  ['product', '✤', 'arte', 'Foto: artesanato', 'Cesto de Fibra de Bananeira', 'Peça única, tingimento natural', 'Dona Zélia Artesanatos', '2026-07-10', 'pending'],
  ['product', '◉', 'cafe', 'Foto: queijo', 'Queijo Curado da Serra — 400g', 'Maturação 60 dias', 'Queijaria Serra Alta', '2026-07-09', 'approved'],
  ['product', '✤', 'sage', 'Foto: mel', 'Mel Silvestre de Altitude — 300g', 'Florada nativa do Caparaó', 'Apiário Flor da Serra', '2026-07-08', 'approved'],
  ['service', '⛰', 'verde', 'Foto: guia de trilha', 'Guia Nascer do Sol — Pico da Bandeira', 'Saída 2h · inclui transporte 4x4', 'Trilhas do Bandeira', '2026-07-11', 'pending'],
  ['service', '◉', 'cafe', 'Foto: tour de café', 'Tour de Colheita e Torra de Café', 'Experiência de 4h com degustação', 'Sítio Boa Esperança', '2026-07-10', 'approved'],
  ['service', '✤', 'sage', 'Foto: pousada', 'Hospedagem Rural — Vale Verde', 'Café da manhã da roça incluso', 'Pousada Vale Verde', '2026-07-09', 'approved'],
  ['service', '⛰', 'verde', 'Foto: cavalgada', 'Cavalgada ao Vale Encantado', 'Percurso de 8km · meia jornada', 'Rancho do Tião', '2026-07-07', 'in_review'],
  ['event', '⛰', 'verde', 'Foto: trekking', 'Travessia do Caparaó — 3 dias', 'Trekking ES→MG · 25 vagas', 'Trilhas do Bandeira', '2026-07-18', 'pending'],
  ['event', '◉', 'cafe', 'Foto: festival', 'Festival do Café de Altitude', 'Praça central de Alto Caparaó', 'Prefeitura de Alto Caparaó', '2026-08-02', 'approved'],
  ['event', '✤', 'arte', 'Foto: feira', 'Feira de Artesanato da Serra', 'Edição de inverno · 40 expositores', 'Assoc. de Artesãos', '2026-07-26', 'approved'],
  ['event', '⛰', 'sage', 'Foto: observação', 'Noite de Observação de Estrelas', 'Terreirão do Pico · céu Bortle 2', 'Clube Astronômico Capixaba', '2026-08-15', 'in_review'],
];
for (const [type, glyph, imageKind, imageLabel, title, subtitle, producerName, date, status] of featuredListings) {
  await client.query(
    `INSERT INTO listings (producer_id, type, glyph, image_kind, image_label, title, subtitle, status, listed_at, created_at)
     SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $9::date + time '10:00'
     FROM producers WHERE name = $1 LIMIT 1`,
    [producerName, type, glyph, imageKind, imageLabel, title, subtitle, status, date]
  );
}
// Base de anúncios aprovados para totalizar ~2.037
await client.query(`
  INSERT INTO listings (producer_id, type, glyph, image_kind, image_label, title, subtitle, status, listed_at, created_at)
  SELECT 15 + (g % 300),
         (ARRAY['product','service','event'])[1 + g % 3]::listing_type,
         (ARRAY['◉','✤','⛰'])[1 + g % 3],
         (ARRAY['cafe','arte','verde','sage'])[1 + g % 4],
         'Foto do anúncio',
         (ARRAY['Café da roça','Doce de leite artesanal','Trilha guiada','Hospedagem de montanha','Feira local','Passeio rural'])[1 + g % 6] || ' #' || g,
         'Anúncio gerado para demonstração',
         'approved',
         (now() - (random() * interval '180 days'))::date,
         now() - (random() * interval '180 days')
  FROM generate_series(1, 2025) g`);

// ─── Transações: ~R$ 96,4 mil no mês corrente + mês anterior menor ────────
await client.query(`
  INSERT INTO transactions (listing_id, amount_cents, created_at)
  SELECT 1 + (g % 2000),
         12000 + (random() * 38000)::int,
         date_trunc('month', now()) + (random() * (now() - date_trunc('month', now())))
  FROM generate_series(1, 310) g`);
await client.query(`
  INSERT INTO transactions (listing_id, amount_cents, created_at)
  SELECT 1 + (g % 2000),
         12000 + (random() * 36000)::int,
         date_trunc('month', now()) - interval '1 month'
           + (random() * interval '27 days')
  FROM generate_series(1, 255) g`);

// ─── Buscas: mapa de calor 12×6 (últimos 7 dias) + semana anterior ────────
// Intensidades 0..5 por célula, espelhando o relevo da região.
const heatMap = [
  0,0,1,1,0,0,1,2,1,0,0,0,
  0,1,2,3,2,1,2,3,2,1,0,0,
  1,2,3,4,3,2,3,4,3,2,1,0,
  1,2,4,5,4,3,4,5,4,2,1,1,
  0,1,3,4,5,4,3,4,3,1,1,0,
  0,0,1,2,3,2,2,2,1,0,0,0,
];
const spots = ['Pico da Bandeira', 'Alto Caparaó', 'Ibitirama', 'Dores do Rio Preto', 'Divino de S. Lourenço', 'Iúna'];
for (let i = 0; i < heatMap.length; i++) {
  const level = heatMap[i];
  if (level === 0) continue;
  const row = Math.floor(i / 12);
  const col = i % 12;
  const spot = spots[i % spots.length];
  // Semana atual: ~38 buscas por nível; semana anterior: ~31 (≈ +22%)
  await client.query(
    `INSERT INTO search_events (spot, grid_row, grid_col, created_at)
     SELECT $1, $2, $3, now() - (random() * interval '7 days')
     FROM generate_series(1, $4)`,
    [spot, row, col, level * 38]
  );
  await client.query(
    `INSERT INTO search_events (spot, grid_row, grid_col, created_at)
     SELECT $1, $2, $3, now() - interval '7 days' - (random() * interval '7 days')
     FROM generate_series(1, $4)`,
    [spot, row, col, level * 31]
  );
}

// ─── Itinerários (37 prontos para uso offline no PWA) ─────────────────────
await client.query(`
  INSERT INTO itineraries (title, region, duration, offline_ready, updated_at)
  SELECT 'Itinerário ' || g || ' — ' ||
         (ARRAY['Pico da Bandeira','Vale Encantado','Rota do Café','Cachoeiras de Ibitirama','Serra do Caparaó'])[1 + g % 5],
         (ARRAY['ES','MG','ES/MG'])[1 + g % 3],
         (ARRAY['meio dia','1 dia','2 dias','3 dias'])[1 + g % 4],
         g <= 37,
         now() - interval '12 minutes'
  FROM generate_series(1, 42) g`);

// ─── Chat interno ──────────────────────────────────────────────────────────
const chats = [
  ['João (Trilhas do Bandeira)', 'JT', '#1C6B4A', 'Bom dia! Atualizei as vagas da travessia de julho — podem revisar a publicação?', '3 hours'],
  ['Dona Zélia', 'DZ', '#C0714F', 'Enviei as fotos novas dos cestos. Preciso de ajuda com o frete para fora do ES.', '5 hours'],
  ['Pousada Vale Verde', 'PV', '#8AA98F', 'Confirmado: pacote do Festival do Café com 2 diárias + tour incluído.', '26 hours'],
];
for (const [name, initials, color, body, ago] of chats) {
  await client.query(
    `INSERT INTO chat_messages (sender_name, sender_initials, avatar_color, body, created_at)
     VALUES ($1, $2, $3, $4, now() - $5::interval)`,
    [name, initials, color, body, ago]
  );
}

// ─── Alertas ───────────────────────────────────────────────────────────────
const alerts = [
  ['Backup de itinerários offline concluído', 'Sistema · há 12 min', 'success', '12 minutes'],
  ['6 cadastros aguardam revisão há mais de 48h', 'Fila de moderação · hoje', 'warning', '2 hours'],
  ['Novo pico de acessos via PWA instalado', 'Analytics · +31% ontem', 'info', '20 hours'],
];
for (const [title, meta, severity, ago] of alerts) {
  await client.query(
    `INSERT INTO alerts (title, meta, severity, created_at)
     VALUES ($1, $2, $3, now() - $4::interval)`,
    [title, meta, severity, ago]
  );
}

await client.query('COMMIT');

const counts = await client.query(`
  SELECT (SELECT count(*) FROM tourists)      AS tourists,
         (SELECT count(*) FROM producers)     AS producers,
         (SELECT count(*) FROM listings)      AS listings,
         (SELECT count(*) FROM transactions)  AS transactions,
         (SELECT count(*) FROM search_events) AS searches,
         (SELECT count(*) FROM itineraries)   AS itineraries`);
console.log('Seed concluído:', counts.rows[0]);
console.log(`Admin: ${adminEmail} / ${adminPassword}`);
await client.end();
