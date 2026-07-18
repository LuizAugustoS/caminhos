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
// Reservas: classe visual reaproveita as pills de status existentes
const BOOKING_PILL = {
  pending: 'status-in_review', confirmed: 'status-approved', declined: 'status-rejected',
  completed: 'status-approved', cancelled: 'status-rejected',
};

// Preço em centavos → "R$ 48 · 500g"; null → "sob consulta"
function fmtPrice(cents, unit) {
  if (cents == null) return unit || 'sob consulta';
  const v = (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  });
  return `R$ ${v}${unit ? ` · ${unit}` : ''}`;
}

// Data de evento (YYYY-MM-DD ou ISO) → "sáb, 8 de ago"
function fmtEventDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}
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

// Capa do anúncio: foto enviada pelo produtor ou gradiente do design
const thumbHTML = (l, cls = 'thumb') => l.image_path
  ? `<div class="${cls} has-photo"><img src="${esc(l.image_path)}" alt="" loading="lazy"></div>`
  : `<div class="${cls} img-${esc(l.image_kind || 'verde')}">${esc(l.glyph || '◉')}</div>`;

// Avatar: foto enviada pelo usuário ou iniciais sobre a cor do perfil
function renderAvatar(el, { name, avatar_path }) {
  if (!el) return;
  if (avatar_path) el.innerHTML = `<img class="avatar-photo" src="${esc(avatar_path)}" alt="">`;
  else el.textContent = initialsOf(name || '–');
}

// Abre o seletor de arquivo e envia a imagem (multipart, campo 'image').
// Resolve com o JSON da resposta, ou null se o usuário cancelar.
function pickAndUploadImage(url) {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
    });
    document.body.appendChild(input);
    input.addEventListener('cancel', () => { input.remove(); resolve(null); });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return resolve(null);
      if (file.size > 5 * 1024 * 1024) return reject(new Error('Imagem muito grande — máximo 5 MB'));
      const form = new FormData();
      form.append('image', file);
      try {
        const res = await fetch(url, { method: 'POST', body: form, credentials: 'same-origin' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
        resolve(await res.json());
      } catch (err) { reject(err); }
    });
    input.click();
  });
}

const msgBubble = (body, mine, meta) => `
  <div class="msg ${mine ? 'mine' : ''}">
    <span class="msg-body">${esc(body)}</span>
    <small class="msg-meta">${esc(meta)}</small>
  </div>`;

// ─── Modais (substituem prompt/confirm nativos) ─────────────────────────────
function openModal(innerHTML) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') { close(); overlay.dispatchEvent(new Event('modal-cancel')); } };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-modal-cancel]')) {
      close();
      overlay.dispatchEvent(new Event('modal-cancel'));
    }
  });
  return { overlay, close };
}

// Formulário: resolve com {campo: valor} ou null se cancelado
function modalForm({ title, fields, confirmText = 'Salvar' }) {
  return new Promise(resolve => {
    const { overlay, close } = openModal(`
      <h3>${esc(title)}</h3>
      <form class="modal-form">
        ${fields.map(f => `
          <div class="field">
            <label>${esc(f.label)}</label>
            ${f.type === 'textarea'
              ? `<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
              : `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required !== false ? 'required' : ''} ${f.minlength ? `minlength="${f.minlength}"` : ''}>`}
          </div>`).join('')}
        <div class="row-actions modal-actions">
          <button type="submit" class="btn-primary">${esc(confirmText)}</button>
          <button type="button" class="btn-secondary" data-modal-cancel>Cancelar</button>
        </div>
      </form>`);
    overlay.addEventListener('modal-cancel', () => resolve(null));
    const form = overlay.querySelector('form');
    form.querySelector('input, textarea')?.focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = {};
      for (const f of fields) {
        const v = form.elements[f.name].value;
        values[f.name] = f.type === 'password' ? v : v.trim(); // senha não sofre trim
      }
      close();
      resolve(values);
    });
  });
}

// Confirmação: resolve true/false
function modalConfirm({ title, message, confirmText = 'Confirmar', danger = false }) {
  return new Promise(resolve => {
    const { overlay, close } = openModal(`
      <h3>${esc(title)}</h3>
      ${message ? `<p class="modal-msg">${esc(message)}</p>` : ''}
      <div class="row-actions modal-actions">
        <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-modal-ok>${esc(confirmText)}</button>
        <button class="btn-secondary" data-modal-cancel>Cancelar</button>
      </div>`);
    overlay.addEventListener('modal-cancel', () => resolve(false));
    overlay.querySelector('[data-modal-ok]').addEventListener('click', () => { close(); resolve(true); });
  });
}

// Escolha em lista: resolve com o value da opção ou null
function modalPick({ title, options }) {
  return new Promise(resolve => {
    const { overlay, close } = openModal(`
      <h3>${esc(title)}</h3>
      <div class="modal-options">
        ${options.map(o => `
          <button class="modal-option" data-value="${esc(o.value)}">
            <strong>${esc(o.label)}</strong>
            ${o.sub ? `<small>${esc(o.sub)}</small>` : ''}
          </button>`).join('')}
      </div>
      <div class="row-actions modal-actions">
        <button class="btn-secondary" data-modal-cancel>Cancelar</button>
      </div>`);
    overlay.addEventListener('modal-cancel', () => resolve(null));
    overlay.querySelectorAll('.modal-option').forEach(btn =>
      btn.addEventListener('click', () => { close(); resolve(btn.dataset.value); }));
  });
}

// ─── Menu "Minha conta" (turista e produtor) ────────────────────────────────
// Clique no perfil do topo: editar dados, trocar foto, alterar senha ou sair.
// `refresh(me)` re-renderiza nome/avatar na barra superior.
async function openAccountMenu(me, refresh) {
  const action = await modalPick({
    title: 'Minha conta',
    options: [
      { value: 'edit', label: 'Editar perfil', sub: 'nome e cidade' },
      { value: 'photo', label: 'Trocar minha foto', sub: 'JPG, PNG ou WebP até 5 MB' },
      { value: 'password', label: 'Alterar senha' },
      { value: 'logout', label: 'Sair da conta' },
    ],
  });
  if (action === 'edit') {
    const values = await modalForm({
      title: 'Editar perfil',
      confirmText: 'Salvar',
      fields: [
        { name: 'name', label: 'Nome', value: me.name },
        { name: 'city', label: 'Cidade', value: me.city || '', required: false, placeholder: 'Ex.: Alto Caparaó' },
      ],
    });
    if (!values) return;
    try {
      const updated = await api('/me', { method: 'PUT', body: JSON.stringify(values) });
      Object.assign(me, updated);
      refresh?.(me);
      toast('Perfil atualizado');
    } catch (err) { toast(err.message); }
  } else if (action === 'photo') {
    try {
      const up = await pickAndUploadImage('/api/me/avatar');
      if (!up) return;
      me.avatar_path = up.avatar_path;
      refresh?.(me);
      toast('Foto de perfil atualizada');
    } catch (err) { toast(err.message); }
  } else if (action === 'password') {
    const values = await modalForm({
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
  } else if (action === 'logout') {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  }
}

function updateOnlineState() {
  document.body.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
document.addEventListener('DOMContentLoaded', updateOnlineState);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
