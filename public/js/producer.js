/* Portal do Produtor/Comerciante: vitrine de anúncios, mensagens e perfil. */
'use strict';

let me = null;
let myListings = [];
let editingId = null;
let currentConvId = null;

// ─── Views ───────────────────────────────────────────────────────────────────
const VIEWS = { showcase: loadShowcase, bookings: loadBookings, chat: loadConversations, profile: loadProfile };

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

    const plan = overview.plan;
    const pp = $('#producer-plan');
    pp.className = `plan-badge plan-${plan.key}`;
    pp.style.cursor = 'pointer';
    pp.title = 'Solicitar mudança de plano';
    pp.textContent = `${plan.key === 'premium' ? '★ ' : ''}Plano ${plan.label} · ${plan.active_listings}${plan.max_listings != null ? `/${plan.max_listings}` : ''} anúncio${plan.active_listings === 1 && plan.max_listings == null ? '' : 's'}`;
    pp.onclick = () => openPlanRequest(plan.key);

    const badge = $('#chat-badge');
    badge.classList.toggle('hidden', !overview.unreadMessages);
    badge.textContent = overview.unreadMessages || '';

    const kpis = [
      ['Publicados', overview.listings.approved, '#1C6B4A', 'visíveis para turistas'],
      ['Em revisão', overview.listings.pending, '#C0714F', 'aguardando moderação'],
      ['Mensagens não lidas', overview.unreadMessages, '#4A3226', 'de turistas interessados'],
      ['Avaliação média', overview.rating.count ? `★ ${Number(overview.rating.avg).toFixed(1)}` : '—',
        '#9A6224', overview.rating.count
          ? `${overview.rating.count} avaliaç${overview.rating.count > 1 ? 'ões' : 'ão'} de turistas`
          : 'após vendas concluídas'],
    ];
    $('#portal-kpis').innerHTML = kpis.map(([label, value, accent, caption]) => `
      <div class="kpi-card" style="border-top-color:${accent}">
        <div class="kpi-head"><span>${label}</span></div>
        <div class="kpi-value-row"><span class="kpi-value">${value}</span></div>
        <span class="kpi-caption">${caption}</span>
      </div>`).join('');

    $('#my-listings').innerHTML = listings.map(l => `
      <div class="table-row listing-cols ${l.available ? '' : 'listing-paused'}" data-id="${l.id}" data-available="${l.available}">
        ${thumbHTML(l)}
        <div class="cell-title">
          <div class="t">${esc(l.title)}${l.available ? '' : ' <span class="paused-pill">pausado</span>'}${l.stock === 0 ? ' <span class="paused-pill">esgotado</span>' : ''}</div>
          <div class="s">${esc(l.subtitle || '')}${l.stock != null ? ` · ${l.stock} em estoque` : ''}${l.status === 'approved' ? ` · ${l.views_30d} visualizaç${l.views_30d == 1 ? 'ão' : 'ões'} em 30 dias` : ''}</div>
        </div>
        <span class="cell-date">${TYPE_LABEL[l.type]}</span>
        <span class="cell-date">${fmtDate(l.listed_at)}</span>
        <span class="status-pill status-${l.status}">${STATUS_LABEL[l.status]}</span>
        <div class="row-actions">
          ${l.status === 'approved' ? `
            <button class="btn-view" data-action="share" aria-label="Copiar link público" title="Copiar link público">${icon('share')}</button>
            <button class="btn-view" data-action="toggle" aria-label="${l.available ? 'Pausar anúncio' : 'Reativar anúncio'}" title="${l.available ? 'Pausar anúncio' : 'Reativar anúncio'}">${icon(l.available ? 'pause' : 'play')}</button>` : ''}
          <button class="btn-view" data-action="photo" aria-label="Fotos do anúncio" title="Fotos do anúncio">${icon('image')}</button>
          <button class="btn-view" data-action="edit" aria-label="Editar" title="Editar">${icon('edit')}</button>
          <button class="btn-reject" data-action="delete" aria-label="Excluir" title="Excluir">${icon('close')}</button>
        </div>
      </div>`).join('') || '<p class="empty-note">Nenhum anúncio ainda — crie o primeiro!</p>';
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  }
}

