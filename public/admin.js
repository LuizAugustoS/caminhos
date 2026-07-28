/* Caminhos do Caparaó — Admin PWA */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

// ─── Utilidades ──────────────────────────────────────────────────────────────
const fmtInt = n => new Intl.NumberFormat('pt-BR').format(n);
const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
const fmtTime = iso => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `há ${mins} min`;
  if (mins < 60 * 24) return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return 'ontem';
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Capa do anúncio: foto enviada pelo produtor ou gradiente do design
// Ícones de linha (SVG inline, herdam currentColor) — substituem os glifos
const ICON_PATHS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  tourists: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  producers: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 3 0"/><path d="M9 20v-5h6v5"/>',
  registrations: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>',
  listings: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.3"/>',
  events: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
  analytics: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1.5" y1="14" x2="6.5" y2="14"/><line x1="9.5" y1="8" x2="14.5" y2="8"/><line x1="17.5" y1="16" x2="22.5" y2="16"/>',
  volume: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
};
const icon = (name, size = 20) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

const monogramOf = l => (l.producer_name || l.est_name || l.title || '?')
  .split(/\s+/).filter(w => /\p{L}/u.test(w)).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '·';
const coverTone = l => { const s = l.producer_name || l.est_name || l.title || '';
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 4; return `cover-t${h + 1}`; };
// Miniatura (400px) pela convenção <nome>_t.<ext>; cai para a grande se faltar.
const thumbURL = path => (path || '').replace(/(\.[^.]+)$/, '_t$1');
document.addEventListener('error', e => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset.full && img.getAttribute('src') !== img.dataset.full) {
    img.src = img.dataset.full;
  }
}, true);
const adminThumb = (l, style = '') => l.image_path
  ? `<div class="thumb has-photo" style="${style}"><img src="${esc(thumbURL(l.image_path))}" data-full="${esc(l.image_path)}" alt="" loading="lazy"></div>`
  : `<div class="thumb cover-mono ${coverTone(l)}" style="${style}"><span class="cover-initials">${esc(monogramOf(l))}</span></div>`;

// ─── Galeria: carrossel + tela cheia (bundle do admin é separado do shared) ──
function openLightbox(images, startIndex = 0) {
  const list = (Array.isArray(images) ? images : [images]).filter(Boolean);
  if (!list.length) return;
  let i = Math.max(0, Math.min(startIndex, list.length - 1));
  const multi = list.length > 1;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Foto em tela cheia');
  box.innerHTML = `
    <button type="button" class="lb-close" aria-label="Fechar">${icon('close', 22)}</button>
    ${multi ? `<button type="button" class="lb-nav lb-prev" aria-label="Anterior">${icon('chevron-left', 30)}</button>` : ''}
    <img class="lb-img" src="${esc(list[i])}" alt="">
    ${multi ? `<button type="button" class="lb-nav lb-next" aria-label="Próxima">${icon('chevron-right', 30)}</button>` : ''}
    ${multi ? `<div class="lb-dots">${list.map((_, k) => `<span class="lb-dot ${k === i ? 'on' : ''}" data-k="${k}"></span>`).join('')}</div>` : ''}`;
  document.body.appendChild(box);
  document.body.classList.add('no-scroll');
  const lastFocused = document.activeElement;
  const img = box.querySelector('.lb-img');
  const show = n => {
    i = (n + list.length) % list.length;
    img.src = list[i];
    box.querySelectorAll('.lb-dot').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const close = () => {
    box.remove();
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  };
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (multi && e.key === 'ArrowLeft') show(i - 1);
    else if (multi && e.key === 'ArrowRight') show(i + 1);
  };
  document.addEventListener('keydown', onKey);
  box.querySelector('.lb-close').addEventListener('click', close);
  box.querySelector('.lb-prev')?.addEventListener('click', () => show(i - 1));
  box.querySelector('.lb-next')?.addEventListener('click', () => show(i + 1));
  box.querySelectorAll('.lb-dot').forEach(d => d.addEventListener('click', () => show(Number(d.dataset.k))));
  box.addEventListener('click', e => { if (e.target === box) close(); });
  box.querySelector('.lb-close').focus();
}

function carouselHTML(images, cls = 'detail-hero') {
  const list = (images || []).filter(Boolean);
  if (!list.length) return '';
  const nav = list.length > 1 ? `
    <button type="button" class="carousel-nav carousel-prev" aria-label="Foto anterior">${icon('chevron-left', 24)}</button>
    <button type="button" class="carousel-nav carousel-next" aria-label="Próxima foto">${icon('chevron-right', 24)}</button>
    <div class="carousel-dots">${list.map((_, k) => `<span class="carousel-dot ${k === 0 ? 'on' : ''}" data-k="${k}"></span>`).join('')}</div>` : '';
  return `<div class="${cls} carousel${list.length === 1 ? ' is-single' : ''}" data-carousel>
    <img class="carousel-img" src="${esc(list[0])}" alt="" data-lb>
    <button type="button" class="carousel-zoom" aria-label="Ver em tela cheia" data-lb>${icon('expand', 16)}</button>
    ${nav}
  </div>`;
}

// Foto do estabelecimento (img.zoomable) abre em tela cheia
document.addEventListener('click', e => {
  const z = e.target.closest('img.zoomable');
  if (z && z.getAttribute('src')) openLightbox([z.getAttribute('src')]);
});

