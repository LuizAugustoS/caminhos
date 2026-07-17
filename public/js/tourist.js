/* Área do Turista — offline-first.
 * Roteiros e favoritos vivem no IndexedDB (fonte da verdade local); toda
 * mutação entra na fila de sincronização e é reenviada quando há rede.
 * A exploração usa a rede quando disponível e cai para o cache local offline.
 */
'use strict';

let me = null;
let exploreKind = '';
let currentTripUid = null;
let currentConvId = null;

// ─── Sincronização: indicador ────────────────────────────────────────────────
CaparaoDB.onPendingChange(n => {
  const pill = $('#sync-pill'), label = $('#sync-label');
  if (!pill) return;
  pill.classList.toggle('pending', n > 0);
  label.textContent = n > 0
    ? `${n} alteraç${n > 1 ? 'ões' : 'ão'} aguardando conexão`
    : 'Sincronizado';
});

// ─── Views ───────────────────────────────────────────────────────────────────
const VIEWS = { explore: loadExplore, trips: renderTrips, favorites: renderFavorites, chat: loadConversations };

function switchView(name) {
  $$('.vtab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${name}`));
  VIEWS[name]();
}
$$('.vtab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

// ─── Explorar ────────────────────────────────────────────────────────────────
const SKELETON_CARD = `
  <div class="sk-card">
    <div class="sk-thumb"></div>
    <div class="sk-line w60"></div>
    <div class="sk-line"></div>
    <div class="sk-line w40"></div>
  </div>`;

let exploreSeq = 0; // descarta respostas atrasadas de buscas anteriores

async function loadExplore() {
  const seq = ++exploreSeq;
  const q = $('#explore-q').value.trim();
  // Enquanto busca, mostra o esqueleto — nada de tela vazia
  $('#explore-grid').innerHTML = SKELETON_CARD.repeat(6);
  let listings = [], places = [], itineraries = [];

  if (navigator.onLine) {
    try {
      if (exploreKind === 'itineraries') {
        ({ itineraries } = await api('/explore/itineraries'));
        await CaparaoDB.put('kv', 'published-itineraries', itineraries);
      } else if (exploreKind === 'places') {
        ({ establishments: places } = await api(`/explore/establishments?q=${encodeURIComponent(q)}`));
        for (const e of places) await CaparaoDB.put('establishments', e.id, e);
      } else {
        const typeParam = exploreKind ? `&type=${exploreKind}` : '';
        ({ listings } = await api(`/explore/listings?q=${encodeURIComponent(q)}${typeParam}`));
        for (const l of listings) await CaparaoDB.put('listings', l.id, l);
      }
    } catch { /* cai para o cache local */ }
  }

  if (!navigator.onLine || (!listings.length && !places.length && !itineraries.length)) {
    const norm = s => (s || '').toLowerCase();
    if (exploreKind === 'itineraries') {
      itineraries = ((await CaparaoDB.get('kv', 'published-itineraries')) || [])
        .filter(it => !q || norm(it.title).includes(norm(q)) || norm(it.region).includes(norm(q)));
    } else if (exploreKind === 'places') {
      places = (await CaparaoDB.all('establishments'))
        .filter(e => !q || norm(e.name).includes(norm(q)) || norm(e.city).includes(norm(q)) || norm(e.category).includes(norm(q)));
    } else {
      listings = (await CaparaoDB.all('listings'))
        .filter(l => !exploreKind || l.type === exploreKind)
        .filter(l => !q || norm(l.title).includes(norm(q)) || norm(l.subtitle).includes(norm(q)) || norm(l.producer_name).includes(norm(q)));
    }
  }

  const favIds = new Set((await CaparaoDB.all('favorites')).map(f => f.listing_id));

  if (seq !== exploreSeq) return; // outra busca já começou; não sobrescreve
  const cards = exploreKind === 'itineraries' ? itineraries.map(itineraryCard)
    : exploreKind === 'places' ? places.map(placeCard)
    : listings.map(l => listingCard(l, favIds));
  $('#explore-grid').innerHTML = cards.join('')
    || `<p class="empty-note">Nada encontrado${navigator.onLine ? '' : ' no cache offline — conecte-se para explorar mais'}.</p>`;
}

const listingCard = (l, favIds) => `
  <div class="ex-card" data-id="${l.id}" data-producer="${l.producer_id}">
    ${thumbHTML(l, 'ex-thumb')}
    <div class="ex-body">
      <span class="ex-type">${TYPE_LABEL[l.type] || ''} · ${esc(l.city || 'Caparaó')}</span>
      <strong class="ex-title">${esc(l.title)}</strong>
      <span class="ex-sub">${esc(l.subtitle || '')}</span>
      <div class="ex-producer">
        <div class="avatar sm" style="background:${esc(l.producer_color || '#1C6B4A')}">${esc(l.producer_initials || '')}</div>
        <span>${esc(l.producer_name)}</span>
      </div>
    </div>
    <div class="ex-actions">
      <button class="btn-fav ${favIds.has(l.id) ? 'on' : ''}" data-action="fav" title="Favoritar">♥</button>
      <button class="btn-secondary" data-action="add-trip">+ Roteiro</button>
      <button class="btn-primary" data-action="chat">Conversar</button>
    </div>
  </div>`;

const placeCard = e => `
  <div class="ex-card" data-producer="${e.producer_id}">
    <div class="ex-thumb has-photo"><img src="${esc(e.photo_path || '/img/covers/sage.png')}" alt="" loading="lazy"></div>
    <div class="ex-body">
      <span class="ex-type">${esc(e.category || 'Estabelecimento')} · ${esc(e.city || 'Caparaó')}</span>
      <strong class="ex-title">${esc(e.name)}</strong>
      <span class="ex-sub">${esc(e.description || e.kind || '')}</span>
      <span class="ex-meta">${esc(e.address || '')}${e.open_hours ? ' · ' + esc(e.open_hours) : ''}${e.phone ? ' · ' + esc(e.phone) : ''}</span>
    </div>
    <div class="ex-actions">
      <button class="btn-secondary" data-action="add-place">+ Roteiro</button>
      <button class="btn-primary" data-action="chat">Conversar</button>
    </div>
  </div>`;

// Roteiros publicados pela equipe (disponíveis offline no PWA)
const itineraryCard = it => `
  <div class="ex-card" data-itinerary="${it.id}" data-title="${esc(it.title)}"
       data-region="${esc(it.region || '')}" data-duration="${esc(it.duration || '')}">
    <div class="ex-thumb has-photo"><img src="/img/covers/verde.png" alt="" loading="lazy"></div>
    <div class="ex-body">
      <span class="ex-type">Roteiro publicado · ${esc(it.region || 'Caparaó')}</span>
      <strong class="ex-title">${esc(it.title)}</strong>
      <span class="ex-sub">Duração: ${esc(it.duration || 'livre')}</span>
      ${it.offline_ready ? '<span class="ex-meta">Disponível offline</span>' : ''}
    </div>
    <div class="ex-actions">
      <button class="btn-primary" data-action="use-itinerary">Usar como base</button>
    </div>
  </div>`;

$('#explore-q').addEventListener('input', () => { clearTimeout(window._qT); window._qT = setTimeout(loadExplore, 300); });
$('#explore-chips').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  exploreKind = tab.dataset.kind;
  $$('#explore-chips .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadExplore();
});

// ─── Detalhe do anúncio ──────────────────────────────────────────────────────
async function openListingDetail(listingId) {
  let l = null;
  if (navigator.onLine) {
    try { l = await api(`/explore/listings/${listingId}`); } catch { /* cache */ }
  }
  if (!l) {
    const cached = await CaparaoDB.get('listings', listingId);
    if (!cached) return toast('Detalhes indisponíveis offline — conecte-se');
    const est = (await CaparaoDB.all('establishments')).find(x => x.producer_id === cached.producer_id);
    l = { ...cached, est_name: est?.name, est_description: est?.description, est_category: est?.category,
          address: est?.address, phone: est?.phone, open_hours: est?.open_hours, city: cached.city || est?.city };
  }
  const isFav = !!(await CaparaoDB.get('favorites', l.id));
  const hero = l.image_path
    ? `<div class="detail-hero"><img src="${esc(l.image_path)}" alt=""></div>`
    : `<div class="detail-hero img-${esc(l.image_kind || 'verde')}">${esc(l.glyph || '◉')}</div>`;
  const partnerLines = [
    l.est_description || l.producer_kind,
    l.address ? `${l.address}${l.city ? ` — ${l.city}` : ''}` : (l.city ? l.city : null),
    l.open_hours ? `Aberto: ${l.open_hours}` : null,
    l.phone ? `Contato: ${l.phone}` : null,
  ].filter(Boolean);

  const { overlay, close } = openModal(`
    <div class="detail-modal-inner">
      ${hero}
      <div class="detail-body">
        <span class="ex-type">${TYPE_LABEL[l.type] || ''} · ${esc(l.city || 'Caparaó')}</span>
        <h3>${esc(l.title)}</h3>
        ${l.subtitle ? `<p class="detail-sub">${esc(l.subtitle)}</p>` : ''}
        <div class="detail-partner">
          <div class="avatar lg" style="background:${esc(l.producer_color || '#1C6B4A')}">${esc(l.producer_initials || '')}</div>
          <div class="detail-partner-info">
            <strong>${esc(l.est_name || l.producer_name)}</strong>
            ${partnerLines.map(line => `<small>${esc(line)}</small>`).join('')}
          </div>
        </div>
        <div class="ex-actions">
          <button class="btn-fav ${isFav ? 'on' : ''}" data-detail="fav" title="Favoritar">♥</button>
          <button class="btn-secondary" data-detail="add-trip">+ Roteiro</button>
          <button class="btn-primary" data-detail="chat">Conversar</button>
        </div>
      </div>
    </div>`);
  overlay.querySelector('.modal').classList.add('detail-modal');
  overlay.querySelector('[data-detail=fav]').addEventListener('click', e =>
    toggleFavorite(l.id, e.currentTarget).then(loadExplore));
  overlay.querySelector('[data-detail=add-trip]').addEventListener('click', () => {
    close();
    addToTrip({ listing_id: l.id }, l.title);
  });
  overlay.querySelector('[data-detail=chat]').addEventListener('click', () => {
    close();
    startConversation(l.producer_id);
  });
}

$('#explore-grid').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) {
    // clique no corpo do card de anúncio abre o detalhe
    const card = e.target.closest('.ex-card[data-id]');
    if (card && !e.target.closest('.ex-actions')) openListingDetail(Number(card.dataset.id));
    return;
  }
  const card = btn.closest('.ex-card');
  const listingId = Number(card.dataset.id) || null;
  const producerId = Number(card.dataset.producer) || null;

  if (btn.dataset.action === 'use-itinerary') {
    const trip = {
      client_uid: CaparaoDB.uid(),
      title: card.dataset.title,
      notes: `Baseado no roteiro publicado "${card.dataset.title}"${card.dataset.region ? ` · ${card.dataset.region}` : ''}${card.dataset.duration ? ` · ${card.dataset.duration}` : ''}`,
      items: [],
    };
    await saveTripLocalAndQueue(trip);
    toast(`Roteiro copiado para Meus Roteiros${navigator.onLine ? '' : ' (offline)'}`);
    return;
  }
  if (btn.dataset.action === 'fav') return toggleFavorite(listingId, btn);
  if (btn.dataset.action === 'add-trip' || btn.dataset.action === 'add-place') {
    const item = btn.dataset.action === 'add-trip'
      ? { listing_id: listingId }
      : { establishment_id: (await CaparaoDB.all('establishments')).find(x => x.producer_id === producerId)?.id || null,
          label: card.querySelector('.ex-title').textContent };
    return addToTrip(item, card.querySelector('.ex-title').textContent);
  }
  if (btn.dataset.action === 'chat') return startConversation(producerId);
});

