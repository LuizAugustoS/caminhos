// Motor de geração de roteiros a partir das preferências do turista.
// Provedores (AI_PROVIDER): 'anthropic' (Claude API), 'n8n' (webhook) ou
// 'local' (regras sobre o catálogo — padrão e fallback quando um provedor falha).
import Anthropic from '@anthropic-ai/sdk';
import { query } from './db.js';

const PROVIDER = process.env.AI_PROVIDER || 'local';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

export const INTERESTS = [
  'cafe', 'trilhas', 'cachoeiras', 'gastronomia', 'artesanato',
  'eventos', 'hospedagem', 'astronomia', 'cavalgada', 'natureza',
];

const DURATION_ITEMS = { 'meio dia': 3, '1 dia': 4, 'fim de semana': 6, '3+ dias': 8 };
const PACE_DELTA = { tranquilo: -1, moderado: 0, intenso: 1 };

// ─── Catálogo (somente conteúdo aprovado e curado) ──────────────────────────
export async function loadCatalog() {
  const { rows } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle,
            p.name AS producer, coalesce(e.city, p.city) AS city
     FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE l.status = 'approved' AND l.image_label <> 'Foto do anúncio'
     ORDER BY l.listed_at DESC
     LIMIT 60`
  );
  return rows;
}

// ─── Provedor: local (regras) ────────────────────────────────────────────────
const KEYWORDS = {
  cafe: ['café', 'torra', 'colheita', 'arábica'],
  trilhas: ['trilha', 'trekking', 'travessia', 'pico', 'guia', 'nascer do sol'],
  cachoeiras: ['cachoeira', 'balneário', 'vale'],
  gastronomia: ['queijo', 'mel', 'doce', 'degustação', 'rapadura', 'gastro'],
  artesanato: ['artesanato', 'cesto', 'fibra', 'feira'],
  eventos: ['festival', 'feira', 'noite', 'evento'],
  hospedagem: ['pousada', 'hospedagem', 'diária'],
  astronomia: ['estrela', 'observação', 'céu', 'astron'],
  cavalgada: ['cavalgada', 'cavalo', 'rancho'],
  natureza: ['vale', 'serra', 'montanha', 'pico', 'mirante'],
};

function localGenerator(preferences, catalog) {
  const interests = preferences.interests?.length ? preferences.interests : ['natureza'];
  const wish = (preferences.text || '').toLowerCase();

  const scored = catalog.map(item => {
    const haystack = `${item.title} ${item.subtitle || ''}`.toLowerCase();
    let score = 0;
    for (const interest of interests) {
      for (const kw of KEYWORDS[interest] || [interest]) {
        if (haystack.includes(kw)) score += 3;
      }
    }
    for (const word of wish.split(/\W+/).filter(w => w.length > 3)) {
      if (haystack.includes(word)) score += 2;
    }
    if (item.type === 'service') score += 1;      // experiências ancoram o roteiro
    if (item.type === 'event') score += 0.5;
    return { item, score };
  }).sort((a, b) => b.score - a.score);

  const count = Math.max(2, (DURATION_ITEMS[preferences.duration] ?? 4) + (PACE_DELTA[preferences.pace] ?? 0));
  const picked = [];
  const perProducer = new Map();
  for (const { item, score } of scored) {
    if (picked.length >= count) break;
    if (score <= 0 && picked.length >= 2) break;
    const seen = perProducer.get(item.producer) || 0;
    if (seen >= 2) continue;                       // variedade de parceiros
    perProducer.set(item.producer, seen + 1);
    picked.push(item);
  }
  // Experiências primeiro, produtos para levar por último
  picked.sort((a, b) => (a.type === 'product') - (b.type === 'product'));

  const labels = interests.map(i => ({
    cafe: 'café', trilhas: 'trilhas', cachoeiras: 'cachoeiras', gastronomia: 'gastronomia',
    artesanato: 'artesanato', eventos: 'eventos', hospedagem: 'hospedagem',
    astronomia: 'céu estrelado', cavalgada: 'cavalgada', natureza: 'natureza',
  }[i] || i));
  return {
    title: `Roteiro ${preferences.duration || 'no Caparaó'} — ${labels.slice(0, 2).join(' & ')}`,
    notes: `Montado a partir dos seus gostos (${labels.join(', ')})${preferences.text ? ` e do seu pedido: “${preferences.text}”` : ''}.`,
    items: picked.map(item => ({
      listing_id: item.id,
      note: item.type === 'product' ? 'Para levar de lembrança' : null,
    })),
  };
}

// ─── Provedor: Claude API ────────────────────────────────────────────────────
const ITINERARY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Título curto e convidativo do roteiro, em português' },
    notes: { type: 'string', description: 'Resumo de 1–2 frases do roteiro, em português' },
    items: {
      type: 'array',
      description: 'Paradas em ordem cronológica',
      items: {
        type: 'object',
        properties: {
          listing_id: {
            type: ['integer', 'null'],
            description: 'id de um anúncio do catálogo, ou null para parada livre',
          },
          label: {
            type: ['string', 'null'],
            description: 'Nome da parada livre (obrigatório quando listing_id é null)',
          },
          note: { type: ['string', 'null'], description: 'Dica prática curta para esta parada' },
        },
        required: ['listing_id', 'label', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'notes', 'items'],
  additionalProperties: false,
};

async function anthropicGenerator(preferences, catalog) {
  const client = new Anthropic();
  const catalogText = catalog
    .map(c => `${c.id} | ${c.type} | ${c.title} — ${c.subtitle || ''} | ${c.producer} | ${c.city || ''}`)
    .join('\n');

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: ITINERARY_SCHEMA } },
    system:
      'Você é um guia local especialista na região do Caparaó (ES/MG), montando roteiros de turismo rural. ' +
      'Monte um roteiro realista e encadeado usando prioritariamente itens do catálogo (referencie pelo listing_id). ' +
      'Adicione paradas livres (listing_id null + label) apenas para completar a logística, como almoço ou mirantes. ' +
      'Experiências e eventos primeiro; produtos para comprar ficam ao final. Responda em português.',
    messages: [{
      role: 'user',
      content:
        `Preferências do turista:\n` +
        `- Gostos: ${(preferences.interests || []).join(', ') || 'não informou'}\n` +
        `- Duração: ${preferences.duration || 'não informou'}\n` +
        `- Ritmo: ${preferences.pace || 'não informou'}\n` +
        `- O que quer viver: ${preferences.text || 'não informou'}\n\n` +
        `Catálogo disponível (id | tipo | título — descrição | parceiro | cidade):\n${catalogText}`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Geração recusada pelo provedor');
  const textBlock = response.content.find(b => b.type === 'text');
  return JSON.parse(textBlock.text);
}

// ─── Provedor: N8N ───────────────────────────────────────────────────────────
async function n8nGenerator(preferences, catalog) {
  if (!N8N_WEBHOOK_URL) throw new Error('N8N_WEBHOOK_URL não configurada');
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferences, catalog }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Webhook N8N respondeu ${res.status}`);
  const data = await res.json();
  // Aceita tanto o objeto direto quanto o formato de array do N8N ([{json: {...}}])
  return Array.isArray(data) ? (data[0]?.json ?? data[0]) : data;
}