function wireCarousel(root, images) {
  const el = root.querySelector('[data-carousel]');
  if (!el) return;
  const list = (images || []).filter(Boolean);
  let i = 0;
  const img = el.querySelector('.carousel-img');
  const show = n => {
    i = (n + list.length) % list.length;
    img.src = list[i];
    el.querySelectorAll('.carousel-dot').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  el.querySelector('.carousel-prev')?.addEventListener('click', () => show(i - 1));
  el.querySelector('.carousel-next')?.addEventListener('click', () => show(i + 1));
  el.querySelectorAll('.carousel-dot').forEach(d => d.addEventListener('click', () => show(Number(d.dataset.k))));
  el.querySelectorAll('[data-lb]').forEach(t => t.addEventListener('click', () => openLightbox(list, i)));
}

const STATUS_LABEL = { pending: 'Pendente', in_review: 'Em análise', approved: 'Aprovado', rejected: 'Recusado' };

// Planos de produtor (cobrança fora da plataforma; admin atribui/troca)
const PLAN_LABEL = { gratuito: 'Gratuito', profissional: 'Profissional', premium: 'Premium' };
const planBadge = plan => plan && plan !== 'gratuito'
  ? `<span class="plan-badge plan-${esc(plan)}">${plan === 'premium' ? '★ ' : ''}${PLAN_LABEL[plan] || ''}</span>`
  : '';
const verifiedBadge = verified => verified
  ? `<span class="verified-badge" title="Parceiro verificado">${icon('check', 12)}Verificado</span>`
  : '';

// Avaliação média → "★★★★☆ 4.3 (12)"; sem avaliações → vazio
function starsHTML(avg, count) {
  if (!count) return '';
  const full = Math.round(Number(avg));
  return `<span class="stars" title="${Number(avg).toFixed(1)} de 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>
    <span class="stars-meta">${Number(avg).toFixed(1)} (${count})</span>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json();
}

// ─── Telas ───────────────────────────────────────────────────────────────────
function showLogin() {
  location.href = '/'; // login centralizado na landing
}

let currentAdmin = null;

function renderAdminAvatar(admin) {
  $('#profile-name').textContent = admin.name;
  const el = $('#profile-initials');
  if (admin.avatar_path) el.innerHTML = `<img class="avatar-photo" src="${esc(admin.avatar_path)}" alt="">`;
  else el.textContent = admin.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function showApp(admin) {
  currentAdmin = admin;
  $('#app-screen').classList.remove('hidden');
  renderAdminAvatar(admin);
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#page-date').textContent = today[0].toUpperCase() + today.slice(1) + ' · Região do Caparaó, ES/MG';
  loadAll();
}

// ─── Sidebar e navegação entre telas ─────────────────────────────────────────
let currentView = 'overview';
let navBadges = { pending: 0, chat: 0 };

const VIEW_LOADERS = {
  overview: () => loadAll(),
  tourists: () => loadTouristsView(),
  producers: () => loadProducersView(),
  registrations: () => loadRegistrationsView(),
  reports: () => loadReportsView(),
  listings: () => loadPubsView(),
  events: () => loadEventsView(),
  chat: () => loadInternalChat(),
  analytics: () => loadAnalyticsView(),
  settings: () => loadSettingsView(),
};

function switchView(name) {
  if (!VIEW_LOADERS[name]) return;
  currentView = name;
  document.querySelectorAll('.admin-view').forEach(v =>
    v.classList.toggle('hidden', v.id !== `view-${name}`));
  document.querySelectorAll('#sidenav .nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  // Se a tela ativa é um filho de submenu, garante o grupo pai expandido.
  const activeChild = document.querySelector('#sidenav .nav-child.active');
  if (activeChild) {
    const group = activeChild.closest('.nav-group');
    group.classList.add('open');
    group.querySelector('[data-parent]')?.setAttribute('aria-expanded', 'true');
  }
  window.scrollTo(0, 0);
  VIEW_LOADERS[name]();
}

const CARET = '<svg class="nav-caret" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

function renderNav(pendingCount, chatCount, reportsCount) {
  if (pendingCount != null) navBadges.pending = pendingCount;
  if (chatCount != null) navBadges.chat = chatCount;
  if (reportsCount != null) navBadges.reports = reportsCount;
  // Itens simples têm `view`; o item pai tem `children` (submenu expansível).
  const items = [
    { view: 'overview', label: 'Visão Geral', icon: 'overview' },
    { view: 'tourists', label: 'Turistas', icon: 'tourists' },
    { label: 'Produtores/Comerciantes', icon: 'producers', children: [
      { view: 'producers', label: 'Cadastros Atuais' },
      { view: 'registrations', label: 'Cadastros Pendentes', badge: navBadges.pending || null },
      { view: 'reports', label: 'Denúncias', badge: navBadges.reports || null },
    ] },
    { view: 'listings', label: 'Publicações', icon: 'listings' },
    { view: 'events', label: 'Eventos', icon: 'events' },
    { view: 'chat', label: 'Chat Interno', icon: 'chat', badge: navBadges.chat || null },
    { view: 'analytics', label: 'Analytics', icon: 'analytics' },
    { view: 'settings', label: 'Configurações', icon: 'settings' },
  ];
  const simpleItem = it => `
    <button class="nav-item${it.view === currentView ? ' active' : ''}" data-view="${it.view}">
      <span class="icon">${icon(it.icon)}</span>
      <span class="nav-label">${it.label}</span>
      ${it.badge ? `<span class="nav-badge">${it.badge}</span>` : ''}
    </button>`;
  const groupItem = it => {
    // O submenu já abre expandido quando a tela atual é um dos filhos.
    const open = it.children.some(c => c.view === currentView);
    // Quando recolhido, um pontinho sinaliza que há pendências nos filhos
    // (a contagem detalhada aparece nos badges de cada filho ao expandir).
    const hasWork = it.children.some(c => c.badge);
    return `
    <div class="nav-group${open ? ' open' : ''}">
      <button class="nav-item nav-parent" data-parent aria-expanded="${open}">
        <span class="icon">${icon(it.icon)}</span>
        <span class="nav-label">${it.label}</span>
        ${hasWork ? '<span class="nav-work-dot" title="Há itens aguardando"></span>' : ''}
        ${CARET}
      </button>
      <div class="nav-sub">
        ${it.children.map(c => `
          <button class="nav-item nav-child${c.view === currentView ? ' active' : ''}" data-view="${c.view}">
            <span class="nav-label">${c.label}</span>
            ${c.badge ? `<span class="nav-badge">${c.badge}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>`;
  };
  $('#sidenav').innerHTML = items.map(it => it.children ? groupItem(it) : simpleItem(it)).join('') + `
    <div class="pwa-card">
      <div class="pwa-card-head"><div class="dot"></div><span>PWA sincronizado</span></div>
      <p id="pwa-sync-note">Itinerários offline atualizados.</p>
    </div>`;
}

$('#sidenav').addEventListener('click', e => {
  // Clique no item pai: só expande/recolhe o submenu (não troca de tela).
  const parent = e.target.closest('[data-parent]');
  if (parent) {
    const group = parent.closest('.nav-group');
    const open = group.classList.toggle('open');
    parent.setAttribute('aria-expanded', String(open));
    return;
  }
  const btn = e.target.closest('.nav-item[data-view]');
  if (btn) switchView(btn.dataset.view);
});

// Menu hamburguer (celular): abre/fecha a sidebar
(function initNavToggle() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('sidenav');
  if (!toggle || !nav) return;
  const close = () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', e => { if (e.target.closest('.nav-item')) close(); });
  document.addEventListener('click', e => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) close();
  });
})();
document.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.preventDefault(); switchView(goto.dataset.goto); }
});

// ─── Visão de operação ────────────────────────────────────────────────────────
// Fila de trabalho: só o que espera decisão da equipe. Cada tile leva à fila.
function renderWorklist(queue) {
  const items = [
    { n: queue.pendingProducers, label: 'produtores aguardando aprovação', goto: 'producers', icon: 'producers' },
    { n: queue.openReports, label: 'denúncias abertas para revisar', goto: 'reports', icon: 'flag', warn: true },
    { n: queue.pendingListings, label: 'anúncios pendentes de publicação', goto: 'publications', icon: 'listings' },
  ];
  const clear = items.every(i => i.n === 0);
  $('#worklist').innerHTML = clear
    ? `<div class="worklist-clear">${icon('check', 18)} Nada na fila — tudo em dia por aqui.</div>`
    : items.map(i => `
      <a class="work-tile${i.n > 0 ? ' has-work' : ''}${i.warn && i.n > 0 ? ' warn' : ''}" href="#" data-goto="${i.goto}">
        <span class="work-icon">${icon(i.icon, 18)}</span>
        <span class="work-n">${fmtInt(i.n)}</span>
        <span class="work-label">${i.label}</span>
      </a>`).join('');
}

// Lista ranqueada de destinos buscados (reusada no overview e no analytics).
function rankRowsHTML(top) {
  if (!top.length) return '<p class="empty-note">Sem buscas registradas nos últimos 7 dias.</p>';
  const max = top[0].searches || 1;
  return top.map((s, i) => `
    <div class="rank-row">
      <span class="rank-pos">${i + 1}</span>
      <div class="rank-body">
        <span class="rank-name">${esc(s.spot)}</span>
        <div class="rank-bar"><i style="width:${Math.round((s.searches / max) * 100)}%"></i></div>
      </div>
      <span class="rank-n">${fmtInt(s.searches)}</span>
    </div>`).join('');
}

// O que a região buscou — lista simples, sem mapa de calor.
function renderSearched(top) {
  $('#searched-list').innerHTML = rankRowsHTML(top);
}

// Números reais da plataforma — em uma linha calma, sem cards de vaidade.
function renderPlatformFacts(t, offlineItineraries) {
  const facts = [
    [fmtInt(t.tourists), 'turistas cadastrados'],
    [fmtInt(t.activeProducers), `produtores ativos · ${t.withListingsPct}% com anúncios`],
    [fmtInt(t.listings), 'anúncios publicados'],
    [fmtInt(offlineItineraries), 'roteiros prontos para uso offline'],
  ];
  $('#platform-facts').innerHTML = facts.map(([n, label]) =>
    `<div class="fact"><strong>${n}</strong><span>${label}</span></div>`).join('');
}

// ─── Produtores ──────────────────────────────────────────────────────────────
async function loadProducers() {
  const { producers, pendingCount } = await api('/producers?limit=5');
  $('#producers-sub').textContent = `Aplicações recentes · ${pendingCount} aguardando revisão`;
  $('#producer-list').innerHTML = producers.map(p => {
    const pending = p.status === 'pending' || p.status === 'in_review';
    return `
    <div class="producer-row" data-id="${p.id}">
      <div class="avatar lg" style="background:${esc(p.avatar_color)}">${esc(p.initials)}</div>
      <div class="producer-info">
        <div class="name">${esc(p.name)} ${verifiedBadge(p.verified)}${planBadge(p.plan)}</div>
        <div class="kind">${esc(p.kind)}</div>
      </div>
      <span class="status-pill status-${p.status}">${STATUS_LABEL[p.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve" aria-label="Aprovar" title="Aprovar" data-action="approve">✓</button>
             <button class="btn-reject" aria-label="Recusar" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" aria-label="Ver perfil" title="Ver perfil">→</button>`}
      </div>
    </div>`;
  }).join('');
  return pendingCount;
}

// Nota de sincronização offline no card do PWA (canto do menu).
function updatePwaNote(lastSync) {
  if (!lastSync) return;
  const mins = Math.max(1, Math.round((Date.now() - new Date(lastSync).getTime()) / 60000));
  const note = $('#pwa-sync-note');
  if (note) note.textContent = `Itinerários offline atualizados há ${mins} min.`;
}

// ─── Listas de conteúdo ──────────────────────────────────────────────────────
let currentTab = 'product';

async function loadListings() {
  const { listings } = await api(`/listings?type=${currentTab}&limit=4`);
  $('#listing-rows').innerHTML = listings.map(l => {
    const pending = l.status === 'pending' || l.status === 'in_review';
    return `
    <div class="table-row" data-id="${l.id}">
      ${adminThumb(l)}
      <div class="cell-title">
        <div class="t">${esc(l.title)}</div>
        <div class="s">${esc(l.subtitle || '')}</div>
      </div>
      <div class="cell-creator">
        <div class="avatar sm" style="background:${esc(l.producer_color)}">${esc(l.producer_initials)}</div>
        <span>${esc(l.producer_name)}</span>
      </div>
      <span class="cell-date">${fmtDate(l.listed_at)}</span>
      <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve wide" data-action="approve">Aprovar</button>
             <button class="btn-reject" aria-label="Recusar" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" aria-label="Ver anúncio" title="Ver anúncio">→</button>`}
      </div>
    </div>`;
  }).join('');
}

// ─── Chat & alertas ──────────────────────────────────────────────────────────
const SEVERITY_COLOR = { success: '#1C6B4A', warning: '#C0714F', info: '#8AA98F' };

function setBellCount(unread) {
  const el = $('#bell-count');
  el.classList.toggle('hidden', !unread);
  el.textContent = unread > 99 ? '99+' : unread || '';
}

async function loadChatAndAlerts() {
  const [{ messages }, { alerts, unread }] = await Promise.all([api('/chat'), api('/alerts')]);
  setBellCount(unread);
  $('#chat-list').innerHTML = messages.map(m => `
    <div class="chat-msg">
      <div class="avatar md" style="background:${esc(m.avatar_color)}">${esc(m.sender_initials)}</div>
      <div class="chat-body">
        <div class="chat-meta"><strong>${esc(m.sender_name)}</strong><small>${fmtTime(m.created_at)}</small></div>
        <span class="chat-text">${esc(m.body)}</span>
      </div>
    </div>`).join('');
  $('#alert-list').innerHTML = alerts.map(a => {
    const color = SEVERITY_COLOR[a.severity] || SEVERITY_COLOR.info;
    return `
    <div class="alert-row ${a.read_at ? 'read' : ''}" style="border-left-color:${color}">
      <div class="dot" style="background:${color}"></div>
      <div>
        <strong>${esc(a.title)}</strong>
        <small>${esc(a.meta)}</small>
      </div>
    </div>`;
  }).join('');
  return messages.length;
}

// ─── Carga geral ─────────────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [dash, pendingCount, chatCount] = await Promise.all([
      api('/dashboard'),
      loadProducers(),
      loadChatAndAlerts(),
    ]);
    renderWorklist(dash.queue);
    renderSearched(dash.topSearched);
    renderPlatformFacts(dash.totals, dash.offlineItineraries);
    renderNav(pendingCount, chatCount, dash.queue.openReports);
    updatePwaNote(dash.lastSync); // atualiza a nota do PWA depois que a nav existe
    await loadListings();
  } catch (err) {
    if (err.message !== 'unauthorized') {
      console.error(err);
      toast(navigator.onLine ? 'Erro ao carregar dados' : 'Sem conexão — dados podem estar desatualizados');
    }
  }
}

// ─── Ações de moderação ──────────────────────────────────────────────────────
async function review(kind, id, action) {
  const status = action === 'approve' ? 'approved' : 'rejected';
  try {
    await api(`/${kind}/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    toast(status === 'approved' ? 'Cadastro aprovado ✓' : 'Cadastro recusado');
    if (currentView === 'overview') {
      if (kind === 'producers') {
        const pendingCount = await loadProducers();
        renderNav(pendingCount, null);
      } else {
        await loadListings();
      }
    } else {
      // Atualiza a contagem de pendências do menu e recarrega a tela atual
      api('/producers?limit=1').then(({ pendingCount }) => renderNav(pendingCount, null)).catch(() => {});
      VIEW_LOADERS[currentView]();
    }
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message);
  }
}

$('#producer-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  review('producers', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

$('#listing-rows').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  review('listings', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

$('#listing-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab || tab.dataset.type === currentTab) return;
  currentTab = tab.dataset.type;
  document.querySelectorAll('#listing-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadListings();
});

// ═══ Telas da sidebar ══════════════════════════════════════════════════════

const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ─── Turistas ────────────────────────────────────────────────────────────────
async function loadTouristsView() {
  const q = $('#tourists-q').value.trim();
  const { tourists, total } = await api(`/tourists?q=${encodeURIComponent(q)}&limit=30`);
  $('#tourists-sub').textContent = `${fmtInt(total)} turistas cadastrados · exibindo ${tourists.length}`;
  $('#tourists-rows').innerHTML = tourists.map(t => `
    <div class="table-row tourists-cols" data-id="${t.id}">
      <div class="cell-title"><div class="t">${esc(t.name)}</div></div>
      <span class="cell-date">${esc(t.email || '—')}</span>
      <span class="cell-date">${esc(t.city || '—')}</span>
      <span class="cell-date">${fmtDate(t.created_at)}</span>
      <span class="status-pill ${t.has_account ? 'status-approved' : 'status-in_review'}">${t.has_account ? 'Conta no app' : 'Registro'}</span>
    </div>`).join('') || '<p class="empty-note">Nenhum turista encontrado.</p>';
}
$('#tourists-q').addEventListener('input', debounce(loadTouristsView));

// ─── Produtores/Comerciantes ─────────────────────────────────────────────────
let producersFilter = '';

function producerRowHTML(p) {
  const pending = p.status === 'pending' || p.status === 'in_review';
  return `
    <div class="producer-row" data-id="${p.id}">
      <div class="avatar lg" style="background:${esc(p.avatar_color)}">${esc(p.initials)}</div>
      <div class="producer-info">
        <div class="name">${esc(p.name)} ${verifiedBadge(p.verified)}${planBadge(p.plan)}</div>
        <div class="kind">${esc(p.kind)}${p.city ? ' · ' + esc(p.city) : ''}</div>
      </div>
      <span class="status-pill status-${p.status}">${STATUS_LABEL[p.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve" aria-label="Aprovar" title="Aprovar" data-action="approve">✓</button>
             <button class="btn-reject" aria-label="Recusar" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" aria-label="Ver perfil" title="Ver perfil">→</button>`}
      </div>
    </div>`;
}

let producersPlanFilter = '';

async function loadProducersView() {
  const q = $('#producers-q').value.trim();
  const statusParam = producersFilter ? `&status=${producersFilter}` : '';
  const planParam = producersPlanFilter ? `&plan=${producersPlanFilter}` : '';
  const { producers } = await api(`/producers?limit=100&q=${encodeURIComponent(q)}${statusParam}${planParam}`);
  $('#producers-all').innerHTML = producers.map(producerRowHTML).join('')
    || '<p class="empty-note">Nenhum produtor com esse filtro.</p>';
}

$('#producers-plan-filter').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  producersPlanFilter = tab.dataset.plan;
  document.querySelectorAll('#producers-plan-filter .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadProducersView();
});
$('#producers-q').addEventListener('input', debounce(loadProducersView));
$('#producers-filter').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  producersFilter = tab.dataset.status;
  document.querySelectorAll('#producers-filter .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadProducersView();
});
$('#producers-all').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) review('producers', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

// ─── Cadastros (fila de moderação) ───────────────────────────────────────────
function listingQueueRowHTML(l) {
  return `
    <div class="producer-row" data-id="${l.id}">
      ${adminThumb(l, 'width:40px;height:40px;font-size:15px;')}
      <div class="producer-info">
        <div class="name">${esc(l.title)}</div>
        <div class="kind">${TYPE_LABEL_ADMIN[l.type]} · ${esc(l.producer_name)}</div>
      </div>
      <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
      <div class="row-actions">
        <button class="btn-approve" aria-label="Aprovar" title="Aprovar" data-action="approve">✓</button>
        <button class="btn-reject" aria-label="Recusar" title="Recusar" data-action="reject">✕</button>
      </div>
    </div>`;
}
const TYPE_LABEL_ADMIN = { product: 'Produto', service: 'Serviço', event: 'Evento' };

const REPORT_REASON_LABEL = {
  spam: 'Spam ou golpe', inapropriado: 'Conteúdo inapropriado',
  enganoso: 'Informação enganosa', fora_regiao: 'Não é do Caparaó', outro: 'Outro motivo',
};
const REPORT_TARGET_LABEL = { listing: 'Anúncio', producer: 'Produtor', tourist: 'Turista' };
function reportRowHTML(r) {
  const reasons = (r.reasons || []).map(x => REPORT_REASON_LABEL[x] || x).join(' · ');
  const detail = (r.details || [])[0];
  const sub = [REPORT_TARGET_LABEL[r.target_type] || r.target_type, r.target_sub, reasons]
    .filter(Boolean).map(esc).join(' · ');
  return `
    <div class="report-row" data-target-type="${esc(r.target_type)}" data-target-id="${r.target_id}">
      <div class="report-info">
        <div class="name"><span class="report-tag report-tag-${esc(r.target_type)}">${esc(REPORT_TARGET_LABEL[r.target_type] || '?')}</span>
          ${esc(r.target_name || '—')} <span class="report-count">${r.reports} denúncia${r.reports > 1 ? 's' : ''}</span></div>
        <div class="kind">${sub}${detail ? ` — “${esc(detail)}”` : ''}</div>
      </div>
      <div class="row-actions">
        ${r.target_type === 'listing'
          ? '<button class="btn-view" data-report-open aria-label="Ver anúncio" title="Ver anúncio">→</button>' : ''}
        <button class="btn-approve" data-report-resolve title="Marcar como resolvida">${icon('check', 15)}</button>
      </div>
    </div>`;
}

// Cadastros Pendentes: só produtores e anúncios aguardando revisão.
async function loadRegistrationsView() {
  const [{ producers }, { listings }] = await Promise.all([
    api('/producers?limit=100'),
    api('/listings?limit=100'),
  ]);
  const pendProducers = producers.filter(p => p.status === 'pending' || p.status === 'in_review');
  const pendListings = listings.filter(l => l.status === 'pending' || l.status === 'in_review');
  $('#reg-producers').innerHTML = pendProducers.map(producerRowHTML).join('')
    || '<p class="empty-note">Nenhum produtor aguardando revisão.</p>';
  $('#reg-listings').innerHTML = pendListings.map(listingQueueRowHTML).join('')
    || '<p class="empty-note">Nenhum anúncio aguardando revisão.</p>';
}

// Denúncias: seção dedicada de moderação (apontada pelo submenu).
async function loadReportsView() {
  const { reports } = await api('/admin/reports');
  renderNav(null, null, reports.length);
  $('#reports-list').innerHTML = reports.map(reportRowHTML).join('')
    || '<p class="empty-note">Nenhuma denúncia aberta no momento — tudo em ordem.</p>';
}

$('#reports-list').addEventListener('click', async e => {
  const row = e.target.closest('.report-row');
  if (!row) return;
  const { targetType, targetId } = row.dataset;
  if (e.target.closest('[data-report-open]') && targetType === 'listing') {
    return openListingDetailAdmin(Number(targetId));
  }
  if (e.target.closest('[data-report-resolve]')) {
    try {
      await api(`/admin/reports/${targetType}/${targetId}/reviewed`, { method: 'POST' });
      toast('Denúncia resolvida');
      loadReportsView();
    } catch (err) { toast(err.message); }
  }
});
$('#reg-producers').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) review('producers', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});
$('#reg-listings').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) review('listings', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

// ─── Publicações e Eventos ───────────────────────────────────────────────────
let pubsType = '', pubsStatus = '';

function listingTableRowHTML(l) {
  const pending = l.status === 'pending' || l.status === 'in_review';
  return `
    <div class="table-row" data-id="${l.id}">
      ${adminThumb(l)}
      <div class="cell-title">
        <div class="t">${esc(l.title)}</div>
        <div class="s">${esc(l.subtitle || '')}</div>
      </div>
      <div class="cell-creator">
        <div class="avatar sm" style="background:${esc(l.producer_color)}">${esc(l.producer_initials)}</div>
        <span>${esc(l.producer_name)}</span>
      </div>
      <span class="cell-date">${fmtDate(l.listed_at)}</span>
      <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve wide" data-action="approve">Aprovar</button>
             <button class="btn-reject" aria-label="Recusar" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" aria-label="Ver anúncio" title="Ver anúncio">→</button>`}
      </div>
    </div>`;
}

async function loadPubsView() {
  const q = $('#pubs-q').value.trim();
  const params = new URLSearchParams({ limit: 50, q });
  if (pubsType) params.set('type', pubsType);
  if (pubsStatus) params.set('status', pubsStatus);
  const { listings } = await api(`/listings?${params}`);
  $('#pubs-rows').innerHTML = listings.map(listingTableRowHTML).join('')
    || '<p class="empty-note">Nenhuma publicação com esse filtro.</p>';
}
$('#pubs-q').addEventListener('input', debounce(loadPubsView));
$('#pubs-type').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  pubsType = tab.dataset.type;
  document.querySelectorAll('#pubs-type .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadPubsView();
});
$('#pubs-status').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  pubsStatus = tab.dataset.status;
  document.querySelectorAll('#pubs-status .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadPubsView();
});
$('#pubs-rows').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) review('listings', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

async function loadEventsView() {
  const { listings } = await api('/listings?type=event&limit=50');
  $('#events-rows').innerHTML = listings.map(listingTableRowHTML).join('')
    || '<p class="empty-note">Nenhum evento cadastrado.</p>';
}
$('#events-rows').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (btn) review('listings', btn.closest('[data-id]').dataset.id, btn.dataset.action);
});

// ─── Chat Interno: moderação de conversas turista ↔ produtor (master-detail) ──
// Estado: lista de conversas em memória + a conversa aberta no momento. Só o
// histórico da conversa selecionada é renderizado no painel de detalhe.
let adminConvs = [];
let adminOpenConv = null;

async function loadInternalChat() {
  try {
    const { conversations } = await api('/admin/conversations');
    adminConvs = conversations;
    $('#admin-conv-list').innerHTML = conversations.map(c => `
      <button type="button" class="conv-row${c.id === adminOpenConv ? ' active' : ''}" data-conv="${c.id}">
        <div class="avatar md" style="background:${esc(c.producer_color || '#4A3226')}">${esc(c.producer_initials || '')}</div>
        <div class="conv-info">
          <strong>${esc(c.tourist_name)} ↔ ${esc(c.producer_name)}</strong>
          <small>${esc((c.last_message || 'Sem mensagens').slice(0, 52))}</small>
        </div>
        <span class="conv-count">${fmtInt(c.total)}</span>
      </button>`).join('')
      || '<p class="empty-note">Nenhuma conversa ativa entre turistas e produtores.</p>';
    // Ao (re)carregar a lista, o detalhe volta ao estado vazio no mobile.
    if (adminOpenConv == null) $('#admin-chat').classList.remove('thread-open');
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message);
  }
}

// Abre UMA conversa: busca o histórico e renderiza só as mensagens dela,
// escondendo (não renderizando) as demais. No mobile, oculta a lista.
async function openAdminConversation(id) {
  adminOpenConv = id;
  document.querySelectorAll('#admin-conv-list .conv-row').forEach(r =>
    r.classList.toggle('active', Number(r.dataset.conv) === id));
  const conv = adminConvs.find(c => c.id === id);
  $('#admin-thread-head').innerHTML = conv
    ? `<strong>${esc(conv.tourist_name)}</strong> <span class="thread-sep">com</span> <strong>${esc(conv.producer_name)}</strong>`
    : '';
  $('#admin-thread-msgs').innerHTML = '<p class="empty-note">Carregando…</p>';
  try {
    const { messages } = await api(`/admin/conversations/${id}/messages`);
    // from_tourist decide o lado da bolha (turista à esquerda, produtor à direita)
    $('#admin-thread-msgs').innerHTML = messages.map(m => `
      <div class="msg ${m.from_tourist ? '' : 'mine'}">
        <span class="msg-body"><strong>${esc(m.sender_name)}:</strong> ${esc(m.body)}</span>
        <small class="msg-meta">${fmtTime(m.created_at)}</small>
      </div>`).join('') || '<p class="empty-note">Sem mensagens nesta conversa.</p>';
    const box = $('#admin-thread-msgs');
    box.scrollTop = box.scrollHeight;
    $('#admin-chat').classList.add('thread-open'); // mobile: mostra só o detalhe
  } catch (err) {
    $('#admin-thread-msgs').innerHTML = `<p class="empty-note">${esc(err.message)}</p>`;
  }
}

$('#admin-conv-list').addEventListener('click', e => {
  const row = e.target.closest('[data-conv]');
  if (row) openAdminConversation(Number(row.dataset.conv));
});
// Botão "voltar" (mobile): fecha o detalhe e volta à lista de conversas
document.querySelector('[data-thread-back]')?.addEventListener('click', () => {
  adminOpenConv = null;
  $('#admin-chat').classList.remove('thread-open');
  document.querySelectorAll('#admin-conv-list .conv-row').forEach(r => r.classList.remove('active'));
});

// ─── Analytics ───────────────────────────────────────────────────────────────
async function loadAnalyticsView() {
  const dash = await api('/dashboard');
  const t = dash.totals, top = dash.topSearched;
  const weekSearches = top.reduce((s, x) => s + x.searches, 0);

  const cards = [
    ['Buscas (7 dias)', fmtInt(weekSearches), 'nos destinos monitorados'],
    ['Turistas cadastrados', fmtInt(t.tourists), 'no total da plataforma'],
    ['Produtores ativos', fmtInt(t.activeProducers), `${t.withListingsPct}% com anúncios`],
  ];
  $('#analytics-kpis').innerHTML = cards.map(([label, value, caption]) => `
    <div class="stat-card">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
      <span class="stat-caption">${caption}</span>
    </div>`).join('');

  $('#analytics-spots').innerHTML = rankRowsHTML(top);

  $('#analytics-summary').innerHTML = `
    <div class="fact-col">
      <div class="fact"><strong>${fmtInt(t.activeProducers)}</strong><span>produtores ativos · ${t.withListingsPct}% com anúncios</span></div>
      <div class="fact"><strong>${fmtInt(t.listings)}</strong><span>anúncios publicados</span></div>
      <div class="fact"><strong>${fmtInt(dash.offlineItineraries)}</strong><span>roteiros prontos para uso offline</span></div>
      <div class="fact"><strong>${esc(top[0]?.spot || '—')}</strong><span>destino em destaque da semana</span></div>
    </div>`;
}

// ─── Configurações ───────────────────────────────────────────────────────────
async function loadSettingsView() {
  const [me, health] = await Promise.all([api('/me'), fetch('/api/health').then(r => r.json())]);
  $('#settings-account').innerHTML = `
    <div class="settings-list">
      <div class="settings-item"><span>Nome</span><strong>${esc(me.name)}</strong></div>
      <div class="settings-item"><span>Papel</span><strong>Administrador(a)</strong></div>
      <div class="settings-item"><span>Sessão</span><strong>expira em até 12h</strong></div>
    </div>
    <button class="btn-secondary" id="settings-logout" style="margin-top:14px;">Sair da conta</button>`;
  $('#settings-logout').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });
  $('#settings-platform').innerHTML = `
    <div class="settings-list">
      <div class="settings-item"><span>Banco de dados</span>
        <span class="status-pill ${health.db === 'up' ? 'status-approved' : 'status-rejected'}">${health.db === 'up' ? 'Conectado' : 'Fora do ar'}</span></div>
      <div class="settings-item"><span>Aplicação</span><strong>Caminhos do Caparaó v1.0</strong></div>
      <div class="settings-item"><span>Gerador de roteiros (IA)</span><strong>configurável via AI_PROVIDER no .env</strong></div>
      <div class="settings-item"><span>Contas demo</span><strong>redefinir com npm run db:seed</strong></div>
    </div>`;

  // Equipe (múltiplos admins) e auditoria das ações
  const [{ admins }, { entries }] = await Promise.all([api('/admins'), api('/audit')]);
  $('#settings-admins').innerHTML = `
    <div class="settings-list">
      ${admins.map(a => `
        <div class="settings-item"><span>${esc(a.name)}</span>
          <strong>${esc(a.email)}${a.id === me.id ? ' (você)' : ''}</strong></div>`).join('')}
    </div>`;
  const AUDIT_LABEL = {
    'producer.approved': 'aprovou o produtor', 'producer.rejected': 'recusou o produtor',
    'listing.approved': 'aprovou o anúncio', 'listing.rejected': 'recusou o anúncio',
    'plan.changed': 'alterou o plano de', 'review.hidden': 'ocultou a', 'review.shown': 'reexibiu a',
    'admin.created': 'criou o admin', 'export.csv': 'exportou',
    'producer.verified': 'verificou o produtor', 'producer.unverified': 'removeu o selo de',
    'report.reviewed': 'resolveu a denúncia de',
  };
  $('#settings-audit').innerHTML = entries.length ? `
    <div class="settings-list">
      ${entries.map(en => `
        <div class="settings-item">
          <span>${esc(en.admin_name)} ${AUDIT_LABEL[en.action] || en.action} <strong>${esc(en.target)}</strong></span>
          <small>${fmtDate(en.created_at)}</small>
        </div>`).join('')}
    </div>` : '<p class="empty-note">Nenhuma ação registrada ainda.</p>';
}

$('#btn-new-admin').addEventListener('click', async () => {
  const values = await adminForm({
    title: 'Novo administrador',
    confirmText: 'Criar admin',
    fields: [
      { name: 'name', label: 'Nome' },
      { name: 'email', label: 'E-mail', type: 'email' },
      { name: 'password', label: 'Senha (mínimo 8 caracteres)', type: 'password', minlength: 8 },
    ],
  });
  if (!values) return;
  try {
    await api('/admins', { method: 'POST', body: JSON.stringify(values) });
    toast(`Admin ${values.name} criado`);
    loadSettingsView();
  } catch (err) { toast(err.message); }
});

// ─── Minha conta: editar perfil, foto, senha, sair ───────────────────────────
function adminForm({ title, fields, confirmText }) {
  return new Promise(resolve => {
    const { overlay, close } = openAdminModal(`
      <h3>${esc(title)}</h3>
      <form class="modal-form">
        ${fields.map(f => `
          <div class="field">
            <label>${esc(f.label)}</label>
            <input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}"
                   placeholder="${esc(f.placeholder || '')}" ${f.required !== false ? 'required' : ''}
                   ${f.minlength ? `minlength="${f.minlength}"` : ''}>
          </div>`).join('')}
        <div class="row-actions modal-actions">
          <button type="submit" class="btn-primary">${esc(confirmText)}</button>
          <button type="button" class="btn-secondary" data-modal-cancel>Cancelar</button>
        </div>
      </form>`);
    const form = overlay.querySelector('form');
    form.querySelector('input')?.focus();
    let done = false;
    overlay.addEventListener('click', e => {
      if (!done && (e.target === overlay || e.target.closest('[data-modal-cancel]'))) resolve(null);
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const v = form.elements[f.name].value;
        values[f.name] = f.type === 'password' ? v : v.trim();
      }
      done = true;
      close();
      resolve(values);
    });
  });
}

$('#profile').addEventListener('click', () => {
  const { overlay, close } = openAdminModal(`
    <h3>Minha conta</h3>
    <div class="modal-options">
      <button class="modal-option" data-act="edit"><strong>Editar perfil</strong><small>nome e cidade</small></button>
      <button class="modal-option" data-act="photo"><strong>Trocar minha foto</strong><small>JPG, PNG ou WebP até 5 MB</small></button>
      <button class="modal-option" data-act="password"><strong>Alterar senha</strong></button>
      <button class="modal-option" data-act="logout"><strong>Sair da conta</strong></button>
    </div>
    <div class="row-actions modal-actions">
      <button class="btn-secondary" data-modal-cancel style="flex:1">Fechar</button>
    </div>`);
  overlay.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
    close();
    const act = btn.dataset.act;
    if (act === 'edit') {
      const values = await adminForm({
        title: 'Editar perfil',
        confirmText: 'Salvar',
        fields: [
          { name: 'name', label: 'Nome', value: currentAdmin.name },
          { name: 'city', label: 'Cidade', value: currentAdmin.city || '', required: false },
        ],
      });
      if (!values) return;
      try {
        currentAdmin = await api('/me', { method: 'PUT', body: JSON.stringify(values) });
        renderAdminAvatar(currentAdmin);
        toast('Perfil atualizado');
      } catch (err) { toast(err.message); }
    } else if (act === 'photo') {
      const input = Object.assign(document.createElement('input'), {
        type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
      });
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files[0];
        input.remove();
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) return toast('Imagem muito grande — máximo 5 MB');
        const form = new FormData();
        form.append('image', file);
        try {
          const res = await fetch('/api/me/avatar', { method: 'POST', body: form, credentials: 'same-origin' });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
          currentAdmin.avatar_path = (await res.json()).avatar_path;
          renderAdminAvatar(currentAdmin);
          toast('Foto de perfil atualizada');
        } catch (err) { toast(err.message); }
      });
      input.click();
    } else if (act === 'password') {
      const values = await adminForm({
        title: 'Alterar senha',
        confirmText: 'Alterar',
        fields: [
          { name: 'current_password', label: 'Senha atual', type: 'password' },
          { name: 'new_password', label: 'Nova senha (mínimo 8 caracteres)', type: 'password', minlength: 8 },
        ],
      });
      if (!values) return;
      try {
        await api('/me/password', { method: 'PUT', body: JSON.stringify(values) });
        toast('Senha alterada');
      } catch (err) { toast(err.message); }
    } else if (act === 'logout') {
      await api('/logout', { method: 'POST' }).catch(() => {});
      showLogin();
    }
  }));
});

// Exportar relatório: baixa um resumo JSON do dashboard
$('#btn-export').addEventListener('click', async () => {
  try {
    const dash = await api('/dashboard');
    const blob = new Blob([JSON.stringify(dash, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-caparao-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Relatório exportado');
  } catch { toast('Não foi possível exportar'); }
});

// Atalho ⌘K / Ctrl+K para busca
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#global-search').focus();
  }
});

// ═══ Detalhes (produtor, anúncio, turista) ══════════════════════════════════

function openAdminModal(innerHTML) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-modal-cancel]')) close();
  });
  return { overlay, close };
}

const infoLine = (label, value) => value
  ? `<div class="settings-item"><span>${label}</span><strong>${esc(value)}</strong></div>` : '';

// Aprovar/recusar de dentro do detalhe e recarregar a tela atual
function detailActions(kind, id, status) {
  if (status !== 'pending' && status !== 'in_review') return '';
  return `
    <div class="row-actions modal-actions">
      <button class="btn-approve wide" data-review="approve" style="flex:1">✓ Aprovar</button>
      <button class="btn-danger" data-review="reject" style="flex:1">✕ Recusar</button>
    </div>`;
}

function bindDetailReview(overlay, close, kind, id) {
  overlay.querySelectorAll('[data-review]').forEach(btn =>
    btn.addEventListener('click', async () => {
      await review(kind, id, btn.dataset.review);
      close();
      VIEW_LOADERS[currentView]();
    }));
}

// ─── Detalhe do produtor ─────────────────────────────────────────────────────
async function openProducerDetail(id) {
  try {
    const { producer: p, listings, conversations, rating } = await api(`/producers/${id}`);
    const { overlay, close } = openAdminModal(`
      <div class="detail-head">
        <div class="avatar lg" style="background:${esc(p.avatar_color)}">${p.avatar_path
          ? `<img src="${esc(p.avatar_path)}" alt="">` : esc(p.initials)}</div>
        <div>
          <h3>${esc(p.name)} ${verifiedBadge(p.verified)}${planBadge(p.plan)}</h3>
          <span class="sub">${esc(p.kind)}</span>
        </div>
        <span class="status-pill status-${p.status}" style="margin-left:auto">${STATUS_LABEL[p.status]}</span>
      </div>

      <h4 class="detail-section">Plano de parceiro</h4>
      <div class="plan-switch">
        ${Object.entries(PLAN_LABEL).map(([key, label]) => `
          <button class="btn-secondary plan-switch-btn ${key === p.plan ? 'on' : ''}" data-plan="${key}">
            ${key === 'premium' ? '★ ' : ''}${label}</button>`).join('')}
      </div>
      <p class="empty-note" style="margin:4px 0 0">A cobrança do plano é combinada com o parceiro fora da plataforma.</p>

      <h4 class="detail-section">Selo de confiança</h4>
      <div class="plan-switch">
        <button class="btn-secondary verified-toggle ${p.verified ? 'on' : ''}" data-verified="${p.verified ? '0' : '1'}">
          ${p.verified ? 'Remover selo "Verificado"' : 'Marcar como Verificado'}</button>
      </div>
      <p class="empty-note" style="margin:4px 0 0">O selo indica um parceiro conferido pela equipe — visível para os turistas, independente do plano.</p>

      <h4 class="detail-section">Estabelecimento</h4>
      ${p.photo_path ? `<div class="detail-hero" style="margin-bottom:12px"><img class="zoomable" src="${esc(p.photo_path)}" alt="Foto do estabelecimento"></div>` : ''}
      <div class="settings-list">
        ${infoLine('Descrição', p.est_description)}
        ${infoLine('Categoria', p.est_category)}
        ${infoLine('Endereço', p.address ? `${p.address}${p.city ? ' — ' + p.city : ''}` : p.city)}
        ${infoLine('Telefone', p.phone)}
        ${infoLine('Visitação', p.open_hours)}
        ${p.lat != null && p.lng != null ? `<div class="settings-item"><span>Localização</span>
          <strong><a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}"
            target="_blank" rel="noopener">${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)} ➚</a></strong></div>` : ''}
      </div>

      <h4 class="detail-section">Conta e histórico</h4>
      <div class="settings-list">
        ${infoLine('E-mail da conta', p.account_email || 'sem conta no app (cadastro da equipe)')}
        ${infoLine('Responsável', p.account_name)}
        ${infoLine('Cadastro', fmtDate(p.created_at))}
        ${p.reviewed_at ? infoLine('Última revisão', fmtDate(p.reviewed_at)) : ''}
        ${infoLine('Conversas com turistas', String(conversations))}
        ${rating.count ? `<div class="settings-item"><span>Avaliação média</span>
          <strong>${starsHTML(rating.avg, rating.count)}</strong></div>` : ''}
      </div>

      <h4 class="detail-section">Anúncios (${listings.length})</h4>
      <div class="detail-mini-list">
        ${listings.map(l => `
          <div class="settings-item detail-mini" data-listing="${l.id}">
            <span>${esc(l.title)}</span>
            <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
          </div>`).join('') || '<p class="empty-note">Nenhum anúncio ainda.</p>'}
      </div>

      ${detailActions('producers', p.id, p.status)}
      <div class="row-actions modal-actions">
        <button class="btn-secondary" data-modal-cancel style="flex:1">Fechar</button>
      </div>`);
    bindDetailReview(overlay, close, 'producers', p.id);
    overlay.querySelectorAll('[data-plan]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (btn.dataset.plan === p.plan) return;
        try {
          await api(`/producers/${p.id}/plan`, { method: 'POST', body: JSON.stringify({ plan: btn.dataset.plan }) });
          toast(`Plano de ${p.name} alterado para ${PLAN_LABEL[btn.dataset.plan]}`);
          close();
          VIEW_LOADERS[currentView]();
        } catch (err) { toast(err.message); }
      }));
    overlay.querySelector('[data-verified]')?.addEventListener('click', async () => {
      const verified = overlay.querySelector('[data-verified]').dataset.verified === '1';
      try {
        await api(`/producers/${p.id}/verified`, { method: 'POST', body: JSON.stringify({ verified }) });
        toast(verified ? `${p.name} marcado como Verificado` : `Selo removido de ${p.name}`);
        close();
        VIEW_LOADERS[currentView]();
      } catch (err) { toast(err.message); }
    });
    overlay.querySelectorAll('[data-listing]').forEach(row =>
      row.addEventListener('click', () => { close(); openListingDetailAdmin(Number(row.dataset.listing)); }));
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message);
  }
}

// ─── Detalhe do anúncio ──────────────────────────────────────────────────────
async function openListingDetailAdmin(id) {
  try {
    const l = await api(`/listings/${id}`);
    const gallery = l.images?.length ? l.images : (l.image_path ? [l.image_path] : []);
    const hero = gallery.length
      ? carouselHTML(gallery, 'detail-hero')
      : `<div class="detail-hero cover-mono ${coverTone(l)}"><span class="cover-initials">${esc(monogramOf(l))}</span></div>`;
    const { overlay, close } = openAdminModal(`
      <div class="detail-modal-inner">
        ${hero}
        <div class="detail-body">
          <span class="ex-type">${TYPE_LABEL_ADMIN[l.type]} · ${esc(l.city || 'Caparaó')}</span>
          <h3>${esc(l.title)}</h3>
          ${l.subtitle ? `<p class="detail-sub">${esc(l.subtitle)}</p>` : ''}
          <div class="settings-list">
            ${infoLine('Status', STATUS_LABEL[l.status])}
            ${infoLine('Preço', l.price_cents
              ? `R$ ${(l.price_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: l.price_cents % 100 ? 2 : 0 })}${l.price_unit ? ' · ' + l.price_unit : ''}`
              : (l.price_unit || 'sob consulta'))}
            ${l.type === 'event' ? infoLine('Data do evento', l.event_date
              ? `${fmtDate(l.event_date)}${l.event_time ? ' · ' + l.event_time : ''}` : 'não informada') : ''}
            ${l.type === 'event' && l.event_place ? infoLine('Local', l.event_place) : ''}
            ${l.stock != null ? infoLine('Estoque', `${l.stock} unidade${l.stock === 1 ? '' : 's'}${l.stock === 0 ? ' (esgotado)' : ''}`) : ''}
            ${!l.available ? infoLine('Disponibilidade', 'pausado pelo produtor') : ''}
            ${infoLine('Publicado em', fmtDate(l.listed_at))}
            ${l.reviewed_at ? infoLine('Última revisão', fmtDate(l.reviewed_at)) : ''}
            ${l.image_path ? '' : infoLine('Foto', 'sem foto enviada — capa ilustrativa')}
          </div>
          <h4 class="detail-section">Parceiro</h4>
          <div class="detail-partner" data-producer="${l.producer_id}" style="cursor:pointer" title="Ver perfil completo">
            <div class="avatar lg" style="background:${esc(l.producer_color)}">${esc(l.producer_initials)}</div>
            <div class="detail-partner-info">
              <strong>${esc(l.est_name || l.producer_name)} ${planBadge(l.plan)}</strong>
              <small>${esc(l.producer_kind || '')} · cadastro ${STATUS_LABEL[l.producer_status]}</small>
              ${l.address ? `<small>${esc(l.address)}${l.city ? ' — ' + esc(l.city) : ''}</small>` : ''}
              ${l.phone ? `<small>Contato: ${esc(l.phone)}</small>` : ''}
            </div>
          </div>
          ${l.reviews?.length ? `
            <h4 class="detail-section">Avaliações (${l.reviews.length})</h4>
            <div class="review-list">
              ${l.reviews.map(r => `
                <div class="review-row ${r.hidden ? 'review-hidden' : ''}" data-review="${r.id}" data-hidden="${r.hidden}">
                  <div class="review-head">
                    <strong>${esc(r.tourist_name)}</strong>
                    <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                    <small>${fmtDate(r.created_at)}${r.hidden ? ' · oculta' : ''}</small>
                    <button class="btn-view review-toggle" title="${r.hidden ? 'Voltar a exibir' : 'Ocultar da plataforma'}">
                      ${r.hidden ? 'Exibir' : 'Ocultar'}</button>
                  </div>
                  ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                  ${r.reply ? `<div class="review-reply"><strong>Resposta do parceiro</strong><p>${esc(r.reply)}</p></div>` : ''}
                </div>`).join('')}
            </div>` : ''}
          ${detailActions('listings', l.id, l.status)}
          <div class="row-actions modal-actions">
            <button class="btn-secondary" data-modal-cancel style="flex:1">Fechar</button>
          </div>
        </div>
      </div>`);
    overlay.querySelector('.modal').classList.add('detail-modal');
    overlay.querySelectorAll('.review-toggle').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation();
      const row = btn.closest('[data-review]');
      const hide = row.dataset.hidden !== 'true';
      try {
        await api(`/admin/reviews/${row.dataset.review}/visibility`, {
          method: 'POST', body: JSON.stringify({ hidden: hide }),
        });
        toast(hide ? 'Avaliação oculta da plataforma' : 'Avaliação visível novamente');
        close();
        openListingDetailAdmin(id);
      } catch (err) { toast(err.message); }
    }));
    wireCarousel(overlay, gallery);
    bindDetailReview(overlay, close, 'listings', l.id);
    overlay.querySelector('[data-producer]').addEventListener('click', () => {
      close();
      openProducerDetail(l.producer_id);
    });
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message);
  }
}

// ─── Detalhe do turista ──────────────────────────────────────────────────────
async function openTouristDetail(id) {
  try {
    const t = await api(`/tourists/${id}`);
    const { overlay } = openAdminModal(`
      <div class="detail-head">
        <div class="avatar lg" style="background:#4A3226">${t.avatar_path
          ? `<img src="${esc(t.avatar_path)}" alt="">`
          : esc(t.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</div>
        <div>
          <h3>${esc(t.name)}</h3>
          <span class="sub">${esc(t.city || 'cidade não informada')}</span>
        </div>
        <span class="status-pill ${t.user_id ? 'status-approved' : 'status-in_review'}" style="margin-left:auto">
          ${t.user_id ? 'Conta no app' : 'Registro'}</span>
      </div>
      <div class="settings-list">
        ${infoLine('E-mail', t.account_email || t.email)}
        ${infoLine('Cadastro', fmtDate(t.created_at))}
        ${t.account_since ? infoLine('Conta criada em', fmtDate(t.account_since)) : ''}
      </div>
      ${t.user_id ? `
        <h4 class="detail-section">Atividade na plataforma</h4>
        <div class="heat-stats" style="margin-bottom:14px">
          <div class="heat-stat"><strong>${fmtInt(t.trips)}</strong><small>roteiros (${t.ai_trips} por IA)</small></div>
          <div class="heat-stat"><strong>${fmtInt(t.favorites)}</strong><small>favoritos</small></div>
          <div class="heat-stat"><strong>${fmtInt(t.conversations)}</strong><small>conversas</small></div>
        </div>` : '<p class="empty-note">Registro sem conta no app — sem atividade rastreável.</p>'}
      <div class="row-actions modal-actions">
        <button class="btn-secondary" data-modal-cancel style="flex:1">Fechar</button>
      </div>`);
  } catch (err) {
    if (err.message !== 'unauthorized') toast(err.message);
  }
}

// Clique no corpo de qualquer linha abre o detalhe correspondente
document.addEventListener('click', e => {
  if (e.target.closest('button, a, input, .modal-overlay')) return;
  const prow = e.target.closest('#producer-list .producer-row, #producers-all .producer-row, #reg-producers .producer-row');
  if (prow?.dataset.id) return openProducerDetail(Number(prow.dataset.id));
  const lrow = e.target.closest('#listing-rows .table-row, #pubs-rows .table-row, #events-rows .table-row, #reg-listings .producer-row');
  if (lrow?.dataset.id) return openListingDetailAdmin(Number(lrow.dataset.id));
  const trow = e.target.closest('#tourists-rows .table-row');
  if (trow?.dataset.id) return openTouristDetail(Number(trow.dataset.id));
});

// O botão "→" (ver perfil/anúncio) também abre o detalhe
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-view[title="Ver perfil"], .btn-view[title="Ver anúncio"]');
  if (!btn) return;
  const row = btn.closest('[data-id]');
  if (!row) return;
  if (btn.title === 'Ver perfil') openProducerDetail(Number(row.dataset.id));
  else openListingDetailAdmin(Number(row.dataset.id));
});

// Busca global do topo: Enter pesquisa nas Publicações
$('#global-search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  $('#pubs-q').value = e.target.value.trim();
  switchView('listings'); // o loader da tela já lê o termo preenchido acima
});

// Sino de notificações: ler (uma ou todas) e excluir
const alertRowHTML = a => {
  const color = SEVERITY_COLOR[a.severity] || SEVERITY_COLOR.info;
  return `
    <div class="alert-row ${a.read_at ? 'read' : ''}" data-alert="${a.id}" style="border-left-color:${color}; margin-bottom:8px">
      <div class="dot" style="background:${color}"></div>
      <div style="min-width:0">
        <strong>${esc(a.title)}</strong>
        <small>${esc(a.meta)} · ${fmtDate(a.created_at)}</small>
      </div>
      <div class="alert-actions">
        ${a.read_at ? '' : '<button data-alert-read title="Marcar como lida">Lida</button>'}
        <button class="alert-del" data-alert-del aria-label="Excluir" title="Excluir">✕</button>
      </div>
    </div>`;
};

$('.bell').addEventListener('click', async () => {
  const { overlay, close } = openAdminModal('<h3>Notificações</h3><div id="alert-modal-list"></div>');

  async function render() {
    let alerts = [], unread = 0;
    try { ({ alerts, unread } = await api('/alerts?limit=20')); }
    catch (err) { if (!err.unauthorized) toast(err.message); }
    setBellCount(unread);
    $('#alert-modal-list', overlay).innerHTML = `
      ${alerts.map(alertRowHTML).join('') || '<p class="empty-note">Nenhuma notificação por enquanto.</p>'}
      <div class="row-actions modal-actions">
        ${unread ? '<button class="btn-secondary" data-alert-read-all style="flex:1">Marcar todas como lidas</button>' : ''}
        <button class="btn-secondary" data-modal-cancel style="flex:1">Fechar</button>
      </div>`;
  }

  overlay.addEventListener('click', async e => {
    const row = e.target.closest('[data-alert]');
    if (e.target.closest('[data-alert-read]') && row) {
      await api(`/alerts/${row.dataset.alert}/read`, { method: 'POST' }).catch(err => toast(err.message));
      render();
    } else if (e.target.closest('[data-alert-del]') && row) {
      await api(`/alerts/${row.dataset.alert}`, { method: 'DELETE' }).catch(err => toast(err.message));
      render();
    } else if (e.target.closest('[data-alert-read-all]')) {
      await api('/alerts/read-all', { method: 'POST' }).catch(err => toast(err.message));
      render();
    }
  });
  render();
});

// ─── Estado online/offline ───────────────────────────────────────────────────
function updateOnlineState() {
  document.body.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', () => { updateOnlineState(); loadAll(); });
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// ─── Service worker (PWA) ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW não registrado:', err));
}

// ─── Boot: sessão existente? ─────────────────────────────────────────────────
const HOME_BY_ROLE = { admin: '/admin', tourist: '/app', producer: '/portal' };
api('/me')
  .then(me => {
    if (me.role !== 'admin') { location.href = HOME_BY_ROLE[me.role] || '/'; return; }
    showApp(me);
  })
  .catch(() => showLogin());
