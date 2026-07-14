/* Caminhos do Caparaó — Admin PWA */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

// ─── Utilidades ──────────────────────────────────────────────────────────────
const fmtInt = n => new Intl.NumberFormat('pt-BR').format(n);
const fmtPct = n => n == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Math.abs(n)) + '%';
const fmtMoney = cents => {
  const reais = cents / 100;
  if (reais >= 1000) {
    return 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(reais / 1000) + ' mil';
  }
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reais);
};
const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
const fmtTime = iso => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `há ${mins} min`;
  if (mins < 60 * 24) return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return 'ontem';
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS_LABEL = { pending: 'Pendente', in_review: 'Em análise', approved: 'Aprovado', rejected: 'Recusado' };

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

function showApp(admin) {
  currentAdmin = admin;
  $('#app-screen').classList.remove('hidden');
  $('#profile-name').textContent = admin.name;
  $('#profile-initials').textContent = admin.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
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
  VIEW_LOADERS[name]();
}

function renderNav(pendingCount, chatCount) {
  if (pendingCount != null) navBadges.pending = pendingCount;
  if (chatCount != null) navBadges.chat = chatCount;
  const items = [
    ['◫', 'Visão Geral', 'overview', null],
    ['⛰', 'Turistas', 'tourists', null],
    ['☕', 'Produtores/Comerciantes', 'producers', null],
    ['✎', 'Cadastros', 'registrations', navBadges.pending || null],
    ['▤', 'Publicações', 'listings', null],
    ['✦', 'Eventos', 'events', null],
    ['◍', 'Chat Interno', 'chat', navBadges.chat || null],
    ['◔', 'Analytics', 'analytics', null],
    ['⚙', 'Configurações', 'settings', null],
  ];
  $('#sidenav').innerHTML = items.map(([icon, label, view, badge]) => `
    <button class="nav-item${view === currentView ? ' active' : ''}" data-view="${view}">
      <span class="icon">${icon}</span>
      <span>${label}</span>
      ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
    </button>`).join('') + `
    <div class="pwa-card">
      <div class="pwa-card-head"><div class="dot"></div><span>PWA sincronizado</span></div>
      <p id="pwa-sync-note">Itinerários offline atualizados.</p>
    </div>`;
}

$('#sidenav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-item');
  if (btn) switchView(btn.dataset.view);
});
document.addEventListener('click', e => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.preventDefault(); switchView(goto.dataset.goto); }
});

