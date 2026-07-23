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
const VIEWS = { explore: loadExplore, trips: renderTrips, bookings: renderBookings, favorites: renderFavorites, chat: loadConversations };

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
let geoPos = null;  // posição do turista para o "Perto de mim"

// Pede a geolocalização uma vez e memoiza; resolve null se negada/indisponível.
function requestGeo() {
  return new Promise(resolve => {
    if (geoPos) return resolve(geoPos);
    if (!navigator.geolocation) { toast('Geolocalização indisponível neste aparelho'); return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      p => { geoPos = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(geoPos); },
      () => { toast('Não foi possível obter sua localização'); resolve(null); },
      { timeout: 8000, maximumAge: 300000 }
    );
  });
}

// Link de rota até o estabelecimento (abre o app de mapas do dispositivo)
const mapsLink = (lat, lng) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

// Ordenações do lado do cliente (usadas no modo offline, sobre o cache)
const SORT_FNS = {
  relevance: null, // mantém a ordem que veio (premium primeiro, recente)
  price_asc: (a, b) => (a.price_cents ?? Infinity) - (b.price_cents ?? Infinity),
  price_desc: (a, b) => (b.price_cents ?? -Infinity) - (a.price_cents ?? -Infinity),
  rating: (a, b) => (b.rating_avg ?? -1) - (a.rating_avg ?? -1) || (b.rating_count ?? 0) - (a.rating_count ?? 0),
};