// Campos de evento só aparecem quando o tipo é "Evento"
function syncEventFields() {
  const isEvent = $('#l-type').value === 'event';
  $$('[data-event-field]').forEach(f => f.classList.toggle('hidden', !isEvent));
}
$('#l-type').addEventListener('change', syncEventFields);

function openListingForm(listing) {
  editingId = listing?.id ?? null;
  $('#listing-form-title').textContent = editingId ? 'Editar anúncio' : 'Novo anúncio';
  $('#l-type').value = listing?.type || 'product';

  $('#l-title').value = listing?.title || '';
  $('#l-subtitle').value = listing?.subtitle || '';
  $('#l-price').value = listing?.price_cents ? (listing.price_cents / 100).toFixed(2) : '';
  $('#l-price-unit').value = listing?.price_unit || '';
  $('#l-stock').value = listing?.stock ?? '';
  $('#l-event-date').value = listing?.event_date ? listing.event_date.slice(0, 10) : '';
  $('#l-event-time').value = listing?.event_time || '';
  $('#l-event-place').value = listing?.event_place || '';
  syncEventFields();
  $('#listing-form').classList.remove('hidden');
  $('#l-title').focus();
}

$('#btn-new-listing').addEventListener('click', () => openListingForm(null));
$('#listing-cancel').addEventListener('click', () => $('#listing-form').classList.add('hidden'));

$('#listing-form').addEventListener('submit', async e => {
  e.preventDefault();
  const price = parseFloat(String($('#l-price').value).replace(',', '.'));
  const body = JSON.stringify({
    type: $('#l-type').value,
    image_kind: 'verde',
    title: $('#l-title').value,
    subtitle: $('#l-subtitle').value || null,
    price_cents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
    price_unit: $('#l-price-unit').value || null,
    event_date: $('#l-event-date').value || null,
    event_time: $('#l-event-time').value || null,
    event_place: $('#l-event-place').value || null,
    stock: $('#l-stock').value === '' ? null : Math.max(0, parseInt($('#l-stock').value, 10) || 0),
  });
  try {
    if (editingId) await api(`/portal/listings/${editingId}`, { method: 'PUT', body });
    else await api('/portal/listings', { method: 'POST', body });
    $('#listing-form').classList.add('hidden');
    toast('Anúncio enviado para revisão');
    loadShowcase();
  } catch (err) { toast(err.message); }
});

