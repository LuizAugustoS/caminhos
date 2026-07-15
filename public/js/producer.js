/* Portal do Produtor/Comerciante: vitrine de anúncios, mensagens e perfil. */
'use strict';

let me = null;
let myListings = [];
let editingId = null;
let currentConvId = null;

// ─── Views ───────────────────────────────────────────────────────────────────
const VIEWS = { showcase: loadShowcase, chat: loadConversations, profile: loadProfile };

function switchView(name) {
  $$('.vtab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${name}`));
  VIEWS[name]();
}
$$('.vtab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

// ─── Vitrine ─────────────────────────────────────────────────────────────────
async function loadShowcase() {
  try {
    const [overview, { listings }] = await Promise.all([api('/portal/overview'), api('/portal/listings')]);
    myListings = listings;

    const st = $('#producer-status');
    st.className = `status-pill status-${overview.producer.status}`;
    st.textContent = overview.producer.status === 'approved'
      ? 'Parceiro aprovado' : `Cadastro: ${STATUS_LABEL[overview.producer.status]}`;
    st.classList.remove('hidden');
    $('#showcase-sub').textContent = `${overview.producer.name} · anúncios de produtos, serviços e eventos`;

    const badge = $('#chat-badge');
    badge.classList.toggle('hidden', !overview.unreadMessages);
    badge.textContent = overview.unreadMessages || '';

    const kpis = [
      ['Publicados', overview.listings.approved, '#1C6B4A', 'visíveis para turistas'],
      ['Em revisão', overview.listings.pending, '#C0714F', 'aguardando moderação'],
      ['Mensagens não lidas', overview.unreadMessages, '#4A3226', 'de turistas interessados'],
    ];
    $('#portal-kpis').innerHTML = kpis.map(([label, value, accent, caption]) => `
      <div class="kpi-card" style="border-top-color:${accent}">
        <div class="kpi-head"><span>${label}</span></div>
        <div class="kpi-value-row"><span class="kpi-value">${value}</span></div>
        <span class="kpi-caption">${caption}</span>
      </div>`).join('');

    $('#my-listings').innerHTML = listings.map(l => `
      <div class="table-row listing-cols" data-id="${l.id}">
        ${thumbHTML(l)}
        <div class="cell-title">
          <div class="t">${esc(l.title)}</div>
          <div class="s">${esc(l.subtitle || '')}</div>
        </div>
        <span class="cell-date">${TYPE_LABEL[l.type]}</span>
        <span class="cell-date">${fmtDate(l.listed_at)}</span>
        <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
        <div class="row-actions">
          <button class="btn-view" data-action="photo" title="Foto do anúncio">📷</button>
          <button class="btn-view" data-action="edit" title="Editar">✎</button>
          <button class="btn-reject" data-action="delete" title="Excluir">✕</button>
        </div>
      </div>`).join('') || '<p class="empty-note">Nenhum anúncio ainda — crie o primeiro!</p>';
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  }
}

function openListingForm(listing) {
  editingId = listing?.id ?? null;
  $('#listing-form-title').textContent = editingId ? 'Editar anúncio' : 'Novo anúncio';
  $('#l-type').value = listing?.type || 'product';
  $('#l-image').value = listing?.image_kind || 'cafe';
  $('#l-title').value = listing?.title || '';
  $('#l-subtitle').value = listing?.subtitle || '';
  $('#listing-form').classList.remove('hidden');
  $('#l-title').focus();
}

$('#btn-new-listing').addEventListener('click', () => openListingForm(null));
$('#listing-cancel').addEventListener('click', () => $('#listing-form').classList.add('hidden'));

$('#listing-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = JSON.stringify({
    type: $('#l-type').value,
    image_kind: $('#l-image').value,
    title: $('#l-title').value,
    subtitle: $('#l-subtitle').value || null,
  });
  try {
    if (editingId) await api(`/portal/listings/${editingId}`, { method: 'PUT', body });
    else await api('/portal/listings', { method: 'POST', body });
    $('#listing-form').classList.add('hidden');
    toast('Anúncio enviado para revisão');
    loadShowcase();
  } catch (err) { toast(err.message); }
});