async function loadExplore() {
  const seq = ++exploreSeq;
  const q = $('#explore-q').value.trim();
  const city = $('#explore-city')?.value || '';
  const sort = $('#explore-sort')?.value || 'relevance';
  // A barra de filtros só faz sentido nas abas de anúncios (não em mapa,
  // estabelecimentos ou roteiros prontos).
  const listingKind = !['places', 'map', 'itineraries'].includes(exploreKind);
  $('#explore-filters')?.classList.toggle('hidden', !listingKind);
  const isMap = exploreKind === 'map';
  $('#explore-grid').classList.toggle('hidden', isMap);
  $('#explore-map').classList.toggle('hidden', !isMap);
  if (isMap) return renderMap(q);
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
        const params = new URLSearchParams({ q, sort });
        if (exploreKind) params.set('type', exploreKind);
        if (city) params.set('city', city);
        if (sort === 'distance' && geoPos) params.set('near', `${geoPos.lat},${geoPos.lng}`);
        ({ listings } = await api(`/explore/listings?${params}`));
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
        .filter(l => !city || norm(l.city) === norm(city))
        .filter(l => !q || norm(l.title).includes(norm(q)) || norm(l.subtitle).includes(norm(q)) || norm(l.producer_name).includes(norm(q)));
      if (SORT_FNS[sort]) listings = listings.slice().sort(SORT_FNS[sort]);
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
  <div class="ex-card ${l.plan === 'premium' ? 'plan-featured' : ''}" data-id="${l.id}" data-producer="${l.producer_id}">
    ${thumbHTML(l, 'ex-thumb')}
    <div class="ex-body">
      <span class="ex-type">${TYPE_LABEL[l.type] || ''} · ${esc(l.city || 'Caparaó')} ${verifiedBadge(l.verified)}${planBadge(l.plan)}</span>
      <strong class="ex-title">${esc(l.title)}</strong>
      <span class="ex-sub">${esc(l.subtitle || '')}</span>
      ${l.rating_count ? `<span class="ex-rating">${starsHTML(l.rating_avg, l.rating_count)}</span>` : ''}
      <span class="ex-price">${esc(fmtPrice(l.price_cents, l.price_unit))}${l.stock != null && l.stock <= 5 ? ` · <span class="stock-low">restam ${l.stock}</span>` : ''}</span>
      ${l.type === 'event' && l.event_date
        ? `<span class="ex-meta">${esc(fmtEventDate(l.event_date))}${l.event_time ? ` · ${esc(l.event_time)}` : ''}${l.event_place ? ` · ${esc(l.event_place)}` : ''}</span>`
        : ''}
      <div class="ex-producer">
        <div class="avatar sm" style="background:${esc(l.producer_color || '#1C6B4A')}">${esc(l.producer_initials || '')}</div>
        <span>${esc(l.producer_name)}</span>
      </div>
    </div>
    <div class="ex-actions">
      <button class="btn-fav ${favIds.has(l.id) ? 'on' : ''}" data-action="fav" aria-label="Favoritar" aria-pressed="${favIds.has(l.id)}" title="Favoritar"><span aria-hidden="true">♥</span></button>
      <button class="btn-secondary" data-action="add-trip">+ Roteiro</button>
      <button class="btn-primary" data-action="chat">Conversar</button>
    </div>
  </div>`;

const placeCard = e => `
  <div class="ex-card ${e.plan === 'premium' ? 'plan-featured' : ''}" data-producer="${e.producer_id}">
    ${e.photo_path
      ? `<div class="ex-thumb has-photo"><img src="${esc(thumbURL(e.photo_path))}" data-full="${esc(e.photo_path)}" alt="" loading="lazy"></div>`
      : coverHTML({ producer_name: e.name }, 'ex-thumb')}
    <div class="ex-body">
      <span class="ex-type">${esc(e.category || 'Estabelecimento')} · ${esc(e.city || 'Caparaó')} ${verifiedBadge(e.verified)}${planBadge(e.plan)}</span>
      <strong class="ex-title">${esc(e.name)}</strong>
      ${e.rating_count ? `<span class="ex-rating">${starsHTML(e.rating_avg, e.rating_count)}</span>` : ''}
      <span class="ex-sub">${esc(e.description || e.kind || '')}</span>
      <span class="ex-meta">${esc(e.address || '')}${e.open_hours ? ' · ' + esc(e.open_hours) : ''}${e.phone ? ' · ' + esc(e.phone) : ''}</span>
      ${e.lat != null && e.lng != null
        ? `<a class="ex-meta directions-link" href="${mapsLink(e.lat, e.lng)}" target="_blank" rel="noopener">Como chegar ➚</a>` : ''}
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
    ${coverHTML({ producer_name: it.title }, 'ex-thumb')}
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

// ─── Mapa da região (Leaflet + OpenStreetMap) ───────────────────────────────
let map = null;
let mapMarkers = [];

async function renderMap(q) {
  if (!navigator.onLine) {
    $('#explore-map').innerHTML = '<p class="empty-note map-offline">O mapa precisa de conexão — os tiles vêm do OpenStreetMap.</p>';
    map = null;
    return;
  }
  if (!map) {
    $('#explore-map').innerHTML = '';
    map = L.map('explore-map').setView([-20.47, -41.79], 11); // região do Caparaó
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }
  map.invalidateSize(); // o contêiner pode ter acabado de sair de display:none
  let places = [];
  try { ({ establishments: places } = await api(`/explore/establishments?q=${encodeURIComponent(q)}&limit=60`)); }
  catch { return; }
  mapMarkers.forEach(m => m.remove());
  mapMarkers = places.filter(e => e.lat != null && e.lng != null).map(e =>
    L.marker([e.lat, e.lng]).addTo(map).bindPopup(`
      <strong>${esc(e.name)}</strong><br>
      <small>${esc(e.category || '')}${e.city ? ` · ${esc(e.city)}` : ''}</small><br>
      ${e.open_hours ? `<small>${esc(e.open_hours)}</small><br>` : ''}
      <a href="${mapsLink(e.lat, e.lng)}" target="_blank" rel="noopener">Como chegar ➚</a>`));
  if (mapMarkers.length) map.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.2));
}

$('#explore-q').addEventListener('input', () => { clearTimeout(window._qT); window._qT = setTimeout(loadExplore, 300); });
$('#explore-chips').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  exploreKind = tab.dataset.kind;
  $$('#explore-chips .tab').forEach(t => t.classList.toggle('active', t === tab));
  loadExplore();
});
$('#explore-city').addEventListener('change', loadExplore);
$('#explore-sort').addEventListener('change', async () => {
  // "Perto de mim" precisa da localização; sem permissão, volta a Relevância.
  if ($('#explore-sort').value === 'distance' && !geoPos) {
    if (!(await requestGeo())) { $('#explore-sort').value = 'relevance'; return; }
  }
  loadExplore();
});