// ─── Favoritos ───────────────────────────────────────────────────────────────
async function toggleFavorite(listingId, btn) {
  const existing = await CaparaoDB.get('favorites', listingId);
  if (existing) {
    await CaparaoDB.del('favorites', listingId);
    btn?.classList.remove('on');
    await CaparaoDB.enqueue({ method: 'DELETE', path: `/api/favorites/${listingId}` });
    toast('Removido dos favoritos');
  } else {
    const snapshot = (await CaparaoDB.get('listings', listingId)) || { id: listingId };
    await CaparaoDB.put('favorites', listingId, { listing_id: listingId, ...snapshot });
    btn?.classList.add('on');
    await CaparaoDB.enqueue({ method: 'PUT', path: `/api/favorites/${listingId}` });
    toast('Adicionado aos favoritos ♥');
  }
}

async function renderFavorites() {
  // Online: sincroniza a lista do servidor para o cache local
  if (navigator.onLine) {
    try {
      const { favorites } = await api('/favorites');
      await CaparaoDB.clear('favorites');
      for (const f of favorites) await CaparaoDB.put('favorites', f.listing_id, f);
    } catch { /* usa o cache */ }
  }
  const favs = await CaparaoDB.all('favorites');
  $('#favorites-grid').innerHTML = favs.map(f => `
    <div class="ex-card" data-id="${f.listing_id}" data-producer="${f.producer_id || ''}">
      ${thumbHTML(f, 'ex-thumb')}
      <div class="ex-body">
        <span class="ex-type">${TYPE_LABEL[f.type] || ''}</span>
        <strong class="ex-title">${esc(f.title || 'Anúncio #' + f.listing_id)}</strong>
        <span class="ex-sub">${esc(f.subtitle || '')}</span>
        <div class="ex-producer"><span>${esc(f.producer_name || '')}</span></div>
      </div>
      <div class="ex-actions">
        <button class="btn-fav on" data-action="fav" title="Remover">♥</button>
        <button class="btn-secondary" data-action="add-trip">+ Roteiro</button>
      </div>
    </div>`).join('') || '<p class="empty-note">Nenhum favorito ainda — explore e toque no ♥.</p>';
}

