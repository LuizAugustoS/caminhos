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

// Planos de produtor: selo visível apenas nos planos pagos
const PLAN_LABEL = { gratuito: 'Gratuito', profissional: 'Profissional', premium: 'Premium' };
const planBadge = plan => plan && plan !== 'gratuito'
  ? `<span class="plan-badge plan-${esc(plan)}">${plan === 'premium' ? '★ ' : ''}${PLAN_LABEL[plan] || ''}</span>`
  : '';

// Avaliação média → "★★★★☆ 4.3 (12)"; sem avaliações → vazio
function starsHTML(avg, count) {
  if (!count) return '';
  const full = Math.round(Number(avg));
  return `<span class="stars" title="${Number(avg).toFixed(1)} de 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>
    <span class="stars-meta">${Number(avg).toFixed(1)} (${count})</span>`;
}

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
    // Banner suave enquanto o e-mail não foi confirmado
    document.addEventListener('DOMContentLoaded', () => showVerifyBanner(me));
    if (document.readyState !== 'loading') showVerifyBanner(me);
    return me;
  } catch {
    location.href = '/';
    return null;
  }
}

const initialsOf = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const brandHTML = `
  <div class="brand">
    <svg class="brand-mark" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true">
      <defs><clipPath id="cc-mark"><rect width="48" height="48" rx="13"/></clipPath></defs>
      <g clip-path="url(#cc-mark)">
        <rect width="48" height="48" fill="#14402E"/>
        <circle cx="34" cy="15" r="5.5" fill="#E4A85A"/>
        <path d="M-4 48 L13 25 L28 48 Z" fill="#5E8468"/>
        <path d="M6 48 L26 19 L48 48 Z" fill="#2F8A5E"/>
        <path d="M26 22 C21 29 30 31 24 37 C21 40 27 43 25 48" fill="none" stroke="#F2EBDD" stroke-width="2.3" stroke-linecap="round"/>
      </g>
    </svg>
    <div class="brand-title">
      <strong>Caminhos do Caparaó</strong>
      <small>Turismo rural · Marketplace</small>
    </div>
  </div>`;

