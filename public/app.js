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
  $('#login-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
}

function showApp(admin) {
  $('#login-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  $('#profile-name').textContent = admin.name;
  $('#profile-initials').textContent = admin.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#page-date').textContent = today[0].toUpperCase() + today.slice(1) + ' · Região do Caparaó, ES/MG';
  loadAll();
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function renderNav(pendingCount, chatCount) {
  const items = [
    ['◫', 'Visão Geral', true, null],
    ['⛰', 'Turistas', false, null],
    ['☕', 'Produtores/Comerciantes', false, null],
    ['✎', 'Cadastros', false, pendingCount || null],
    ['▤', 'Publicações', false, null],
    ['✦', 'Eventos', false, null],
    ['◍', 'Chat Interno', false, chatCount || null],
    ['◔', 'Analytics', false, null],
    ['⚙', 'Configurações', false, null],
  ];
  $('#sidenav').innerHTML = items.map(([icon, label, active, badge]) => `
    <button class="nav-item${active ? ' active' : ''}">
      <span class="icon">${icon}</span>
      <span>${label}</span>
      ${badge ? `<span class="nav-badge">${badge}</span>` : ''}
    </button>`).join('') + `
    <div class="pwa-card">
      <div class="pwa-card-head"><div class="dot"></div><span>PWA sincronizado</span></div>
      <p id="pwa-sync-note">Itinerários offline atualizados.</p>
    </div>`;
}

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
    if (kind === 'producers') {
      const pendingCount = await loadProducers();
      const chatBadge = document.querySelectorAll('#chat-list .chat-msg').length;
      renderNav(pendingCount, chatBadge);
    } else {
      await loadListings();
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

// ─── Login / logout ──────────────────────────────────────────────────────────
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const admin = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }),
    });
    showApp(admin);
  } catch (err) {
    $('#login-error').textContent = err.message === 'unauthorized' ? 'E-mail ou senha inválidos' : err.message;
    showLogin();
  }
});

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
api('/me').then(showApp).catch(() => showLogin());