// ─── Orquestração ────────────────────────────────────────────────────────────
const GENERATORS = { anthropic: anthropicGenerator, n8n: n8nGenerator, local: localGenerator };

function sanitize(raw, catalog, preferences) {
  const validIds = new Set(catalog.map(c => c.id));
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .map(it => ({
      listing_id: validIds.has(Number(it.listing_id)) ? Number(it.listing_id) : null,
      label: it.label ? String(it.label).slice(0, 120) : null,
      note: it.note ? String(it.note).slice(0, 200) : null,
    }))
    .filter(it => it.listing_id || it.label)
    .slice(0, 12);
  if (!items.length) throw new Error('Roteiro gerado sem paradas válidas');
  return {
    title: String(raw.title || `Roteiro no Caparaó`).slice(0, 120),
    notes: raw.notes ? String(raw.notes).slice(0, 500) : null,
    items,
    provider: preferences._provider,
  };
}

export async function generateItinerary(preferences) {
  const catalog = await loadCatalog();
  const generate = GENERATORS[PROVIDER] || localGenerator;
  try {
    const raw = await generate(preferences, catalog);
    return sanitize(raw, catalog, { ...preferences, _provider: PROVIDER });
  } catch (err) {
    if (PROVIDER === 'local') throw err;
    console.warn(`Provedor '${PROVIDER}' falhou (${err.message}) — usando gerador local`);
    const raw = localGenerator(preferences, catalog);
    return sanitize(raw, catalog, { ...preferences, _provider: 'local-fallback' });
  }
}