$('#favorites-grid').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const card = btn.closest('.ex-card');
  const listingId = Number(card.dataset.id);
  if (btn.dataset.action === 'fav') { await toggleFavorite(listingId); renderFavorites(); }
  if (btn.dataset.action === 'add-trip') addToTrip({ listing_id: listingId }, card.querySelector('.ex-title').textContent);
});

// ─── Roteiros (IndexedDB é a fonte da verdade) ──────────────────────────────
async function pullTripsFromServer() {
  if (!navigator.onLine) return;
  const synced = await CaparaoDB.flush();       // envia pendências primeiro
  if (!synced) return;                          // ainda há fila: não sobrescreve
  try {
    const { trips } = await api('/trips');
    await CaparaoDB.clear('trips');
    for (const t of trips) {
      await CaparaoDB.put('trips', t.client_uid, {
        client_uid: t.client_uid, title: t.title, notes: t.notes,
        updated_at: t.updated_at, items: t.items,
        origin: t.origin, preferences: t.preferences,
      });
    }
  } catch { /* mantém os dados locais */ }
}

async function saveTripLocalAndQueue(trip) {
  trip.updated_at = new Date().toISOString();
  await CaparaoDB.put('trips', trip.client_uid, trip);
  await CaparaoDB.enqueue({
    method: 'PUT',
    path: `/api/trips/${trip.client_uid}`,
    body: { title: trip.title, notes: trip.notes, items: trip.items },
  });
}