// ─── KPIs ────────────────────────────────────────────────────────────────────
function sparklineSVG(series, color, id) {
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${38 - (v / max) * 34}`).join(' ');
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
    <defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="0,40 ${pts} 100,40" fill="url(#g${id})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function barsHTML(series, color) {
  const max = Math.max(...series, 1);
  return `<div class="kpi-bars">${series.map((v, i) =>
    `<i style="height:${Math.max(8, (v / max) * 100)}%;background:${i === series.length - 1 ? color : color + '55'}"></i>`).join('')}</div>`;
}

function donutHTML(pct, color, rest, label) {
  return `<div class="kpi-donut-wrap">
    <div class="kpi-donut" style="background:conic-gradient(${color} 0 ${pct}%, ${rest} ${pct}% 100%)"><i>${pct}%</i></div>
    <div class="kpi-donut-label">${label}</div>
  </div>`;
}

function deltaBadge(deltaPct) {
  if (deltaPct == null) return '';
  const down = deltaPct < 0;
  return `<span class="kpi-delta${down ? ' down' : ''}">${down ? '▼' : '▲'} ${fmtPct(deltaPct)}</span>`;
}

function renderKpis(k) {
  const producerBars = [38, 52, 44, 60, 55, 72, 66, 84]; // tendência ilustrativa
  const cards = [
    {
      label: 'Novos Turistas', accent: '#1C6B4A', icon: '⛰', iconBg: '#E4F0E7',
      value: fmtInt(k.newTourists.value), delta: k.newTourists.deltaPct,
      caption: 'últimos 30 dias', hint: 'Turistas cadastrados no período',
      chart: sparklineSVG(k.newTourists.series, '#1C6B4A', 1),
    },
    {
      label: 'Produtores Ativos', accent: '#8AA98F', icon: '☕', iconBg: '#EDF2EA',
      value: fmtInt(k.activeProducers.value), delta: k.activeProducers.deltaPct,
      caption: `${k.activeProducers.withListingsPct}% com anúncios ativos`, hint: 'Produtores e comerciantes verificados',
      chart: barsHTML(producerBars, '#8AA98F'),
    },
    {
      label: 'Total de Anúncios', accent: '#C0714F', icon: '▤', iconBg: '#F8EAE1',
      value: fmtInt(k.totalListings.value), delta: k.totalListings.deltaPct,
      caption: 'produtos, serviços e eventos', hint: 'Anúncios publicados na plataforma',
      chart: donutHTML(k.totalListings.productSharePct, '#C0714F', '#EFE3D6', 'café &amp; agro<br>lideram vendas'),
    },
    {
      label: 'Volume de Transações', accent: '#4A3226', icon: '◈', iconBg: '#F0EADF',
      value: fmtMoney(k.transactionVolume.valueCents), delta: k.transactionVolume.deltaPct,
      caption: 'mês corrente', hint: 'Volume bruto transacionado no marketplace',
      chart: sparklineSVG(k.transactionVolume.series, '#4A3226', 2),
    },
  ];
  $('#kpi-grid').innerHTML = cards.map(c => `
    <div class="kpi-card" style="border-top-color:${c.accent}" title="${c.hint}">
      <div class="kpi-head">
        <span>${c.label}</span>
        <div class="kpi-icon" style="background:${c.iconBg}">${c.icon}</div>
      </div>
      <div class="kpi-value-row">
        <span class="kpi-value">${c.value}</span>
        ${deltaBadge(c.delta)}
      </div>
      <div class="kpi-chart">${c.chart}</div>
      <span class="kpi-caption">${c.caption}</span>
    </div>`).join('');
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
        <div class="name">${esc(p.name)}</div>
        <div class="kind">${esc(p.kind)}</div>
      </div>
      <span class="status-pill status-${p.status}">${STATUS_LABEL[p.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve" title="Aprovar" data-action="approve">✓</button>
             <button class="btn-reject" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" title="Ver perfil">→</button>`}
      </div>
    </div>`;
  }).join('');
  return pendingCount;
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────
const HEAT_COLORS = ['#E3EBE0', '#CBDCCB', '#8AA98F', '#4E8563', '#1C6B4A', '#14402E'];

function renderHeatmap(h) {
  $('#heat-grid').innerHTML = h.cells.map(c => `
    <div class="heat-cell" style="background:${HEAT_COLORS[c.level]}"
         title="${c.spot ? `${esc(c.spot)} · ${fmtInt(c.searches)} buscas` : 'sem buscas'}"></div>`).join('');
  if (h.top) {
    $('#heat-peak').innerHTML = `<strong>Pico: ${esc(h.top.spot)}</strong><small>${fmtInt(h.top.searches)} buscas · trilhas &amp; café</small>`;
  }
  $('#heat-stats').innerHTML = `
    <div class="heat-stat"><strong>${fmtInt(h.weeklySearches)}</strong><small>buscas na semana</small></div>
    <div class="heat-stat"><strong>${fmtInt(h.offlineItineraries)}</strong><small>itinerários offline</small></div>
    <div class="heat-stat"><strong class="terra">${h.weeklyDeltaPct >= 0 ? '+' : '−'}${fmtPct(h.weeklyDeltaPct)}</strong><small>vs. semana anterior</small></div>`;
  if (h.lastSync) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(h.lastSync).getTime()) / 60000));
    const note = $('#pwa-sync-note');
    if (note) note.textContent = `Itinerários offline atualizados há ${mins} min.`;
  }
}

// ─── Listas de conteúdo ──────────────────────────────────────────────────────
let currentTab = 'product';

async function loadListings() {
  const { listings } = await api(`/listings?type=${currentTab}&limit=4`);
  $('#listing-rows').innerHTML = listings.map(l => {
    const pending = l.status === 'pending' || l.status === 'in_review';
    return `
    <div class="table-row" data-id="${l.id}">
      <div class="thumb img-${esc(l.image_kind)}" title="${esc(l.image_label || '')}">${esc(l.glyph)}</div>
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
             <button class="btn-reject" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" title="Ver anúncio">→</button>`}
      </div>
    </div>`;
  }).join('');
}

// ─── Chat & alertas ──────────────────────────────────────────────────────────
const SEVERITY_COLOR = { success: '#1C6B4A', warning: '#C0714F', info: '#8AA98F' };

async function loadChatAndAlerts() {
  const [{ messages }, { alerts }] = await Promise.all([api('/chat'), api('/alerts')]);
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
    <div class="alert-row" style="border-left-color:${color}">
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
    renderKpis(dash.kpis);
    renderHeatmap(dash.heatmap);
    renderNav(pendingCount, chatCount);
    renderHeatmap(dash.heatmap); // atualiza a nota do PWA depois que a nav existe
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
    <div class="table-row tourists-cols">
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
        <div class="name">${esc(p.name)}</div>
        <div class="kind">${esc(p.kind)}${p.city ? ' · ' + esc(p.city) : ''}</div>
      </div>
      <span class="status-pill status-${p.status}">${STATUS_LABEL[p.status]}</span>
      <div class="row-actions">
        ${pending
          ? `<button class="btn-approve" title="Aprovar" data-action="approve">✓</button>
             <button class="btn-reject" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" title="Ver perfil">→</button>`}
      </div>
    </div>`;
}

async function loadProducersView() {
  const q = $('#producers-q').value.trim();
  const statusParam = producersFilter ? `&status=${producersFilter}` : '';
  const { producers } = await api(`/producers?limit=100&q=${encodeURIComponent(q)}${statusParam}`);
  $('#producers-all').innerHTML = producers.map(producerRowHTML).join('')
    || '<p class="empty-note">Nenhum produtor com esse filtro.</p>';
}
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
      <div class="thumb img-${esc(l.image_kind)}" style="width:40px;height:40px;font-size:15px;">${esc(l.glyph)}</div>
      <div class="producer-info">
        <div class="name">${esc(l.title)}</div>
        <div class="kind">${TYPE_LABEL_ADMIN[l.type]} · ${esc(l.producer_name)}</div>
      </div>
      <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
      <div class="row-actions">
        <button class="btn-approve" title="Aprovar" data-action="approve">✓</button>
        <button class="btn-reject" title="Recusar" data-action="reject">✕</button>
      </div>
    </div>`;
}
const TYPE_LABEL_ADMIN = { product: 'Produto', service: 'Serviço', event: 'Evento' };

