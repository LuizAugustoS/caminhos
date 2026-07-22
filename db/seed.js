// Popula o banco com dados de demonstração coerentes com o painel.
// Idempotente: limpa as tabelas de domínio e recria tudo.
import '../server/env.js';
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
// remove acentos para gerar e-mails/identificadores em ASCII
const asciify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

await client.connect();
await client.query('BEGIN');

await client.query(`TRUNCATE users, tourists, producers, listings, transactions,
  search_events, itineraries, chat_messages, alerts, establishments, trips,
  trip_items, favorites, conversations, messages RESTART IDENTITY CASCADE`);

// ─── Usuários (admin + contas demo de turista e produtor) ─────────────────
const adminEmail = process.env.ADMIN_EMAIL || 'admin@caminhosdocaparao.com.br';
const adminPassword = process.env.ADMIN_PASSWORD || 'caparao2026';
const demoPassword = process.env.DEMO_PASSWORD || 'caparao2026';
const { rows: [adminUser] } = await client.query(
  `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
  ['Marina Rocha', adminEmail, hashPassword(adminPassword)]
);
const { rows: [touristUser] } = await client.query(
  `INSERT INTO users (name, email, password_hash, role, city) VALUES ($1, $2, $3, 'tourist', 'Vitória') RETURNING id`,
  ['Ana Ribeiro', 'turista@demo.com', hashPassword(demoPassword)]
);
const { rows: [producerUser] } = await client.query(
  `INSERT INTO users (name, email, password_hash, role, city) VALUES ($1, $2, $3, 'producer', 'Alto Caparaó') RETURNING id`,
  ['Sebastião Moreira', 'produtor@demo.com', hashPassword(demoPassword)]
);

// ─── Pools de nomes (turistas e negócios da região) ───────────────────────
const firstNames = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
  'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago',
  'Vanessa', 'Vinícius', 'Beatriz', 'Caio', 'Débora', 'Fernando', 'Juliana', 'Leonardo', 'Mariana',
  'Pedro', 'Renata', 'Lucas', 'Camila', 'Gustavo', 'Letícia', 'Rodrigo', 'Amanda', 'Diego', 'Priscila', 'André'];
const surnames = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Pereira', 'Costa', 'Almeida', 'Ferreira',
  'Rodrigues', 'Gomes', 'Martins', 'Araújo', 'Barbosa', 'Ribeiro', 'Carvalho', 'Lima', 'Rocha',
  'Nascimento', 'Cardoso', 'Teixeira', 'Moreira', 'Correia', 'Dias', 'Nunes', 'Mendes', 'Freitas',
  'Andrade', 'Cavalcante', 'Monteiro', 'Reis'];
const originCities = ['Vitória', 'Vila Velha', 'Serra', 'Cariacica', 'Guarapari', 'Belo Horizonte',
  'Juiz de Fora', 'Manhuaçu', 'Rio de Janeiro', 'Niterói', 'São Paulo', 'Campinas', 'Muriaé',
  'Cachoeiro de Itapemirim', 'Governador Valadares', 'Ipatinga'];

// Gera turistas com nomes reais e e-mails coerentes, em duas janelas de tempo
// (necessárias para o delta "novos turistas" do painel).
function buildTourists(n, minDaysAgo, maxDaysAgo, offset) {
  const names = [], emails = [], cities = [], created = [];
  const seenEmail = new Set();
  for (let i = 0; i < n; i++) {
    const k = i + offset;
    const f = firstNames[(k * 3 + 1) % firstNames.length];
    const s = surnames[(k * 7 + 5) % surnames.length];
    names.push(`${f} ${s}`);
    let email = `${asciify(f)}.${asciify(s)}@email.com`;
    if (seenEmail.has(email)) email = `${asciify(f)}.${asciify(s)}${k}@email.com`;
    seenEmail.add(email);
    emails.push(email);
    cities.push(originCities[(k * 5) % originCities.length]);
    const days = minDaysAgo + Math.random() * (maxDaysAgo - minDaysAgo);
    created.push(new Date(Date.now() - days * 86400000));
  }
  return { names, emails, cities, created };
}
async function insertTourists({ names, emails, cities, created }) {
  await client.query(
    `INSERT INTO tourists (name, email, city, created_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[])`,
    [names, emails, cities, created.map(d => d.toISOString())]
  );
}
// ~1.248 nos últimos 30 dias + ~1.056 na janela anterior (30–60 dias)
await insertTourists(buildTourists(1248, 0, 30, 0));
await insertTourists(buildTourists(1056, 30, 60, 5000));

// ─── Produtores em destaque (fila de moderação do painel) ────────────────
const featuredProducers = [
  ['Sítio Boa Esperança', 'Café especial · Alto Caparaó', 'SB', '#1C6B4A', 'pending', 'Alto Caparaó'],
  ['Dona Zélia Artesanatos', 'Artesanato em fibra de bananeira', 'DZ', '#C0714F', 'pending', 'Ibitirama'],
  ['Pousada Vale Verde', 'Hospedagem rural · Ibitirama', 'PV', '#8AA98F', 'approved', 'Ibitirama'],
  ['Trilhas do Bandeira', 'Guias de trekking credenciados', 'TB', '#4A3226', 'approved', 'Alto Caparaó'],
  ['Queijaria Serra Alta', 'Queijos artesanais de altitude', 'QS', '#6B8F5E', 'in_review', 'Dores do Rio Preto'],
  ['Apiário Flor da Serra', 'Mel silvestre de altitude', 'AF', '#8AA98F', 'approved', 'Iúna'],
  ['Rancho do Tião', 'Cavalgadas e passeios rurais', 'RT', '#7A4B2E', 'approved', 'Divino de São Lourenço'],
  ['Prefeitura de Alto Caparaó', 'Eventos municipais', 'PA', '#1C6B4A', 'approved', 'Alto Caparaó'],
  ['Associação de Artesãos do Caparaó', 'Feiras e exposições coletivas', 'AA', '#C0714F', 'approved', 'Ibitirama'],
  ['Clube Astronômico Capixaba', 'Observação de estrelas', 'CA', '#8AA98F', 'approved', 'Alto Caparaó'],
  ['Café da Dona Lú', 'Cafeteria e doces da roça', 'CL', '#9A6224', 'pending', 'Manhuaçu'],
  ['Horta do Vale', 'Orgânicos e cestas semanais', 'HV', '#6B8F5E', 'pending', 'Iúna'],
  ['Cachoeira do Prata', 'Balneário e camping', 'CP', '#4E8563', 'pending', 'Dores do Rio Preto'],
  ['Doces da Serra', 'Doces artesanais de leite', 'DS', '#B4552F', 'pending', 'Espera Feliz'],
];
for (const [name, kind, initials, color, status, city] of featuredProducers) {
  await client.query(
    `INSERT INTO producers (name, kind, initials, avatar_color, status, city, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - (random() * interval '20 days'))`,
    [name, kind, initials, color, status, city]
  );
}

// Base de produtores aprovados (nomes de negócios plausíveis) para os 312 ativos
const bizPrefix = ['Sítio', 'Fazenda', 'Recanto', 'Chácara', 'Rancho', 'Cantinho', 'Pousada', 'Casa', 'Roça', 'Vale'];
const bizName = ['Boa Vista', 'da Serra', 'do Café', 'Bela Vista', 'do Vale', 'das Palmeiras', 'Santa Rita',
  'São José', 'do Ipê', 'da Montanha', 'Flor da Mata', 'do Riacho', 'Sol Nascente', 'da Colina', 'do Mirante',
  'da Cachoeira', 'Santa Luzia', 'do Compadre', 'da Vovó Rosa', 'São Sebastião', 'do Juca', 'Verde Vale',
  'da Pedra', 'dos Ventos', 'Nova Esperança', 'do Horizonte', 'Vista Alegre', 'da Neblina', 'do Cafezal',
  'Terra Boa', 'do Bosque', 'das Andorinhas', 'Céu Aberto', 'da Figueira', 'do Contentamento'];
const bizKind = ['Café especial de altitude', 'Queijos artesanais', 'Hospedagem rural', 'Artesanato regional',
  'Mel e derivados', 'Cachaça artesanal', 'Doces caseiros', 'Guia de trilhas', 'Passeios a cavalo',
  'Cestas orgânicas', 'Cafeteria de fazenda', 'Camping e balneário', 'Panificação artesanal', 'Laticínios da roça'];
const bizColor = ['#1C6B4A', '#8AA98F', '#C0714F', '#4A3226', '#6B8F5E', '#9A6224', '#4E8563', '#7A4B2E'];
const regionCities = ['Alto Caparaó', 'Caparaó', 'Ibitirama', 'Iúna', 'Dores do Rio Preto',
  'Divino de São Lourenço', 'Espera Feliz', 'Manhuaçu', 'Alto Jequitibá', 'Ipê Amarelo'];
{
  // Produto cartesiano prefixo×nome (350 combinações), filtrando colisões
  const featured = new Set(featuredProducers.map(p => p[0]));
  const combos = [];
  for (const nm of bizName) for (const p of bizPrefix) {
    const name = `${p} ${nm}`;
    if (!featured.has(name)) combos.push([p, nm, name]);
  }
  const names = [], kinds = [], initials = [], colors = [], cities = [], created = [];
  combos.slice(0, 298).forEach(([p, nm, name], i) => {
    names.push(name);
    kinds.push(bizKind[(i * 5) % bizKind.length]);
    const nmWord = nm.replace(/[^A-Za-zÀ-ÿ]/g, '') || 'C';
    initials.push((p[0] + nmWord[0]).toUpperCase());
    colors.push(bizColor[i % bizColor.length]);
    cities.push(regionCities[(i * 2) % regionCities.length]);
    created.push(new Date(Date.now() - Math.random() * 360 * 86400000).toISOString());
  });
  await client.query(
    `INSERT INTO producers (name, kind, initials, avatar_color, status, city, created_at)
     SELECT n, k, ini, c, 'approved', ci, cr
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
       AS t(n, k, ini, c, ci, cr)`,
    [names, kinds, initials, colors, cities, created]
  );
}

// Planos de parceiro: alguns nomes conhecidos em planos pagos (o restante fica no Gratuito)
await client.query(
  `UPDATE producers SET plan = 'premium'
   WHERE name IN ('Sítio Boa Esperança', 'Pousada Vale Verde', 'Trilhas do Bandeira')`
);
await client.query(
  `UPDATE producers SET plan = 'profissional'
   WHERE name IN ('Apiário Flor da Serra', 'Rancho do Tião', 'Dona Zélia Artesanatos')`
);

// Selo "Verificado": alguns parceiros conferidos pela equipe (independe do plano)
await client.query(
  `UPDATE producers SET verified = true
   WHERE name IN ('Sítio Boa Esperança', 'Pousada Vale Verde', 'Apiário Flor da Serra')`
);

// Vincula as contas demo e cria o registro de turista demo
await client.query(
  `UPDATE producers SET user_id = $1, status = 'approved' WHERE name = 'Sítio Boa Esperança'`,
  [producerUser.id]
);
await client.query(
  `INSERT INTO tourists (name, email, city, user_id, created_at)
   VALUES ('Ana Ribeiro', 'turista@demo.com', 'Vitória', $1, now())`,
  [touristUser.id]
);

// ─── Estabelecimentos dos parceiros em destaque (perfis completos) ────────
const establishments = [
  ['Sítio Boa Esperança', 'Café especial cultivado a 1.400 m, colhido à mão e torrado na fazenda. Recebe visitas para tour de colheita e degustação, com agendamento.', 'Café e agroturismo', 'Alto Caparaó', 'Estrada da Cachoeira, km 6 — zona rural', '(32) 99145-2087', 'Ter a Dom, 8h às 17h'],
  ['Dona Zélia Artesanatos', 'Peças de fibra de bananeira e palha trançada, com tingimento natural. Ateliê aberto a visitantes e oficinas sob encomenda.', 'Artesanato', 'Ibitirama', 'Rua das Flores, 128 — Centro', '(28) 99961-4410', 'Seg a Sex, 9h às 18h'],
  ['Pousada Vale Verde', 'Hospedagem rural com sete chalés, café da manhã da roça e vista para a serra. Aceita pets e organiza passeios.', 'Hospedagem', 'Ibitirama', 'Córrego São João, s/n — Pedra Menina', '(28) 99872-3355', 'Recepção 24h'],
  ['Trilhas do Bandeira', 'Guias credenciados para o Pico da Bandeira e travessias ES–MG. Saídas para nascer do sol e trekking de 3 dias.', 'Guias e trilhas', 'Alto Caparaó', 'Portaria do Parque, Alto Caparaó', '(32) 99230-7788', 'Todos os dias, 5h às 19h'],
  ['Queijaria Serra Alta', 'Queijos de altitude com maturação natural em câmara própria. Visita à queijaria e prova guiada aos sábados.', 'Laticínios', 'Dores do Rio Preto', 'Rodovia ES-482, km 12', '(28) 99604-1129', 'Sáb e Dom, 9h às 16h'],
  ['Apiário Flor da Serra', 'Mel silvestre de florada nativa, própolis e favos. Vende na fazenda e em feiras da região.', 'Apicultura', 'Iúna', 'Distrito de Laranja da Terra, s/n', '(28) 99518-6642', 'Seg a Sáb, 8h às 17h'],
  ['Rancho do Tião', 'Cavalgadas guiadas ao Vale Encantado e passeios de meia jornada. Cavalos mansos, ideal para famílias.', 'Passeios a cavalo', 'Divino de São Lourenço', 'Sítio Pedra Roxa, zona rural', '(28) 99447-9015', 'Qua a Dom, 7h às 16h'],
  ['Prefeitura de Alto Caparaó', 'Secretaria de Turismo — organiza o Festival do Café de Altitude e a agenda cultural do município.', 'Poder público', 'Alto Caparaó', 'Praça Ademar Pimenta de Souza, 10 — Centro', '(32) 3747-2510', 'Seg a Sex, 8h às 17h'],
  ['Associação de Artesãos do Caparaó', 'Coletivo de 40 artesãos da serra. Realiza feiras mensais e exposições de peças em fibra, madeira e cerâmica.', 'Artesanato', 'Ibitirama', 'Casa de Cultura, Rua Principal, 55', '(28) 99730-2204', 'Sex a Dom, 9h às 18h'],
  ['Clube Astronômico Capixaba', 'Noites de observação no Terreirão do Pico, com telescópios e monitoria. Céu Bortle 2, um dos mais escuros do Sudeste.', 'Astroturismo', 'Alto Caparaó', 'Terreirão, interior do Parque', '(27) 99181-5573', 'Conforme agenda lunar'],
  ['Café da Dona Lú', 'Cafeteria de fazenda com pães, bolos e doces da roça. Serve o café da própria colheita.', 'Gastronomia', 'Manhuaçu', 'Av. Getúlio Vargas, 340 — Centro', '(33) 99856-1290', 'Ter a Dom, 7h às 19h'],
  ['Horta do Vale', 'Produção orgânica certificada. Entrega cestas semanais em Iúna e cidades vizinhas.', 'Orgânicos', 'Iúna', 'Estrada do Vale, km 3', '(28) 99312-4478', 'Seg a Sáb, 7h às 16h'],
  ['Cachoeira do Prata', 'Balneário natural com camping, quiosque e trilha curta até a queda. Estrutura para o dia inteiro.', 'Balneário', 'Dores do Rio Preto', 'Comunidade do Prata, zona rural', '(28) 99655-8830', 'Sáb, Dom e feriados, 8h às 18h'],
  ['Doces da Serra', 'Doces de leite, geleias e compotas em tacho de cobre, com frutas da estação.', 'Doces caseiros', 'Espera Feliz', 'Rua São João Batista, 77 — Centro', '(32) 99274-6631', 'Seg a Sáb, 8h às 18h'],
];
for (const [name, description, category, city, address, phone, hours] of establishments) {
  await client.query(
    `INSERT INTO establishments (producer_id, name, description, category, city, address, phone, open_hours)
     SELECT id, $1, $2, $3, $4, $5, $6, $7 FROM producers WHERE name = $1 LIMIT 1`,
    [name, description, category, city, address, phone, hours]
  );
}

// Coordenadas aproximadas na região do Caparaó (mapa do Explorar / como chegar)
const estCoords = [
  ['Sítio Boa Esperança', -20.4530, -41.8420],
  ['Dona Zélia Artesanatos', -20.5401, -41.6663],
  ['Pousada Vale Verde', -20.5946, -41.7592],
  ['Trilhas do Bandeira', -20.4855, -41.8390],
  ['Queijaria Serra Alta', -20.6903, -41.8360],
  ['Apiário Flor da Serra', -20.3460, -41.5350],
  ['Rancho do Tião', -20.6270, -41.6920],
  ['Prefeitura de Alto Caparaó', -20.4325, -41.8683],
  ['Associação de Artesãos do Caparaó', -20.5390, -41.6650],
  ['Clube Astronômico Capixaba', -20.4680, -41.8050],
  ['Café da Dona Lú', -20.2582, -42.0336],
  ['Horta do Vale', -20.3600, -41.5500],
  ['Cachoeira do Prata', -20.7050, -41.7830],
  ['Doces da Serra', -20.6500, -41.9080],
];
for (const [name, lat, lng] of estCoords) {
  await client.query('UPDATE establishments SET lat = $2, lng = $3 WHERE name = $1', [name, lat, lng]);
}

// ─── Anúncios em destaque (listas do painel) ──────────────────────────────
// [tipo, glyph, image_kind, image_label, título, subtítulo, produtor, data, status,
//  preço em centavos (null = sob consulta), unidade, data/hora/local do evento]
const featuredListings = [
  ['product', '◉', 'cafe', 'Foto: café torrado', 'Café Arábica Torra Média — 500g', 'Microlote 1.400m · nota 88 SCA', 'Sítio Boa Esperança', '2026-07-11', 'pending', 4800, '500g', null, null, null],
  ['product', '✤', 'arte', 'Foto: artesanato', 'Cesto de Fibra de Bananeira', 'Peça única, tingimento natural', 'Dona Zélia Artesanatos', '2026-07-10', 'pending', 12000, 'peça', null, null, null],
  ['product', '◉', 'cafe', 'Foto: queijo', 'Queijo Curado da Serra — 400g', 'Maturação 60 dias', 'Queijaria Serra Alta', '2026-07-09', 'approved', 5600, '400g', null, null, null],
  ['product', '✤', 'sage', 'Foto: mel', 'Mel Silvestre de Altitude — 300g', 'Florada nativa do Caparaó', 'Apiário Flor da Serra', '2026-07-08', 'approved', 3200, '300g', null, null, null],
  ['service', '⛰', 'verde', 'Foto: guia de trilha', 'Guia Nascer do Sol — Pico da Bandeira', 'Saída 2h · inclui transporte 4x4', 'Trilhas do Bandeira', '2026-07-11', 'pending', 18000, 'por pessoa', null, null, null],
  ['service', '◉', 'cafe', 'Foto: tour de café', 'Tour de Colheita e Torra de Café', 'Experiência de 4h com degustação', 'Sítio Boa Esperança', '2026-07-10', 'approved', 9500, 'por pessoa', null, null, null],
  ['service', '✤', 'sage', 'Foto: pousada', 'Hospedagem Rural — Vale Verde', 'Café da manhã da roça incluso', 'Pousada Vale Verde', '2026-07-09', 'approved', 28000, 'diária p/ casal', null, null, null],
  ['service', '⛰', 'verde', 'Foto: cavalgada', 'Cavalgada ao Vale Encantado', 'Percurso de 8km · meia jornada', 'Rancho do Tião', '2026-07-07', 'in_review', 12000, 'por pessoa', null, null, null],
  ['event', '⛰', 'verde', 'Foto: trekking', 'Travessia do Caparaó — 3 dias', 'Trekking ES→MG · 25 vagas', 'Trilhas do Bandeira', '2026-07-18', 'pending', 68000, 'por pessoa', '2026-08-21', '5h — concentração', 'Portaria de Pedra Menina'],
  ['event', '◉', 'cafe', 'Foto: festival', 'Festival do Café de Altitude', 'Praça central de Alto Caparaó', 'Prefeitura de Alto Caparaó', '2026-08-02', 'approved', null, 'entrada gratuita', '2026-08-08', '9h às 22h', 'Praça central de Alto Caparaó'],
  ['event', '✤', 'arte', 'Foto: feira', 'Feira de Artesanato da Serra', 'Edição de inverno · 40 expositores', 'Associação de Artesãos do Caparaó', '2026-07-26', 'approved', null, 'entrada gratuita', '2026-08-01', '9h às 18h', 'Casa de Cultura de Ibitirama'],
  ['event', '⛰', 'sage', 'Foto: observação', 'Noite de Observação de Estrelas', 'Terreirão do Pico · céu Bortle 2', 'Clube Astronômico Capixaba', '2026-08-15', 'in_review', 4000, 'por pessoa', '2026-08-22', '19h às 23h', 'Terreirão do Pico'],
];
// Sem foto real na demo: capa fica com o placeholder editorial (monograma).
// Produtores reais sobem as próprias fotos pela vitrine.
for (const [type, glyph, imageKind, imageLabel, title, subtitle, producerName, date, status,
            priceCents, priceUnit, eventDate, eventTime, eventPlace] of featuredListings) {
  await client.query(
    `INSERT INTO listings (producer_id, type, glyph, image_kind, image_label, image_path, title, subtitle, status, listed_at, created_at,
                           price_cents, price_unit, event_date, event_time, event_place)
     SELECT id, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $9::date + time '10:00', $10, $11, $12, $13, $14
     FROM producers WHERE name = $1 LIMIT 1`,
    [producerName, type, glyph, imageKind, imageLabel, title, subtitle, status, date,
     priceCents, priceUnit, eventDate, eventTime, eventPlace]
  );
}
// Base de anúncios aprovados (invisível nas listas — só compõe o total do painel).
// Marcados com image_label 'Foto do anúncio', que as telas filtram.
await client.query(`
  INSERT INTO listings (producer_id, type, glyph, image_kind, image_label, title, subtitle, status, listed_at, created_at)
  SELECT 15 + (g % 298),
         (ARRAY['product','service','event'])[1 + g % 3]::listing_type,
         (ARRAY['◉','✤','⛰'])[1 + g % 3],
         (ARRAY['cafe','arte','verde','sage'])[1 + g % 4],
         'Foto do anúncio',
         'anuncio-' || g, 'anuncio-' || g,
         'approved',
         (now() - (random() * interval '180 days'))::date,
         now() - (random() * interval '180 days')
  FROM generate_series(1, 2025) g`);

// ─── Avaliações de demonstração (reserva concluída → avaliação) ───────────
const reviewers = [];
for (const [name, email] of [
  ['Beatriz Monteiro', 'beatriz.monteiro@demo.com'],
  ['Caio Andrade', 'caio.andrade@demo.com'],
  ['Renata Freitas', 'renata.freitas@demo.com'],
]) {
  const { rows: [u] } = await client.query(
    `INSERT INTO users (name, email, password_hash, role, city)
     VALUES ($1, $2, $3, 'tourist', 'Vitória') RETURNING id`,
    [name, email, hashPassword(demoPassword)]
  );
  reviewers.push(u.id);
}
const demoReviews = [
  ['Tour de Colheita e Torra de Café', 0, 5, 'Experiência incrível — a degustação no terreiro vale cada minuto.'],
  ['Tour de Colheita e Torra de Café', 1, 5, 'O produtor conhece cada pé de café da propriedade. Voltaremos!'],
  ['Hospedagem Rural — Vale Verde', 2, 4, 'Quarto simples e impecável, café da manhã da roça maravilhoso.'],
  ['Hospedagem Rural — Vale Verde', 0, 5, null],
  ['Mel Silvestre de Altitude — 300g', 2, 5, 'Mel escuro e perfumado, comprei mais três potes.'],
  ['Feira de Artesanato da Serra', 1, 4, 'Feira organizada e cheia de peças bonitas — vale a visita.'],
];
for (const [title, ri, rating, comment] of demoReviews) {
  const touristId = reviewers[ri];
  const { rows: [bk] } = await client.query(
    `INSERT INTO bookings (listing_id, tourist_id, producer_id, status, qty, created_at, responded_at, completed_at)
     SELECT l.id, $2, l.producer_id, 'completed', 1,
            now() - interval '20 days', now() - interval '19 days', now() - interval '12 days'
     FROM listings l WHERE l.title = $1 LIMIT 1
     RETURNING id, listing_id, producer_id`,
    [title, touristId]
  );
  if (!bk) continue;
  await client.query(
    `INSERT INTO reviews (booking_id, listing_id, producer_id, tourist_id, rating, comment, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - (random() * interval '10 days'))`,
    [bk.id, bk.listing_id, bk.producer_id, touristId, rating, comment]
  );
}

// Uma resposta pública de exemplo do parceiro à avaliação mais recente
await client.query(
  `UPDATE reviews SET reply = $1, reply_at = now() - interval '2 days'
   WHERE id = (SELECT id FROM reviews ORDER BY created_at DESC LIMIT 1)`,
  ['Muito obrigado pela visita! Foi um prazer receber vocês — voltem sempre que quiserem repetir a colheita. ☕']
);

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
const heatMap = [
  0, 0, 1, 1, 0, 0, 1, 2, 1, 0, 0, 0,
  0, 1, 2, 3, 2, 1, 2, 3, 2, 1, 0, 0,
  1, 2, 3, 4, 3, 2, 3, 4, 3, 2, 1, 0,
  1, 2, 4, 5, 4, 3, 4, 5, 4, 2, 1, 1,
  0, 1, 3, 4, 5, 4, 3, 4, 3, 1, 1, 0,
  0, 0, 1, 2, 3, 2, 2, 2, 1, 0, 0, 0,
];
const spots = ['Pico da Bandeira', 'Alto Caparaó', 'Ibitirama', 'Dores do Rio Preto', 'Divino de São Lourenço', 'Iúna'];
for (let i = 0; i < heatMap.length; i++) {
  const level = heatMap[i];
  if (level === 0) continue;
  const row = Math.floor(i / 12);
  const col = i % 12;
  const spot = spots[i % spots.length];
  await client.query(
    `INSERT INTO search_events (spot, grid_row, grid_col, created_at)
     SELECT $1, $2, $3, now() - (random() * interval '7 days') FROM generate_series(1, $4)`,
    [spot, row, col, level * 38]
  );
  await client.query(
    `INSERT INTO search_events (spot, grid_row, grid_col, created_at)
     SELECT $1, $2, $3, now() - interval '7 days' - (random() * interval '7 days') FROM generate_series(1, $4)`,
    [spot, row, col, level * 31]
  );
}

// ─── Itinerários publicados (roteiros curados da equipe) ──────────────────
const itineraries = [
  ['Nascer do sol no Pico da Bandeira', 'ES/MG', '1 dia'],
  ['Travessia Serra do Caparaó — ES a MG', 'ES/MG', '3 dias'],
  ['Rota do Café de Altitude', 'MG', '1 dia'],
  ['Circuito das Cachoeiras de Ibitirama', 'ES', '1 dia'],
  ['Vale Encantado e Terreirão', 'MG', '2 dias'],
  ['Pico da Bandeira pela vertente mineira', 'MG', '2 dias'],
  ['Fim de semana em Divino de São Lourenço', 'ES', '2 dias'],
  ['Trilha da Cachoeira Bonita', 'ES', 'meio dia'],
  ['Observação de estrelas no Terreirão', 'MG', '1 dia'],
  ['Cavalgada ao Vale Encantado', 'ES', 'meio dia'],
  ['Volta das águas de Iúna', 'ES', '1 dia'],
  ['Subida ao Pico com pernoite no Terreirão', 'MG', '2 dias'],
  ['Café, queijo e serra em Dores do Rio Preto', 'ES', '1 dia'],
  ['Roteiro do artesanato do Caparaó', 'ES', '1 dia'],
  ['Caminho da Pedra Roxa', 'ES', 'meio dia'],
  ['Circuito gastronômico de Alto Caparaó', 'MG', '1 dia'],
  ['Trekking do Vale do Rio Preto', 'ES', '2 dias'],
  ['Banho de cachoeira em Pedra Menina', 'ES', 'meio dia'],
  ['Rota das pousadas rurais de Ibitirama', 'ES', '2 dias'],
  ['Mirante da Serra ao entardecer', 'MG', 'meio dia'],
  ['Colheita de café no Sítio Boa Esperança', 'MG', 'meio dia'],
  ['Três dias de trilhas e roça no Caparaó', 'ES/MG', '3 dias'],
  ['Festival do Café de Altitude', 'MG', '1 dia'],
  ['Pico da Bandeira pela vertente capixaba', 'ES', '2 dias'],
  ['Roteiro das cachaças artesanais da serra', 'MG', '1 dia'],
  ['Passeio de bike pelo Vale do Rio Preto', 'ES', '1 dia'],
  ['Noite astronômica + nascer do sol', 'MG', '2 dias'],
  ['Feira e ateliês de artesanato', 'ES', 'meio dia'],
  ['Caminho dos apiários de altitude', 'ES', '1 dia'],
  ['Trilha leve da Cachoeira do Prata', 'ES', 'meio dia'],
  ['Roteiro família: fazenda e balneário', 'ES', '1 dia'],
  ['Serra do Caparaó em quatro cachoeiras', 'ES/MG', '2 dias'],
  ['Do café à mesa: da colheita à degustação', 'MG', '1 dia'],
  ['Acampamento no Terreirão', 'MG', '2 dias'],
  ['Volta longa do Pico da Bandeira', 'ES/MG', '3 dias'],
  ['Cavalgada e pôr do sol no Vale', 'ES', 'meio dia'],
  ['Rota dos queijos de altitude', 'ES', '1 dia'],
  ['Manhã de observação de aves', 'MG', 'meio dia'],
  ['Circuito histórico de Alto Jequitibá', 'MG', '1 dia'],
  ['Descida das cachoeiras de Divino', 'ES', '1 dia'],
  ['Retiro de fim de semana na serra', 'ES/MG', '2 dias'],
  ['Trilha noturna guiada ao mirante', 'MG', 'meio dia'],
];
{
  const titles = [], regions = [], durations = [], offline = [];
  itineraries.forEach(([title, region, duration], i) => {
    titles.push(title); regions.push(region); durations.push(duration); offline.push(i < 37);
  });
  await client.query(
    `INSERT INTO itineraries (title, region, duration, offline_ready, updated_at)
     SELECT t, r, d, o, now() - interval '12 minutes'
     FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[]) AS x(t, r, d, o)`,
    [titles, regions, durations, offline]
  );
}

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

// ─── Roteiro demo do turista (offline-first) ───────────────────────────────
const { rows: [trip] } = await client.query(
  `INSERT INTO trips (user_id, client_uid, title, notes)
   VALUES ($1, 'seed-trip-1', 'Fim de semana no Caparaó', 'Chegada sexta à noite, subida ao pico no sábado.')
   RETURNING id`,
  [touristUser.id]
);
await client.query(`
  INSERT INTO trip_items (trip_id, client_uid, position, listing_id, label, note)
  VALUES
    ($1, 'seed-item-1', 0, (SELECT id FROM listings WHERE title LIKE 'Guia Nascer do Sol%' LIMIT 1), NULL, 'Levar agasalho — madrugada fria'),
    ($1, 'seed-item-2', 1, (SELECT id FROM listings WHERE title LIKE 'Tour de Colheita%' LIMIT 1), NULL, NULL),
    ($1, 'seed-item-3', 2, NULL, 'Almoço na praça de Alto Caparaó', NULL)`,
  [trip.id]
);
await client.query(
  `INSERT INTO favorites (user_id, listing_id)
   SELECT $1, id FROM listings WHERE title LIKE 'Café Arábica%' OR title LIKE 'Travessia do Caparaó%'`,
  [touristUser.id]
);

// ─── Conversa demo turista ↔ produtor ──────────────────────────────────────
const { rows: [conv] } = await client.query(
  `INSERT INTO conversations (tourist_id, producer_id)
   VALUES ($1, (SELECT id FROM producers WHERE name = 'Sítio Boa Esperança'))
   RETURNING id`,
  [touristUser.id]
);
await client.query(
  `INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES
   ($1, $2, 'Olá! O tour de colheita tem vaga para 2 pessoas neste sábado?', now() - interval '3 hours'),
   ($1, $3, 'Olá, Ana! Temos sim — a saída é às 9h, com degustação no final. Posso reservar?', now() - interval '2 hours'),
   ($1, $2, 'Pode reservar, por favor! Chegamos na sexta à noite.', now() - interval '1 hour')`,
  [conv.id, touristUser.id, producerUser.id]
);

// Contas demo já nascem com o e-mail confirmado
await client.query('UPDATE users SET email_verified_at = now()');

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