// Preenche o filtro de cidade (online busca a lista; offline usa o cache)
async function loadCities() {
  let cities = [];
  if (navigator.onLine) {
    try { ({ cities } = await api('/explore/cities')); await CaparaoDB.put('kv', 'explore-cities', cities); }
    catch { /* usa o cache abaixo */ }
  }
  if (!cities.length) cities = (await CaparaoDB.get('kv', 'explore-cities')) || [];
  const sel = $('#explore-city');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas as cidades</option>'
    + cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = current; // preserva a seleção ao repovoar
}
loadCities();

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
  // Galeria: várias fotos quando disponíveis (offline cai para a capa em cache)
  const gallery = l.images?.length ? l.images : (l.image_path ? [l.image_path] : []);
  const hero = gallery.length ? carouselHTML(gallery, 'detail-hero') : coverHTML(l, 'detail-hero');
  const partnerLines = [
    l.est_description || l.producer_kind,
    l.address ? `${l.address}${l.city ? ` — ${l.city}` : ''}` : (l.city ? l.city : null),
    l.open_hours ? `Aberto: ${l.open_hours}` : null,
    l.phone ? `Contato: ${l.phone}` : null,
  ].filter(Boolean);

  const eventLine = l.type === 'event' && l.event_date
    ? `<p class="detail-event">${esc(fmtEventDate(l.event_date))}${l.event_time ? ` · ${esc(l.event_time)}` : ''}${l.event_place ? ` · ${esc(l.event_place)}` : ''}</p>`
    : '';
  const canBook = navigator.onLine;
  const { overlay, close } = openModal(`
    <div class="detail-modal-inner">
      ${hero}
      <div class="detail-body">
        <span class="ex-type">${TYPE_LABEL[l.type] || ''} · ${esc(l.city || 'Caparaó')}</span>
        <h3>${esc(l.title)}</h3>
        ${l.rating_count ? `<p class="ex-rating detail-rating">${starsHTML(l.rating_avg, l.rating_count)}</p>` : ''}
        ${l.subtitle ? `<p class="detail-sub">${esc(l.subtitle)}</p>` : ''}
        <p class="ex-price detail-price">${esc(fmtPrice(l.price_cents, l.price_unit))}${l.stock != null ? ` · <span class="stock-low">${l.stock} disponíve${l.stock === 1 ? 'l' : 'is'}</span>` : ''}</p>
        ${eventLine}
        <div class="detail-partner">
          <div class="avatar lg" style="background:${esc(l.producer_color || '#1C6B4A')}">${esc(l.producer_initials || '')}</div>
          <div class="detail-partner-info">
            <strong>${esc(l.est_name || l.producer_name)} ${verifiedBadge(l.verified)}${planBadge(l.plan)}</strong>
            ${partnerLines.map(line => `<small>${esc(line)}</small>`).join('')}
            ${l.lat != null && l.lng != null
              ? `<a class="directions-link" href="${mapsLink(l.lat, l.lng)}" target="_blank" rel="noopener">Como chegar ➚</a>` : ''}
          </div>
        </div>
        <div class="ex-actions">
          <button class="btn-fav ${isFav ? 'on' : ''}" data-detail="fav" aria-label="Favoritar" aria-pressed="${isFav}" title="Favoritar"><span aria-hidden="true">♥</span></button>
          <button class="btn-secondary" data-detail="share" aria-label="Compartilhar" title="Compartilhar">${icon('share')}</button>
          <button class="btn-secondary" data-detail="add-trip">+ Roteiro</button>
          <button class="btn-secondary" data-detail="chat">Conversar</button>
          ${canBook ? '<button class="btn-primary" data-detail="book">Reservar</button>' : ''}
        </div>
        ${l.reviews?.length ? `
          <h4 class="detail-section">Avaliações de turistas</h4>
          <div class="review-list">
            ${l.reviews.map(r => `
              <div class="review-row">
                <div class="review-head">
                  <strong>${esc(r.tourist_name)}</strong>
                  <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
                  <small>${fmtDate(r.created_at)}</small>
                </div>
                ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
                ${r.reply ? `<div class="review-reply">
                  <strong>Resposta do parceiro</strong>
                  <p>${esc(r.reply)}</p>
                </div>` : ''}
              </div>`).join('')}
          </div>` : ''}
        <p class="report-line"><button type="button" class="report-link" data-detail="report">Denunciar anúncio</button></p>
      </div>
    </div>`);
  overlay.querySelector('.modal').classList.add('detail-modal');
  // Carrossel da galeria com setas, dots, swipe e abertura em tela cheia
  wireCarousel(overlay, gallery);
  overlay.querySelector('[data-detail=report]').addEventListener('click', () => reportListing(l));
  overlay.querySelector('[data-detail=fav]').addEventListener('click', e =>
    toggleFavorite(l.id, e.currentTarget).then(loadExplore));
  overlay.querySelector('[data-detail=share]').addEventListener('click', async () => {
    const url = `${location.origin}/p/${l.id}`;
    if (navigator.share) return navigator.share({ title: l.title, url }).catch(() => {});
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast(url); }
  });
  overlay.querySelector('[data-detail=add-trip]').addEventListener('click', () => {
    close();
    addToTrip({ listing_id: l.id }, l.title);
  });
  overlay.querySelector('[data-detail=chat]').addEventListener('click', () => {
    close();
    startConversation(l.producer_id);
  });
  overlay.querySelector('[data-detail=book]')?.addEventListener('click', () => {
    close();
    openBookingForm(l);
  });
}