async function renderTrips() {
  await pullTripsFromServer();
  const trips = (await CaparaoDB.all('trips')).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  $('#trip-detail').classList.add('hidden');
  $('#trips-list').classList.remove('hidden');
  currentTripUid = null;
  $('#trips-list').innerHTML = trips.map(t => `
    <div class="panel trip-card" data-uid="${esc(t.client_uid)}">
      <h2>${t.origin === 'ai' ? '<span class="ai-badge">sugestão</span> ' : ''}${esc(t.title)}</h2>
      <p class="trip-notes">${esc(t.notes || '')}</p>
      <span class="trip-meta">${(t.items || []).length} parada${(t.items || []).length === 1 ? '' : 's'}${t.origin === 'ai' ? ' · gerado a partir dos seus gostos' : ''}</span>
      <div class="row-actions">
        <button class="btn-primary" data-action="open">Abrir</button>
        <button class="btn-reject" data-action="delete" title="Excluir">✕</button>
      </div>
    </div>`).join('') || '<p class="empty-note">Nenhum roteiro ainda. Crie um e adicione paradas explorando a região — funciona até sem internet.</p>';
}

async function renderTripDetail(uid) {
  const trip = await CaparaoDB.get('trips', uid);
  if (!trip) return renderTrips();
  currentTripUid = uid;
  $('#trips-list').classList.add('hidden');
  const detail = $('#trip-detail');
  detail.classList.remove('hidden');
  const prefs = trip.preferences;
  const prefsLine = prefs ? [
    prefs.interests?.length ? `Gostos: ${prefs.interests.join(', ')}` : null,
    prefs.duration, prefs.pace,
    prefs.text ? `“${prefs.text}”` : null,
  ].filter(Boolean).join(' · ') : '';
  detail.innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>${trip.origin === 'ai' ? '<span class="ai-badge">sugestão</span> ' : ''}${esc(trip.title)}</h2>
          <span class="sub">${esc(trip.notes || 'Sem observações')} · <a href="#" id="trip-edit">editar</a></span>
          ${prefsLine ? `<span class="sub trip-prefs">Preferências informadas — ${esc(prefsLine)}</span>` : ''}
        </div>
        <button class="btn-secondary" id="trip-back">← Voltar</button>
      </div>
      <div class="trip-items">
        ${(trip.items || []).map((it, i) => `
          <div class="trip-item" data-i="${i}">
            <span class="trip-pos">${i + 1}</span>
            <div class="trip-item-body">
              <strong>${esc(it.listing_title || it.establishment_name || it.label || 'Parada')}</strong>
              ${it.note ? `<small>${esc(it.note)}</small>` : ''}
            </div>
            <div class="row-actions">
              <button class="btn-view" data-action="up" title="Subir">↑</button>
              <button class="btn-view" data-action="down" title="Descer">↓</button>
              <button class="btn-view" data-action="note" title="Anotação">✎</button>
              <button class="btn-reject" data-action="remove" title="Remover">✕</button>
            </div>
          </div>`).join('') || '<p class="empty-note">Sem paradas — adicione pela aba Explorar ou crie uma parada livre.</p>'}
      </div>
      <button class="btn-secondary" id="trip-add-free">+ Parada livre</button>
    </div>`;

  $('#trip-back').addEventListener('click', renderTrips);
  $('#trip-edit').addEventListener('click', async e => {
    e.preventDefault();
    const values = await modalForm({
      title: 'Editar roteiro',
      fields: [
        { name: 'title', label: 'Título', value: trip.title },
        { name: 'notes', label: 'Observações', type: 'textarea', value: trip.notes || '', required: false },
      ],
    });
    if (!values?.title) return;
    trip.title = values.title;
    trip.notes = values.notes || null;
    await saveTripLocalAndQueue(trip);
    renderTripDetail(uid);
  });
  $('#trip-add-free').addEventListener('click', async () => {
    const values = await modalForm({
      title: 'Parada livre',
      confirmText: 'Adicionar',
      fields: [{ name: 'label', label: 'Nome da parada', placeholder: 'Ex.: Mirante, almoço na praça…' }],
    });
    if (!values?.label) return;
    trip.items.push({ client_uid: CaparaoDB.uid(), label: values.label });
    await saveTripLocalAndQueue(trip);
    renderTripDetail(uid);
  });
  detail.querySelector('.trip-items').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const i = Number(btn.closest('.trip-item').dataset.i);
    const items = trip.items;
    if (btn.dataset.action === 'up' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
    if (btn.dataset.action === 'down' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
    if (btn.dataset.action === 'remove') items.splice(i, 1);
    if (btn.dataset.action === 'note') {
      const values = await modalForm({
        title: 'Anotação da parada',
        fields: [{ name: 'note', label: 'Dica ou lembrete', type: 'textarea', value: items[i].note || '', required: false }],
      });
      if (values === null) return;
      items[i].note = values.note || null;
    }
    await saveTripLocalAndQueue(trip);
    renderTripDetail(uid);
  });
}

$('#trips-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const uid = btn.closest('.trip-card').dataset.uid;
  if (btn.dataset.action === 'open') return renderTripDetail(uid);
  if (btn.dataset.action === 'delete') {
    const ok = await modalConfirm({
      title: 'Excluir roteiro',
      message: 'O roteiro e todas as suas paradas serão removidos. Essa ação não pode ser desfeita.',
      confirmText: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    await CaparaoDB.del('trips', uid);
    await CaparaoDB.enqueue({ method: 'DELETE', path: `/api/trips/${uid}` });
    renderTrips();
  }
});

// ─── Gerador de roteiro por IA ───────────────────────────────────────────────
$('#btn-ai-trip').addEventListener('click', () => {
  if (!navigator.onLine) return toast('Conecte-se para gerar um roteiro por IA');
  $('#ai-form').classList.toggle('hidden');
});
$('#ai-cancel').addEventListener('click', () => $('#ai-form').classList.add('hidden'));
$('#ai-interests').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) chip.classList.toggle('on');
});

$('#ai-form').addEventListener('submit', async e => {
  e.preventDefault();
  const interests = $$('#ai-interests .chip.on').map(c => c.dataset.v);
  const text = $('#ai-text').value.trim();
  if (!interests.length && !text) return toast('Selecione ao menos um gosto ou escreva o que quer viver');

  const btn = $('#ai-submit');
  btn.disabled = true;
  btn.textContent = 'Montando seu roteiro…';
  try {
    const trip = await api('/trips/generate', {
      method: 'POST',
      body: JSON.stringify({
        interests,
        duration: $('#ai-duration').value,
        pace: $('#ai-pace').value,
        text: text || null,
      }),
    });
    $('#ai-form').classList.add('hidden');
    toast('Roteiro montado pra você');
    await pullTripsFromServer();
    await renderTrips();
    renderTripDetail(trip.client_uid);
  } catch (err) {
    if (!err.unauthorized) toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Montar meu roteiro';
  }
});

async function createTripViaModal(defaultTitle = '') {
  const values = await modalForm({
    title: 'Novo roteiro',
    confirmText: 'Criar',
    fields: [{ name: 'title', label: 'Nome do roteiro', value: defaultTitle, placeholder: 'Ex.: Fim de semana no pico' }],
  });
  if (!values?.title) return null;
  const trip = { client_uid: CaparaoDB.uid(), title: values.title, notes: null, items: [] };
  await saveTripLocalAndQueue(trip);
  return trip;
}

$('#btn-new-trip').addEventListener('click', async () => {
  const trip = await createTripViaModal();
  if (!trip) return;
  toast(navigator.onLine ? 'Roteiro criado' : 'Roteiro criado offline — sincroniza depois');
  renderTrips();
});

async function addToTrip(itemBase, label) {
  const trips = (await CaparaoDB.all('trips')).sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  let trip;
  if (!trips.length) {
    trip = await createTripViaModal('Meu roteiro no Caparaó');
    if (!trip) return;
  } else if (trips.length === 1) {
    trip = trips[0];
  } else {
    const NEW = '__new__';
    const pick = await modalPick({
      title: `Adicionar “${label}” em qual roteiro?`,
      options: [
        ...trips.map(t => ({
          value: t.client_uid, label: t.title,
          sub: `${(t.items || []).length} parada${(t.items || []).length === 1 ? '' : 's'}`,
        })),
        { value: NEW, label: '+ Criar novo roteiro' },
      ],
    });
    if (!pick) return;
    trip = pick === NEW ? await createTripViaModal() : trips.find(t => t.client_uid === pick);
    if (!trip) return;
  }
  trip.items = trip.items || [];
  trip.items.push({ client_uid: CaparaoDB.uid(), ...itemBase });
  await saveTripLocalAndQueue(trip);
  toast(`Adicionado a “${trip.title}”${navigator.onLine ? '' : ' (offline)'}`);
}

// ─── Mensagens (chat assimétrico) ────────────────────────────────────────────
async function startConversation(producerId) {
  if (!producerId) return;
  if (!navigator.onLine) return toast('Conecte-se para iniciar uma nova conversa');
  try {
    const conv = await api('/conversations', { method: 'POST', body: JSON.stringify({ producer_id: producerId }) });
    switchView('chat');
    openThread(conv.id);
  } catch (err) { toast(err.message); }
}

async function loadConversations() {
  let convs = [];
  if (navigator.onLine) {
    try {
      ({ conversations: convs } = await api('/conversations'));
      await CaparaoDB.put('kv', 'conversations', convs);
    } catch { convs = (await CaparaoDB.get('kv', 'conversations')) || []; }
  } else {
    convs = (await CaparaoDB.get('kv', 'conversations')) || [];
  }
  const unread = convs.reduce((s, c) => s + Number(c.unread || 0), 0);
  const badge = $('#chat-badge');
  badge.classList.toggle('hidden', !unread);
  badge.textContent = unread || '';
  $('#conv-list').innerHTML = convs.map(c => `
    <div class="conv-row ${c.id === currentConvId ? 'active' : ''}" data-id="${c.id}">
      <div class="avatar md" style="background:${esc(c.producer_color || '#1C6B4A')}">${esc(c.producer_initials || '?')}</div>
      <div class="conv-info">
        <strong>${esc(c.producer_name)}</strong>
        <small>${esc((c.last_message || 'Sem mensagens').slice(0, 48))}</small>
      </div>
      ${Number(c.unread) ? `<span class="nav-badge">${c.unread}</span>` : ''}
    </div>`).join('') || '<p class="empty-note">Nenhuma conversa ainda.</p>';
}

async function fetchThreadMsgs(convId) {
  let msgs = [];
  if (navigator.onLine) {
    try {
      ({ messages: msgs } = await api(`/conversations/${convId}/messages`));
      await CaparaoDB.put('kv', `messages-${convId}`, msgs);
    } catch { msgs = (await CaparaoDB.get('kv', `messages-${convId}`)) || []; }
  } else {
    msgs = (await CaparaoDB.get('kv', `messages-${convId}`)) || [];
  }
  return msgs;
}

// Atualiza só as bolhas de mensagem (o campo de digitação fica intocado)
async function refreshThreadMsgs(convId) {
  const box = $('#thread-msgs');
  if (!box || convId !== currentConvId) return;
  const msgs = await fetchThreadMsgs(convId);
  const queued = (await CaparaoDB.get('kv', `queued-${convId}`)) || [];
  if (convId !== currentConvId) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML =
    msgs.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('') +
    queued.map(q => msgBubble(q.body, true, 'aguardando envio')).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function openThread(convId) {
  currentConvId = convId;
  $('.chat-layout')?.classList.add('thread-open'); // celular: mostra a conversa
  const msgs = await fetchThreadMsgs(convId);
  const queued = (await CaparaoDB.get('kv', `queued-${convId}`)) || [];
  $('#conv-thread').innerHTML = `
    <button type="button" class="thread-back" id="thread-back">‹ Conversas</button>
    <div class="thread-msgs" id="thread-msgs">
      ${msgs.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('')}
      ${queued.map(q => msgBubble(q.body, true, 'aguardando envio')).join('')}
    </div>
    <form class="thread-form" id="thread-form">
      <input id="thread-input" type="text" placeholder="Escreva sua mensagem…" autocomplete="off">
      <button type="submit" class="btn-primary">Enviar</button>
    </form>`;
  const box = $('#thread-msgs');
  box.scrollTop = box.scrollHeight;
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
    const clientUid = CaparaoDB.uid();
    const q = (await CaparaoDB.get('kv', `queued-${convId}`)) || [];
    q.push({ body, client_uid: clientUid });
    await CaparaoDB.put('kv', `queued-${convId}`, q);
    await CaparaoDB.enqueue({
      method: 'POST',
      path: `/api/conversations/${convId}/messages`,
      body: { body, client_uid: clientUid },
    });
    if (navigator.onLine) await clearQueuedIfSynced(convId);
    openThread(convId);
  });
  loadConversations();
}

// Remove da lista "aguardando envio" tudo que já subiu com a fila
async function clearQueuedIfSynced(convId) {
  if (await CaparaoDB.pendingCount() === 0) await CaparaoDB.del('kv', `queued-${convId}`);
}
window.addEventListener('online', async () => {
  await CaparaoDB.flush();
  if (currentConvId) { await clearQueuedIfSynced(currentConvId); openThread(currentConvId); }
});

$('#conv-list').addEventListener('click', e => {
  const row = e.target.closest('.conv-row');
  if (row) openThread(Number(row.dataset.id));
});

// Atualização periódica: novas mensagens e badge sem precisar recarregar
setInterval(() => {
  if (!navigator.onLine || !me) return;
  loadConversations().catch(() => {});
  if (currentConvId && !$('#view-chat').classList.contains('hidden')) {
    refreshThreadMsgs(currentConvId).catch(() => {});
  }
}, 15000);

// ─── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  me = await requireSession('tourist');
  if (!me) return;
  $('#brand-slot').outerHTML = brandHTML;
  $('#profile-name').textContent = me.name;
  renderAvatar($('#profile-initials'), me);
  $('#profile').addEventListener('click', () => openAccountMenu(me, m => {
    $('#profile-name').textContent = m.name;
    renderAvatar($('#profile-initials'), m);
  }));
  await CaparaoDB.flush();
  loadExplore();
  // Pré-aquece o cache offline dos roteiros e favoritos em segundo plano
  pullTripsFromServer();
  if (navigator.onLine) api('/favorites').then(async ({ favorites }) => {
    for (const f of favorites) await CaparaoDB.put('favorites', f.listing_id, f);
  }).catch(() => {});
})();