$('#my-listings').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.closest('.table-row').dataset.id);
  if (btn.dataset.action === 'share') {
    const link = `${location.origin}/p/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado — cole no WhatsApp ou onde quiser');
    } catch { toast(link); }
  } else if (btn.dataset.action === 'toggle') {
    const available = btn.closest('.table-row').dataset.available !== 'true';
    try {
      await api(`/portal/listings/${id}/availability`, { method: 'POST', body: JSON.stringify({ available }) });
      toast(available ? 'Anúncio reativado no Explorar' : 'Anúncio pausado — some do Explorar até reativar');
      loadShowcase();
    } catch (err) { toast(err.message); }
  } else if (btn.dataset.action === 'photo') {
    openGalleryManager(id);
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

// ─── Mudança de plano (pedido para a equipe; cobrança fora do app) ──────────
async function openPlanRequest(currentPlan) {
  let plans = [];
  try { ({ plans } = await api('/plans')); } catch { return; }
  const pick = await modalPick({
    title: 'Solicitar mudança de plano',
    options: plans.filter(p => p.key !== currentPlan).map(p => ({
      value: p.key,
      label: `${p.label} · ${p.price_cents ? `R$ ${(p.price_cents / 100).toLocaleString('pt-BR')}/mês` : 'R$ 0'}`,
      sub: `${p.max_listings == null ? 'anúncios ilimitados' : `até ${p.max_listings} anúncios`} · ${p.max_photos} foto${p.max_photos > 1 ? 's' : ''}/anúncio${p.featured ? ' · destaque no Explorar' : ''}`,
    })),
  });
  if (!pick) return;
  const values = await modalForm({
    title: 'Quase lá',
    confirmText: 'Enviar pedido',
    fields: [{ name: 'note', label: 'Observação para a equipe (opcional)', type: 'textarea', required: false,
      placeholder: 'Ex.: melhor horário para contato, dúvidas sobre o plano…' }],
  });
  if (values === null) return;
  try {
    await api('/portal/plan-request', { method: 'POST', body: JSON.stringify({ plan: pick, note: values.note || null }) });
    toast('Pedido enviado — a equipe entra em contato para combinar a mudança');
  } catch (err) { toast(err.message); }
}

// ─── Galeria de fotos do anúncio ─────────────────────────────────────────────
// A primeira foto é a capa exibida nos cards; o limite de fotos vem do plano.
async function openGalleryManager(id) {
  let images, max_photos;
  try { ({ images, max_photos } = await api(`/portal/listings/${id}/images`)); }
  catch (err) { return toast(err.message); }
  const canAdd = max_photos == null || images.length < max_photos;
  const { overlay, close } = openModal(`
    <h3>Fotos do anúncio</h3>
    <p class="modal-msg">A primeira foto é a capa do anúncio.${max_photos != null
      ? ` Seu plano permite até ${max_photos} foto${max_photos > 1 ? 's' : ''} por anúncio.` : ''}</p>
    <div class="gallery-grid">
      ${images.map((img, i) => `
        <div class="gallery-item" data-img="${img.id}">
          <img src="${esc(img.path)}" alt="">
          ${i === 0 ? '<span class="gallery-cover">capa</span>' : ''}
          <button type="button" class="gallery-del" aria-label="Remover foto" title="Remover foto">${icon('close')}</button>
        </div>`).join('') || '<p class="empty-note">Nenhuma foto ainda — a capa ilustrativa é usada no lugar.</p>'}
    </div>
    <div class="row-actions modal-actions">
      ${canAdd ? '<button type="button" class="btn-primary" data-gal-add>+ Adicionar foto</button>' : ''}
      <button type="button" class="btn-secondary" data-modal-cancel>Fechar</button>
    </div>`);
  overlay.querySelector('[data-gal-add]')?.addEventListener('click', async () => {
    close();
    try {
      const up = await pickAndUploadImage(`/api/portal/listings/${id}/images`);
      if (up) { toast('Foto adicionada'); loadShowcase(); }
    } catch (err) { toast(err.message); }
    openGalleryManager(id);
  });
  overlay.querySelectorAll('.gallery-del').forEach(btn => btn.addEventListener('click', async e => {
    const imgId = e.currentTarget.closest('.gallery-item').dataset.img;
    close();
    if (await modalConfirm({ title: 'Remover foto', confirmText: 'Remover', danger: true })) {
      try {
        await api(`/portal/listings/${id}/images/${imgId}`, { method: 'DELETE' });
        toast('Foto removida');
        loadShowcase();
      } catch (err) { toast(err.message); }
    }
    openGalleryManager(id);
  }));
}

// ─── Reservas ────────────────────────────────────────────────────────────────
function setBkBadge(pending) {
  const badge = $('#bk-badge');
  badge.classList.toggle('hidden', !pending);
  badge.textContent = pending || '';
}

const producerBookingRow = b => `
  <div class="bk-row" data-id="${b.id}">
    <div class="bk-info">
      <strong>${b.qty} × ${esc(b.title)}</strong>
      <small>${esc(b.tourist_name)} · pedido em ${fmtDate(b.created_at)}${b.requested_date ? ` · para ${fmtDate(b.requested_date)}` : ''}</small>
      ${b.note ? `<small>Obs.: ${esc(b.note)}</small>` : ''}
      <small>${esc(fmtPrice(b.price_cents, b.price_unit))}${b.price_cents ? ` — total ${esc(fmtPrice(b.price_cents * b.qty))}` : ''}</small>
    </div>
    <span class="status-pill ${BOOKING_PILL[b.status]}">${esc(b.status_label)}</span>
    <div class="row-actions">
      ${b.status === 'pending' ? `
        <button class="btn-approve" data-bk="confirmed">Confirmar</button>
        <button class="btn-reject" data-bk="declined" aria-label="Recusar" title="Recusar">${icon('close')}</button>` : ''}
      ${b.status === 'confirmed' ? '<button class="btn-primary" data-bk="completed">Concluir venda</button>' : ''}
    </div>
  </div>`;

let bookingsOffset = 0;

async function loadBookings() {
  try {
    const { bookings, pending, hasMore } = await api('/portal/bookings');
    setBkBadge(pending);
    bookingsOffset = bookings.length;
    $('#producer-bookings').innerHTML = bookings.map(producerBookingRow).join('')
      + (hasMore ? '<button class="btn-secondary load-more" data-bk-more>Carregar mais</button>' : '')
      || '<p class="empty-note">Nenhuma reserva ainda — os pedidos dos turistas aparecem aqui.</p>';
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  }
}

$('#producer-bookings').addEventListener('click', async e => {
  const moreBtn = e.target.closest('[data-bk-more]');
  if (moreBtn) {
    moreBtn.disabled = true;
    try {
      const { bookings, hasMore } = await api(`/portal/bookings?offset=${bookingsOffset}`);
      bookingsOffset += bookings.length;
      moreBtn.insertAdjacentHTML('beforebegin', bookings.map(producerBookingRow).join(''));
      if (!hasMore) moreBtn.remove(); else moreBtn.disabled = false;
    } catch (err) { toast(err.message); moreBtn.disabled = false; }
    return;
  }
  const btn = e.target.closest('[data-bk]');
  if (!btn) return;
  const id = btn.closest('.bk-row').dataset.id;
  const status = btn.dataset.bk;
  if (status === 'declined' &&
      !await modalConfirm({ title: 'Recusar reserva', confirmText: 'Recusar', danger: true })) return;
  try {
    await api(`/portal/bookings/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    toast({ confirmed: 'Reserva confirmada', declined: 'Reserva recusada', completed: 'Venda registrada' }[status]);
    loadBookings();
  } catch (err) { toast(err.message); }
});