async function loadRegistrationsView() {
  const [{ producers }, { listings }] = await Promise.all([
    api('/producers?limit=100'),
    api('/listings?limit=100'),
  ]);
  const pendProducers = producers.filter(p => p.status === 'pending' || p.status === 'in_review');
  const pendListings = listings.filter(l => l.status === 'pending' || l.status === 'in_review');
  $('#reg-producers').innerHTML = pendProducers.map(producerRowHTML).join('')
    || '<p class="empty-note">Nenhum produtor aguardando revisão 🎉</p>';
  $('#reg-listings').innerHTML = pendListings.map(listingQueueRowHTML).join('')
    || '<p class="empty-note">Nenhum anúncio aguardando revisão 🎉</p>';
}
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
      <div class="thumb img-${esc(l.image_kind)}" title="${esc(l.image_label || '')}">${esc(l.glyph)}</div>
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
             <button class="btn-reject" title="Recusar" data-action="reject">✕</button>`
          : `<button class="btn-view" title="Ver anúncio">→</button>`}
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

// ─── Chat Interno ────────────────────────────────────────────────────────────
async function loadInternalChat() {
  const { messages } = await api('/chat?limit=30');
  const mine = m => currentAdmin && m.sender_name === currentAdmin.name;
  $('#internal-msgs').innerHTML = messages.slice().reverse().map(m => `
    <div class="msg ${mine(m) ? 'mine' : ''}">
      <span class="msg-body">${mine(m) ? '' : `<strong>${esc(m.sender_name)}:</strong> `}${esc(m.body)}</span>
      <small class="msg-meta">${fmtTime(m.created_at)}</small>
    </div>`).join('') || '<p class="empty-note">Nenhuma mensagem ainda.</p>';
  const box = $('#internal-msgs');
  box.scrollTop = box.scrollHeight;
  renderNav(null, messages.length);
}
$('#internal-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = $('#internal-input').value.trim();
  if (!body) return;
  $('#internal-input').value = '';
  try {
    await api('/chat', { method: 'POST', body: JSON.stringify({ body }) });
    loadInternalChat();
  } catch (err) { toast(err.message); }
});

// ─── Analytics ───────────────────────────────────────────────────────────────
async function loadAnalyticsView() {
  const dash = await api('/dashboard');
  const k = dash.kpis, h = dash.heatmap;

  const cards = [
    ['Buscas na semana', fmtInt(h.weeklySearches), h.weeklyDeltaPct, '#1C6B4A', 'vs. semana anterior'],
    ['Novos turistas (30d)', fmtInt(k.newTourists.value), k.newTourists.deltaPct, '#8AA98F', 'vs. período anterior'],
    ['Volume no mês', fmtMoney(k.transactionVolume.valueCents), k.transactionVolume.deltaPct, '#4A3226', 'vs. mês anterior'],
  ];
  $('#analytics-kpis').innerHTML = cards.map(([label, value, delta, accent, caption]) => `
    <div class="kpi-card" style="border-top-color:${accent}">
      <div class="kpi-head"><span>${label}</span></div>
      <div class="kpi-value-row"><span class="kpi-value">${value}</span>${deltaBadge(delta)}</div>
      <span class="kpi-caption">${caption}</span>
    </div>`).join('');

  // Agrega as buscas do mapa de calor por destino
  const bySpot = new Map();
  for (const c of h.cells) {
    if (c.spot) bySpot.set(c.spot, (bySpot.get(c.spot) || 0) + c.searches);
  }
  const top = [...bySpot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0]?.[1] || 1;
  $('#analytics-spots').innerHTML = top.map(([spot, n]) => `
    <div class="spot-row">
      <span class="spot-name">${esc(spot)}</span>
      <div class="spot-bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
      <span class="spot-n">${fmtInt(n)}</span>
    </div>`).join('') || '<p class="empty-note">Sem buscas registradas nos últimos 7 dias.</p>';

  $('#analytics-summary').innerHTML = `
    <div class="heat-stats" style="flex-direction:column; gap:10px;">
      <div class="heat-stat"><strong>${fmtInt(k.activeProducers.value)}</strong><small>produtores ativos · ${k.activeProducers.withListingsPct}% com anúncios</small></div>
      <div class="heat-stat"><strong>${fmtInt(k.totalListings.value)}</strong><small>anúncios publicados</small></div>
      <div class="heat-stat"><strong>${fmtInt(h.offlineItineraries)}</strong><small>itinerários prontos para uso offline</small></div>
      <div class="heat-stat"><strong>${esc(h.top?.spot || '—')}</strong><small>destino em destaque da semana</small></div>
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
}

// ─── Logout ──────────────────────────────────────────────────────────────────
$('#profile').addEventListener('click', async () => {
  if (!confirm('Sair do painel?')) return;
  await api('/logout', { method: 'POST' }).catch(() => {});
  showLogin();
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
