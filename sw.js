// TekPair Service Worker
const CACHE_VERSION = 'tekpair-v1';
const ASSETS = [
  '/',
  '/dashboard.html',
  '/app.html',
  '/tpv.html',
  '/parte.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

// Instalar: cachear assets básicos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: estrategia network-first para HTML, cache-first para resto
self.addEventListener('fetch', e => {
  // Solo manejar GET requests del mismo origen
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Nunca cachear llamadas a APIs externas (Supabase, etc.)
  if (url.hostname.includes('supabase') || url.pathname.includes('/api/')) return;

  // HTML: network first (para ver siempre lo último)
  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('/dashboard.html')))
    );
    return;
  }

  // Otros assets: cache first
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