// ─── Mensagens ───────────────────────────────────────────────────────────────
async function loadConversations() {
  try {
    const { conversations, unreadTotal } = await api('/conversations');
    const unread = unreadTotal ?? conversations.reduce((s, c) => s + Number(c.unread || 0), 0);
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

let threadHasMore = false, threadOldestId = null;
const olderBtnHTML = () => threadHasMore
  ? `<button type="button" class="btn-secondary load-more" id="thread-older" data-before="${threadOldestId}">Carregar mensagens anteriores</button>`
  : '';

// Atualiza só as bolhas de mensagem (o campo de digitação fica intocado)
async function refreshThreadMsgs(convId) {
  const box = $('#thread-msgs');
  if (!box || convId !== currentConvId) return;
  const data = await api(`/conversations/${convId}/messages`);
  if (convId !== currentConvId) return;
  threadHasMore = data.hasMore; threadOldestId = data.oldestId;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = olderBtnHTML() + data.messages.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function openThread(convId) {
  currentConvId = convId;
  $('.chat-layout')?.classList.add('thread-open'); // celular: mostra a conversa
  try {
    const data = await api(`/conversations/${convId}/messages`);
    threadHasMore = data.hasMore; threadOldestId = data.oldestId;
    $('#conv-thread').innerHTML = `
      <button type="button" class="thread-back" id="thread-back">‹ Conversas</button>
      <div class="thread-msgs" id="thread-msgs">
        ${olderBtnHTML()}
        ${data.messages.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('')}
      </div>
      <form class="thread-form" id="thread-form">
        <input id="thread-input" type="text" placeholder="Responder ao turista…" autocomplete="off">
        <button type="submit" class="btn-primary">Enviar</button>
      </form>`;
    const box = $('#thread-msgs');
    box.scrollTop = box.scrollHeight;
    box.addEventListener('click', async ev => {
      const older = ev.target.closest('#thread-older');
      if (!older) return;
      older.disabled = true;
      try {
        const d = await api(`/conversations/${convId}/messages?before=${older.dataset.before}`);
        threadHasMore = d.hasMore; threadOldestId = d.oldestId;
        const prevH = box.scrollHeight;
        older.remove();
        box.insertAdjacentHTML('afterbegin',
          olderBtnHTML() + d.messages.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join(''));
        box.scrollTop = box.scrollHeight - prevH;
      } catch (err) { toast(err.message); older.disabled = false; }
    });
    $('#thread-back').addEventListener('click', () => {
      currentConvId = null;
      $('.chat-layout')?.classList.remove('thread-open');
      loadConversations();
    });
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

// Tempo real: o servidor empurra novas mensagens via SSE
function connectEvents() {
  if (!('EventSource' in window)) return;
  const es = new EventSource('/api/events');
  es.addEventListener('chat', e => {
    const { conversation_id, from } = JSON.parse(e.data);
    loadConversations().catch(() => {});
    const chatOpen = !$('#view-chat').classList.contains('hidden');
    if (conversation_id === currentConvId && chatOpen) {
      refreshThreadMsgs(currentConvId).catch(() => {});
    } else if (from) {
      toast(`Nova mensagem de ${from}`);
    }
  });
  es.addEventListener('booking', e => {
    const { from, title } = JSON.parse(e.data);
    if (from) toast(`Novo pedido de reserva de ${from}: ${title}`);
    if (!$('#view-bookings').classList.contains('hidden')) loadBookings();
    else api('/portal/bookings').then(({ pending }) => setBkBadge(pending)).catch(() => {});
  });
}

// Rede de segurança: sincronização periódica caso o stream caia
setInterval(() => {
  if (!navigator.onLine || !me) return;
  loadConversations().catch(() => {});
  if (currentConvId && !$('#view-chat').classList.contains('hidden')) {
    refreshThreadMsgs(currentConvId).catch(() => {});
  }
}, 60000);

// ─── Perfil do estabelecimento ───────────────────────────────────────────────
function renderEstPhoto(path) {
  $('#est-photo').innerHTML = path
    ? `<img src="${esc(path)}" alt="Foto do estabelecimento">`
    : '<span class="empty-note">Sem foto</span>';
}

$('#est-photo-btn').addEventListener('click', async () => {
  try {
    const up = await pickAndUploadImage('/api/portal/establishment/photo');
    if (!up) return;
    renderEstPhoto(up.photo_path);
    toast('Foto do estabelecimento atualizada');
  } catch (err) { toast(err.message); }
});

// ─── Localização no mapa (Leaflet; clique marca o ponto) ────────────────────
let estMap = null;
let estMarker = null;
let estCoords = null; // { lat, lng } ou null

function setEstPin(lat, lng) {
  estCoords = { lat, lng };
  if (estMarker) estMarker.setLatLng([lat, lng]);
  else estMarker = L.marker([lat, lng], { draggable: true }).addTo(estMap)
    .on('dragend', () => { const p = estMarker.getLatLng(); estCoords = { lat: p.lat, lng: p.lng }; });
}

function initEstMap(est) {
  if (!navigator.onLine) return; // sem rede não há tiles — o restante do perfil funciona
  if (!estMap) {
    estMap = L.map('est-map').setView([-20.47, -41.79], 11); // região do Caparaó
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(estMap);
    estMap.on('click', e => setEstPin(e.latlng.lat, e.latlng.lng));
  }
  estMap.invalidateSize();
  if (est.lat != null && est.lng != null) {
    setEstPin(est.lat, est.lng);
    estMap.setView([est.lat, est.lng], 14);
  }
}

$('#est-geolocate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Geolocalização indisponível neste dispositivo');
  navigator.geolocation.getCurrentPosition(
    pos => {
      if (!estMap) return;
      setEstPin(pos.coords.latitude, pos.coords.longitude);
      estMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
    },
    () => toast('Não foi possível obter sua localização — toque no mapa para marcar'),
  );
});

$('#est-clear-pin').addEventListener('click', () => {
  estCoords = null;
  estMarker?.remove();
  estMarker = null;
});

async function loadProfile() {
  try {
    const est = await api('/portal/establishment');
    if (!est) return;
    renderEstPhoto(est.photo_path);
    $('#e-name').value = est.name || '';
    $('#e-description').value = est.description || '';
    $('#e-category').value = est.category || '';
    $('#e-city').value = est.city || '';
    $('#e-address').value = est.address || '';
    $('#e-phone').value = est.phone || '';
    $('#e-hours').value = est.open_hours || '';
    initEstMap(est);
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
        lat: estCoords?.lat ?? null,
        lng: estCoords?.lng ?? null,
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
  renderAvatar($('#profile-initials'), me);
  $('#profile').addEventListener('click', () => openAccountMenu(me, m => {
    $('#profile-name').textContent = m.name;
    renderAvatar($('#profile-initials'), m);
  }));
  loadShowcase();
  connectEvents();
  // Badge de reservas pendentes já na entrada
  api('/portal/bookings').then(({ pending }) => setBkBadge(pending)).catch(() => {});
})();
