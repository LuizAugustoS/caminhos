/* Service worker — Caminhos do Caparaó PWA
 * Estratégia:
 *  - App shell (páginas, CSS/JS, ícones): cache-first com atualização em 2º plano
 *  - API GET (exploração, roteiros, conversas…): network-first com fallback ao
 *    cache — o app continua utilizável offline com os últimos dados.
 *  - Mutações offline NÃO passam por aqui: ficam na fila do IndexedDB (js/idb.js)
 *    e são reenviadas quando a conexão volta, com rotas idempotentes no servidor.
 */
const VERSION = 'v19';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/app',
  '/portal',
  '/admin',
  '/styles.css',
  '/admin.js',
  '/js/shared.js',
  '/js/landing.js',
  '/js/idb.js',
  '/js/tourist.js',
  '/js/producer.js',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/favicon-32.png',
  '/icons/apple-touch-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fotos dos anúncios: cache-first (nome de arquivo é imutável)
  if (url.origin === location.origin && url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(DATA_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }))
    );
    return;
  }

  // API: network-first, cache como fallback offline
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/health' || url.pathname === '/api/events') return; // sempre rede (SSE nunca é cacheado)
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached =>
          cached || new Response(JSON.stringify({ error: 'offline' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          })
        ))
    );
    return;
  }

  // Google Fonts: cache-first com timeout — uma fonte lenta ou bloqueada nunca
  // pode travar o parser (folha de estilo pendente bloqueia os scripts da página).
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    const fallback = new Response('/* fonte indisponível */', {
      status: 200, headers: { 'Content-Type': 'text/css' },
    });
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return Promise.race([
          fetch(request).then(response => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
            }
            return response;
          }),
          new Promise(resolve => setTimeout(() => resolve(fallback), 4000)),
        ]).catch(() => fallback);
      })
    );
    return;
  }

  // App shell: NETWORK-FIRST. HTML/CSS/JS não têm hash no nome, então
  // cache-first deixaria o usuário sempre uma versão atrás. Online busca
  // sempre a versão mais recente; offline cai no cache.
  // Navegações são cacheadas pela URL da página (/, /app, /portal, /admin).
  if (url.origin === location.origin) {
    const key = request.mode === 'navigate' ? url.pathname : request;
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(key, copy));
        }
        return response;
      }).catch(() => caches.match(key).then(cached => cached || new Response('offline', { status: 503 })))
    );
  }
});

// ─── Web Push: avisos de mensagens e reservas com o app fechado ─────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { return; }
  event.waitUntil((async () => {
    // Com uma janela do app focada, o SSE já avisa em tela — sem duplicar
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(w => w.focused)) return;
    await self.registration.showNotification(data.title || 'Caminhos do Caparaó', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,     // mesma conversa/reserva substitui a anterior
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).pathname === url) || wins[0];
    if (win) {
      if (new URL(win.url).pathname !== url) await win.navigate(url).catch(() => {});
      return win.focus();
    }
    return clients.openWindow(url);
  })());
});