// ─── Denúncia de anúncio ─────────────────────────────────────────────────────
const REPORT_LABELS = {
  spam: 'Spam ou golpe',
  inapropriado: 'Conteúdo inapropriado',
  enganoso: 'Informação enganosa',
  fora_regiao: 'Não é do Caparaó',
  outro: 'Outro motivo',
};
function reportListing(l) {
  if (!navigator.onLine) return toast('Conecte-se para denunciar um anúncio');
  const { overlay, close } = openModal(`
    <h3>Denunciar anúncio</h3>
    <p class="modal-msg">Conte à equipe o que há de errado com “${esc(l.title)}”. Sua denúncia não é mostrada ao produtor.</p>
    <form class="modal-form" id="report-form">
      <div class="field">
        <label for="report-reason">Motivo</label>
        <select id="report-reason">
          ${Object.entries(REPORT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="report-detail">Detalhes (opcional)</label>
        <textarea id="report-detail" rows="3" placeholder="Descreva o problema"></textarea>
      </div>
      <div class="row-actions modal-actions">
        <button type="submit" class="btn-primary">Enviar denúncia</button>
        <button type="button" class="btn-secondary" data-modal-cancel>Cancelar</button>
      </div>
    </form>`);
  overlay.querySelector('#report-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api(`/reports/${l.id}`, { method: 'POST', body: JSON.stringify({
        reason: overlay.querySelector('#report-reason').value,
        detail: overlay.querySelector('#report-detail').value,
      }) });
      close();
      toast(r.already ? 'Você já havia denunciado este anúncio' : 'Denúncia enviada — obrigado por avisar');
    } catch (err) { toast(err.message); }
  });
}

// ─── Reservas ────────────────────────────────────────────────────────────────
async function openBookingForm(l) {
  const qtyLabel = l.stock != null ? `Quantidade (máx. ${l.stock})` : 'Quantidade';
  const values = await modalForm({
    title: `Reservar: ${l.title}`,
    confirmText: 'Enviar pedido',
    fields: [
      { name: 'qty', label: qtyLabel, type: 'number', value: '1' },
      { name: 'requested_date', label: 'Data desejada (opcional)', type: 'date', required: false },
      { name: 'note', label: 'Observação (opcional)', type: 'textarea', required: false,
        placeholder: 'Ex.: chegamos na sexta à noite, tem opção vegetariana?' },
    ],
  });
  if (!values) return;
  try {
    await api('/bookings', {
      method: 'POST',
      body: JSON.stringify({
        listing_id: l.id,
        qty: Number(values.qty) || 1,
        requested_date: values.requested_date || null,
        note: values.note || null,
        client_uid: crypto.randomUUID?.() || String(Date.now()),
      }),
    });
    toast('Pedido enviado ao produtor — acompanhe em Reservas');
  } catch (err) { toast(err.message); }
}

let lastBookings = [];

const bookingRow = b => `
    <div class="bk-row" data-id="${b.id}">
      ${thumbHTML(b, 'bk-thumb')}
      <div class="bk-info">
        <strong>${b.qty} × ${esc(b.title)}</strong>
        <small>${esc(b.producer_name)} · pedido em ${fmtDate(b.created_at)}${b.requested_date ? ` · para ${fmtDate(b.requested_date)}` : ''}</small>
        ${b.note ? `<small>Obs.: ${esc(b.note)}</small>` : ''}
        <small>${esc(fmtPrice(b.price_cents, b.price_unit))}${b.price_cents ? ` — total ${esc(fmtPrice(b.price_cents * b.qty))}` : ''}</small>
      </div>
      <span class="status-pill ${BOOKING_PILL[b.status]}">${esc(b.status_label)}</span>
      ${b.status === 'pending' ? '<button class="btn-secondary" data-bk-cancel>Cancelar</button>' : ''}
      ${b.status === 'completed' ? (b.my_rating
        ? `<button class="btn-secondary" data-bk-review>Sua nota: <span class="stars">${'★'.repeat(b.my_rating)}</span></button>`
        : '<button class="btn-primary" data-bk-review>Avaliar</button>') : ''}
    </div>`;

