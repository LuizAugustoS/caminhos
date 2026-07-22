// Páginas públicas compartilháveis (server-rendered, com OG tags):
//   /p/:id  → anúncio aprovado    /e/:id → estabelecimento de parceiro
// Dão a produtores um link de WhatsApp/Instagram e ao Google algo indexável.
import { Router } from 'express';
import { query } from '../db.js';

export const publicPages = Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPrice = (cents, unit) => cents == null
  ? (unit || 'sob consulta')
  : `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: cents % 100 ? 2 : 0 })}${unit ? ` · ${unit}` : ''}`;

function page({ req, path, title, description, image, bodyHTML }) {
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}${path}`;
  const ogImage = image ? `${base}${image}` : `${base}/icons/icon-512.png`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Caminhos do Caparaó</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Caminhos do Caparaó">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="backdrop">
  <div class="legal-page public-page">
    <a href="/" class="legal-back">← Caminhos do Caparaó</a>
    ${bodyHTML}
    <p class="public-cta"><a class="btn-primary" href="/app">Abrir no app para conversar e reservar</a></p>
  </div>
</div>
</body>
</html>`;
}

publicPages.get('/p/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const { rows: [l] } = await query(
    `SELECT l.id, l.type, l.title, l.subtitle, l.image_path, l.price_cents, l.price_unit,
            l.event_date, l.event_time, l.event_place,
            p.name AS producer_name, p.verified, e.name AS est_name, coalesce(e.city, p.city) AS city,
            e.address, e.phone, e.open_hours
     FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     LEFT JOIN establishments e ON e.producer_id = p.id
     WHERE l.id = $1 AND l.status = 'approved' AND l.available`,
    [req.params.id]
  );
  if (!l) return res.status(404).send('Anúncio não encontrado');
  const TYPE = { product: 'Produto', service: 'Serviço', event: 'Evento' };
  const desc = [l.subtitle, fmtPrice(l.price_cents, l.price_unit), l.est_name || l.producer_name, l.city]
    .filter(Boolean).join(' · ');
  res.send(page({
    req, path: `/p/${l.id}`, title: l.title, description: desc, image: l.image_path,
    bodyHTML: `
      ${l.image_path ? `<div class="public-hero"><img src="${esc(l.image_path)}" alt=""></div>` : ''}
      <p class="legal-updated">${TYPE[l.type] || ''} · ${esc(l.city || 'Caparaó')}</p>
      <h1>${esc(l.title)}</h1>
      ${l.subtitle ? `<p>${esc(l.subtitle)}</p>` : ''}
      <p><strong>${esc(fmtPrice(l.price_cents, l.price_unit))}</strong></p>
      ${l.type === 'event' && l.event_date ? `<p>Quando: ${new Date(l.event_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}${l.event_time ? ` · ${esc(l.event_time)}` : ''}${l.event_place ? ` · ${esc(l.event_place)}` : ''}</p>` : ''}
      <h2>${esc(l.est_name || l.producer_name)}${l.verified ? ' <span class="public-verified">✓ Verificado</span>' : ''}</h2>
      <p>${[l.address, l.open_hours ? `Aberto: ${l.open_hours}` : null, l.phone ? `Contato: ${l.phone}` : null].filter(Boolean).map(esc).join('<br>')}</p>`,
  }));
});

// robots.txt aponta o sitemap (páginas públicas são indexáveis; a API não)
publicPages.get('/robots.txt', (req, res) => {
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(
    `User-agent: *\nAllow: /$\nAllow: /p/\nAllow: /e/\nDisallow: /api/\nDisallow: /admin\nDisallow: /portal\nDisallow: /app\n\nSitemap: ${base}/sitemap.xml\n`
  );
});

// sitemap.xml com os anúncios e estabelecimentos ativos (cache curto)
publicPages.get('/sitemap.xml', async (req, res) => {
  const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const { rows: listings } = await query(
    `SELECT l.id, l.created_at FROM listings l
     JOIN producers p ON p.id = l.producer_id AND p.status = 'approved'
     WHERE l.status = 'approved' AND l.available AND (l.stock IS NULL OR l.stock > 0)
       AND l.image_label <> 'Foto do anúncio'
     ORDER BY l.id LIMIT 5000`
  );
  const { rows: estabs } = await query(
    `SELECT e.id, e.updated_at FROM establishments e
     JOIN producers p ON p.id = e.producer_id AND p.status = 'approved'
     ORDER BY e.id LIMIT 5000`
  );
  const url = (loc, lastmod) =>
    `  <url><loc>${base}${loc}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    url('/') + '\n' +
    listings.map(l => url(`/p/${l.id}`, l.created_at)).join('\n') + (listings.length ? '\n' : '') +
    estabs.map(e => url(`/e/${e.id}`, e.updated_at)).join('\n') + (estabs.length ? '\n' : '') +
    `</urlset>\n`;
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(body);
});

publicPages.get('/e/:id', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const { rows: [e] } = await query(
    `SELECT e.id, e.name, e.description, e.category, e.city, e.address, e.phone,
            e.open_hours, e.photo_path, e.lat, e.lng, p.verified
     FROM establishments e
     JOIN producers p ON p.id = e.producer_id AND p.status = 'approved'
     WHERE e.id = $1`,
    [req.params.id]
  );
  if (!e) return res.status(404).send('Estabelecimento não encontrado');
  res.send(page({
    req, path: `/e/${e.id}`, title: e.name,
    description: [e.category, e.description, e.city].filter(Boolean).join(' · ').slice(0, 200),
    image: e.photo_path,
    bodyHTML: `
      ${e.photo_path ? `<div class="public-hero"><img src="${esc(e.photo_path)}" alt=""></div>` : ''}
      <p class="legal-updated">${esc(e.category || 'Estabelecimento')} · ${esc(e.city || 'Caparaó')}</p>
      <h1>${esc(e.name)}${e.verified ? ' <span class="public-verified">✓ Verificado</span>' : ''}</h1>
      ${e.description ? `<p>${esc(e.description)}</p>` : ''}
      <p>${[e.address, e.open_hours ? `Aberto: ${e.open_hours}` : null, e.phone ? `Contato: ${e.phone}` : null].filter(Boolean).map(esc).join('<br>')}</p>
      ${e.lat != null && e.lng != null
        ? `<p><a href="https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}" rel="noopener">Como chegar ➚</a></p>` : ''}`,
  }));
});