// Upload da foto do anúncio (JPG/PNG/WebP até 5 MB)
const photoInput = Object.assign(document.createElement('input'), {
  type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true,
});
document.body.appendChild(photoInput);
let photoListingId = null;

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  if (!file || !photoListingId) return;
  if (file.size > 5 * 1024 * 1024) return toast('Imagem muito grande — máximo 5 MB');
  const form = new FormData();
  form.append('image', file);
  try {
    const res = await fetch(`/api/portal/listings/${photoListingId}/image`, {
      method: 'POST', body: form, credentials: 'same-origin',
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Erro ${res.status}`);
    toast('Foto do anúncio atualizada 📷');
    loadShowcase();
  } catch (err) { toast(err.message); }
});

$('#my-listings').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.closest('.table-row').dataset.id);
  if (btn.dataset.action === 'photo') {
    photoListingId = id;
    photoInput.click();
  } else if (btn.dataset.action === 'edit') {
    openListingForm(myListings.find(l => l.id === id));
  } else if (btn.dataset.action === 'delete') {
    const ok = await modalConfirm({
      title: 'Excluir anúncio',
      message: 'O anúncio sairá da vitrine e da plataforma. Essa ação não pode ser desfeita.',
      confirmText: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/portal/listings/${id}`, { method: 'DELETE' });
      toast('Anúncio excluído');
      loadShowcase();
    } catch (err) { toast(err.message); }
  }
});

// ─── Mensagens ───────────────────────────────────────────────────────────────
async function loadConversations() {
  try {
    const { conversations } = await api('/conversations');
    const unread = conversations.reduce((s, c) => s + Number(c.unread || 0), 0);
    const badge = $('#chat-badge');
    badge.classList.toggle('hidden', !unread);
    badge.textContent = unread || '';
    $('#conv-list').innerHTML = conversations.map(c => `
      <div class="conv-row ${c.id === currentConvId ? 'active' : ''}" data-id="${c.id}">
        <div class="avatar md" style="background:#4A3226">${esc(initialsOf(c.tourist_name))}</div>
        <div class="conv-info">
          <strong>${esc(c.tourist_name)}</strong>
          <small>${esc((c.last_message || 'Sem mensagens').slice(0, 48))}</small>
        </div>
        ${Number(c.unread) ? `<span class="nav-badge">${c.unread}</span>` : ''}
      </div>`).join('') || '<p class="empty-note">Nenhuma conversa ainda — turistas iniciam o contato pelos seus anúncios.</p>';
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  }
}

async function openThread(convId) {
  currentConvId = convId;
  try {
    const { messages } = await api(`/conversations/${convId}/messages`);
    $('#conv-thread').innerHTML = `
      <div class="thread-msgs" id="thread-msgs">
        ${messages.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('')}
      </div>
      <form class="thread-form" id="thread-form">
        <input id="thread-input" type="text" placeholder="Responder ao turista…" autocomplete="off">
        <button type="submit" class="btn-primary">Enviar</button>
      </form>`;
    const box = $('#thread-msgs');
    box.scrollTop = box.scrollHeight;
    $('#thread-form').addEventListener('submit', async e => {
      e.preventDefault();
      const body = $('#thread-input').value.trim();
      if (!body) return;
      $('#thread-input').value = '';
      await api(`/conversations/${convId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body, client_uid: crypto.randomUUID?.() || String(Date.now()) }),
      });
      openThread(convId);
    });
    loadConversations();
  } catch (err) { toast(err.message); }
}

$('#conv-list').addEventListener('click', e => {
  const row = e.target.closest('.conv-row');
  if (row) openThread(Number(row.dataset.id));
});

// ─── Perfil do estabelecimento ───────────────────────────────────────────────
async function loadProfile() {
  try {
    const est = await api('/portal/establishment');
    if (!est) return;
    $('#e-name').value = est.name || '';
    $('#e-description').value = est.description || '';
    $('#e-category').value = est.category || '';
    $('#e-city').value = est.city || '';
    $('#e-address').value = est.address || '';
    $('#e-phone').value = est.phone || '';
    $('#e-hours').value = est.open_hours || '';
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  }
}

$('#profile-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/portal/establishment', {
      method: 'PUT',
      body: JSON.stringify({
        name: $('#e-name').value,
        description: $('#e-description').value || null,
        category: $('#e-category').value || null,
        city: $('#e-city').value || null,
        address: $('#e-address').value || null,
        phone: $('#e-phone').value || null,
        open_hours: $('#e-hours').value || null,
      }),
    });
    toast('Perfil atualizado');
  } catch (err) { toast(err.message); }
});

// ─── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  me = await requireSession('producer');
  if (!me) return;
  $('#brand-slot').outerHTML = brandHTML;
  $('#profile-name').textContent = me.name;
  $('#profile-initials').textContent = initialsOf(me.name);
  $('#profile').addEventListener('click', async () => {
    if (!await modalConfirm({ title: 'Sair da conta', confirmText: 'Sair' })) return;
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
  loadShowcase();
})();