async function renderBookings() {
  let data;
  try { data = await api('/bookings'); }
  catch (err) {
    if (err.unauthorized) return;
    $('#bookings-list').innerHTML = '<p class="empty-note">Reservas indisponíveis offline — conecte-se para ver seus pedidos.</p>';
    return;
  }
  lastBookings = data.bookings;
  $('#bookings-list').innerHTML = data.bookings.map(bookingRow).join('')
    + (data.hasMore ? `<button class="btn-secondary load-more" data-bk-more="${data.oldestId}">Carregar mais</button>` : '')
    || '<p class="empty-note">Nenhuma reserva ainda — abra um anúncio no Explorar e toque em "Reservar".</p>';
}

// Formulário de avaliação (estrelas + comentário); editar reaproveita a nota
function openReviewForm(b) {
  let rating = b.my_rating || 0;
  const { overlay, close } = openModal(`
    <h3>Avaliar: ${esc(b.title)}</h3>
    <p class="modal-msg">Como foi sua experiência com ${esc(b.producer_name)}?</p>
    <div class="star-pick">
      ${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}">★</button>`).join('')}
    </div>
    <form class="modal-form" id="review-form">
      <div class="field">
        <label>Comentário (opcional)</label>
        <textarea name="comment" rows="3" placeholder="Conte como foi — ajuda outros turistas a escolher">${esc(b.my_comment || '')}</textarea>
      </div>
      <div class="row-actions modal-actions">
        <button type="submit" class="btn-primary">${b.my_rating ? 'Atualizar avaliação' : 'Enviar avaliação'}</button>
        <button type="button" class="btn-secondary" data-modal-cancel>Cancelar</button>
      </div>
    </form>`);
  const paint = () => overlay.querySelectorAll('[data-star]').forEach(s =>
    s.classList.toggle('on', Number(s.dataset.star) <= rating));
  paint();
  overlay.querySelectorAll('[data-star]').forEach(s => s.addEventListener('click', () => {
    rating = Number(s.dataset.star);
    paint();
  }));
  overlay.querySelector('#review-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!rating) return toast('Escolha de 1 a 5 estrelas');
    try {
      await api('/reviews', {
        method: 'POST',
        body: JSON.stringify({ booking_id: b.id, rating, comment: e.target.elements.comment.value.trim() || null }),
      });
      close();
      toast('Avaliação enviada — obrigado!');
      renderBookings();
    } catch (err) { toast(err.message); }
  });
}

$('#bookings-list').addEventListener('click', async e => {
  const moreBtn = e.target.closest('[data-bk-more]');
  if (moreBtn) {
    moreBtn.disabled = true;
    try {
      const data = await api(`/bookings?before=${moreBtn.dataset.bkMore}`);
      lastBookings = lastBookings.concat(data.bookings);
      moreBtn.insertAdjacentHTML('beforebegin', data.bookings.map(bookingRow).join(''));
      if (data.hasMore) moreBtn.dataset.bkMore = data.oldestId;
      else moreBtn.remove();
    } catch (err) { toast(err.message); moreBtn.disabled = false; }
    return;
  }
  const reviewBtn = e.target.closest('[data-bk-review]');
  if (reviewBtn) {
    const id = Number(reviewBtn.closest('.bk-row').dataset.id);
    const b = lastBookings.find(x => x.id === id);
    if (b) openReviewForm(b);
    return;
  }
  const btn = e.target.closest('[data-bk-cancel]');
  if (!btn) return;
  const id = btn.closest('.bk-row').dataset.id;
  if (!await modalConfirm({ title: 'Cancelar reserva', confirmText: 'Cancelar reserva', danger: true })) return;
  try {
    await api(`/bookings/${id}/cancel`, { method: 'POST' });
    toast('Reserva cancelada');
    renderBookings();
  } catch (err) { toast(err.message); }
});

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
    btn?.setAttribute('aria-pressed', 'false');
    await CaparaoDB.enqueue({ method: 'DELETE', path: `/api/favorites/${listingId}` });
    toast('Removido dos favoritos');
  } else {
    const snapshot = (await CaparaoDB.get('listings', listingId)) || { id: listingId };
    await CaparaoDB.put('favorites', listingId, { listing_id: listingId, ...snapshot });
    btn?.classList.add('on');
    btn?.setAttribute('aria-pressed', 'true');
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
        <button class="btn-reject" data-action="delete" aria-label="Excluir" title="Excluir">${icon('close')}</button>
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
              <button class="btn-view" data-action="note" aria-label="Anotação" title="Anotação">${icon('edit')}</button>
              <button class="btn-reject" data-action="remove" aria-label="Remover" title="Remover">${icon('close')}</button>
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
  let convs = [], unreadTotal = null;
  if (navigator.onLine) {
    try {
      ({ conversations: convs, unreadTotal } = await api('/conversations'));
      await CaparaoDB.put('kv', 'conversations', convs);
    } catch { convs = (await CaparaoDB.get('kv', 'conversations')) || []; }
  } else {
    convs = (await CaparaoDB.get('kv', 'conversations')) || [];
  }
  // unreadTotal cobre todas as conversas mesmo com a lista paginada
  const unread = unreadTotal ?? convs.reduce((s, c) => s + Number(c.unread || 0), 0);
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

// Estado de paginação do histórico da conversa aberta
let threadHasMore = false, threadOldestId = null;

async function fetchThreadMsgs(convId) {
  let msgs = [];
  if (navigator.onLine) {
    try {
      const data = await api(`/conversations/${convId}/messages`);
      msgs = data.messages;
      threadHasMore = data.hasMore;
      threadOldestId = data.oldestId;
      await CaparaoDB.put('kv', `messages-${convId}`, msgs);
    } catch { msgs = (await CaparaoDB.get('kv', `messages-${convId}`)) || []; threadHasMore = false; }
  } else {
    msgs = (await CaparaoDB.get('kv', `messages-${convId}`)) || [];
    threadHasMore = false;
  }
  return msgs;
}

const olderBtnHTML = () => threadHasMore
  ? `<button type="button" class="btn-secondary load-more" id="thread-older" data-before="${threadOldestId}">Carregar mensagens anteriores</button>`
  : '';

// Atualiza só as bolhas de mensagem (o campo de digitação fica intocado)
async function refreshThreadMsgs(convId) {
  const box = $('#thread-msgs');
  if (!box || convId !== currentConvId) return;
  const msgs = await fetchThreadMsgs(convId);
  const queued = (await CaparaoDB.get('kv', `queued-${convId}`)) || [];
  if (convId !== currentConvId) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = olderBtnHTML() +
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
      ${olderBtnHTML()}
      ${msgs.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join('')}
      ${queued.map(q => msgBubble(q.body, true, 'aguardando envio')).join('')}
    </div>
    <form class="thread-form" id="thread-form">
      <input id="thread-input" type="text" placeholder="Escreva sua mensagem…" autocomplete="off">
      <button type="submit" class="btn-primary">Enviar</button>
    </form>`;
  const box = $('#thread-msgs');
  box.scrollTop = box.scrollHeight;
  box.addEventListener('click', async e => {
    const older = e.target.closest('#thread-older');
    if (!older) return;
    older.disabled = true;
    try {
      const data = await api(`/conversations/${convId}/messages?before=${older.dataset.before}`);
      threadHasMore = data.hasMore;
      threadOldestId = data.oldestId;
      const prevH = box.scrollHeight;
      older.remove();
      box.insertAdjacentHTML('afterbegin',
        olderBtnHTML() + data.messages.map(m => msgBubble(m.body, m.sender_id === me.id, fmtTime(m.created_at))).join(''));
      box.scrollTop = box.scrollHeight - prevH; // mantém a posição de leitura
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
    const { title, status_label } = JSON.parse(e.data);
    if (status_label) toast(`Reserva ${status_label.toLowerCase()}: ${title}`);
    if (!$('#view-bookings').classList.contains('hidden')) renderBookings();
  });
  // EventSource reconecta sozinho; nada a fazer no erro
}

// Rede de segurança: sincronização periódica caso o stream caia
setInterval(() => {
  if (!navigator.onLine || !me) return;
  loadConversations().catch(() => {});
  if (currentConvId && !$('#view-chat').classList.contains('hidden')) {
    refreshThreadMsgs(currentConvId).catch(() => {});
  }
}, 60000);

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
  connectEvents();
  // Pré-aquece o cache offline dos roteiros e favoritos em segundo plano
  pullTripsFromServer();
  if (navigator.onLine) api('/favorites').then(async ({ favorites }) => {
    for (const f of favorites) await CaparaoDB.put('favorites', f.listing_id, f);
  }).catch(() => {});
})();