// Ícones de linha (SVG inline, herdam currentColor) — no lugar de glifos
const ICON_PATHS = {
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
};
const icon = (name, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;

// Monograma da capa "sem foto": iniciais do parceiro (ou do título)
function monogramOf(l) {
  const base = l.producer_name || l.est_name || l.title || l.name || '?';
  return base.split(/\s+/).filter(w => /\p{L}/u.test(w)).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '·';
}
// Tom sóbrio da capa, variado de forma estável por nome (sem parecer aleatório)
function coverTone(l) {
  const s = l.producer_name || l.est_name || l.title || l.name || '';
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 4;
  return `cover-t${h + 1}`;
}
// Capa do anúncio: foto enviada pelo produtor, ou placeholder editorial
// (monograma em serifa sobre fundo linho) quando ainda não há foto.
const coverHTML = (l, cls = 'thumb') => l.image_path
  ? `<div class="${cls} has-photo"><img src="${esc(l.image_path)}" alt="" loading="lazy"></div>`
  : `<div class="${cls} cover-mono ${coverTone(l)}"><span class="cover-initials">${esc(monogramOf(l))}</span></div>`;
const thumbHTML = coverHTML; // compat: nome antigo ainda usado nas telas

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
  const lastFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" tabindex="-1">${innerHTML}</div>`;
  document.body.appendChild(overlay);
  // Nomeia o diálogo pelo primeiro título e leva o foco para dentro dele;
  // ao fechar, devolve o foco para quem abriu (navegação por teclado/leitor).
  const dialog = overlay.querySelector('.modal');
  const heading = dialog.querySelector('h1, h2, h3, h4');
  if (heading) {
    if (!heading.id) heading.id = 'modal-title-' + Math.random().toString(36).slice(2, 8);
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  (dialog.querySelector('input, textarea, select, button') || dialog).focus();
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  };
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
            <label for="mf-${f.name}">${esc(f.label)}</label>
            ${f.type === 'textarea'
              ? `<textarea id="mf-${f.name}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
              : `<input id="mf-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required !== false ? 'required' : ''} ${f.minlength ? `minlength="${f.minlength}"` : ''}>`}
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

// ─── Banner "confirme seu e-mail" (turista e produtor) ──────────────────────
function showVerifyBanner(me) {
  if (me.email_verified || me.role === 'admin' || $('#verify-banner')) return;
  const main = $('.main');
  if (!main) return;
  const bar = document.createElement('div');
  bar.id = 'verify-banner';
  bar.className = 'verify-banner';
  bar.innerHTML = `
    <span>Confirme seu e-mail (<strong>${esc(me.email)}</strong>) para proteger sua conta.</span>
    <button type="button" class="btn-secondary" id="verify-resend">Reenviar link</button>
    <button type="button" class="verify-dismiss" aria-label="Fechar" title="Fechar"><span aria-hidden="true">✕</span></button>`;
  main.prepend(bar);
  bar.querySelector('#verify-resend').addEventListener('click', async () => {
    try {
      const r = await api('/email/resend', { method: 'POST' });
      toast(r.verified ? 'Seu e-mail já está confirmado' : 'Link reenviado — confira sua caixa de entrada');
      if (r.verified) bar.remove();
    } catch (err) { toast(err.message); }
  });
  bar.querySelector('.verify-dismiss').addEventListener('click', () => bar.remove());
}

// ─── Web Push (avisos de mensagens e reservas com o app fechado) ────────────
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function pushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações');
  const cfg = await api('/push/config');
  if (!cfg.enabled) throw new Error('Notificações não estão configuradas no servidor');
  if (await Notification.requestPermission() !== 'granted') {
    throw new Error('Permissão de notificação negada no navegador');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToU8(cfg.publicKey),
  });
  await api('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
}

async function disablePush() {
  const sub = await pushSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe();
}

// ─── Menu "Minha conta" (turista e produtor) ────────────────────────────────
// Clique no perfil do topo: editar dados, trocar foto, alterar senha ou sair.
// `refresh(me)` re-renderiza nome/avatar na barra superior.
async function openAccountMenu(me, refresh) {
  const pushSub = pushSupported() ? await pushSubscription().catch(() => null) : null;
  const action = await modalPick({
    title: 'Minha conta',
    options: [
      { value: 'edit', label: 'Editar perfil', sub: 'nome e cidade' },
      { value: 'photo', label: 'Trocar minha foto', sub: 'JPG, PNG ou WebP até 5 MB' },
      { value: 'password', label: 'Alterar senha' },
      ...(pushSupported() ? [{
        value: 'push',
        label: pushSub ? 'Desativar notificações' : 'Ativar notificações',
        sub: 'mensagens e reservas avisam mesmo com o app fechado',
      }] : []),
      { value: 'logout', label: 'Sair da conta' },
      { value: 'delete', label: 'Excluir minha conta', sub: 'remove seus dados da plataforma (LGPD)' },
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
  } else if (action === 'push') {
    try {
      if (pushSub) {
        await disablePush();
        toast('Notificações desativadas neste aparelho');
      } else {
        await enablePush();
        toast('Notificações ativadas — você será avisado de mensagens e reservas');
      }
    } catch (err) { toast(err.message); }
  } else if (action === 'logout') {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  } else if (action === 'delete') {
    const warning = me.role === 'producer'
      ? 'Sua conta, o estabelecimento, os anúncios, as fotos, as reservas e as conversas serão apagados de forma definitiva.'
      : 'Sua conta, os roteiros, os favoritos, as reservas e as conversas serão apagados de forma definitiva.';
    const values = await modalForm({
      title: 'Excluir minha conta',
      confirmText: 'Excluir definitivamente',
      fields: [{ name: 'password', label: `${warning} Digite sua senha para confirmar:`, type: 'password' }],
    });
    if (!values) return;
    try {
      await api('/me', { method: 'DELETE', body: JSON.stringify({ password: values.password }) });
      location.href = '/';
    } catch (err) { toast(err.message); }
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
