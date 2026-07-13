/* Service worker — Caminhos do Caparaó Admin
 * Estratégia:
 *  - App shell (HTML/CSS/JS/ícones): cache-first com atualização em segundo plano
 *  - API GET (dashboard, listas, itinerários): network-first com fallback ao cache,
 *    garantindo que o painel e os itinerários funcionem offline com os últimos dados.
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
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

  // API: network-first, cache como fallback offline
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/health') return; // sempre rede
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

  // Google Fonts: cache-first (fica disponível offline após a primeira visita)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => cached))
    );
    return;
  }

  // App shell: cache-first com revalidação em segundo plano
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request.mode === 'navigate' ? '/index.html' : request).then(cached => {
        const network = fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache =>
              cache.put(request.mode === 'navigate' ? '/index.html' : request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
