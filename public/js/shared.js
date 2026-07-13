/* Utilidades compartilhadas entre as páginas do PWA */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
const fmtTime = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL = { pending: 'Pendente', in_review: 'Em análise', approved: 'Aprovado', rejected: 'Recusado' };
const TYPE_LABEL = { product: 'Produto', service: 'Serviço', event: 'Evento' };
const HOME_BY_ROLE = { admin: '/admin', tourist: '/app', producer: '/portal' };

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
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
  if (res.status === 401) { const e = new Error('unauthorized'); e.unauthorized = true; throw e; }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Erro ${res.status}`);
  }
  return res.json();
}

// Garante sessão com o papel esperado; redireciona caso contrário.
async function requireSession(role) {
  try {
    const me = await api('/me');
    if (role && me.role !== role) { location.href = HOME_BY_ROLE[me.role] || '/'; return null; }
    return me;
  } catch {
    location.href = '/';
    return null;
  }
}

const initialsOf = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const brandHTML = `
  <div class="brand">
    <div class="brand-mark">
      <div class="brand-sun"></div>
      <div class="brand-peak-green"></div>
      <div class="brand-peak-brown"></div>
      <div class="brand-bean"></div>
    </div>
    <div class="brand-title">
      <strong>Caminhos do Caparaó</strong>
      <small>Turismo rural · Marketplace</small>
    </div>
  </div>`;

const msgBubble = (body, mine, meta) => `
  <div class="msg ${mine ? 'mine' : ''}">
    <span class="msg-body">${esc(body)}</span>
    <small class="msg-meta">${esc(meta)}</small>
  </div>`;

function updateOnlineState() {
  document.body.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
document.addEventListener('DOMContentLoaded', updateOnlineState);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
