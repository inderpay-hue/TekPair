// TekPair Service Worker
const CACHE_VERSION = 'tekpair-v202606192600';
const ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.hostname.includes('supabase') || url.pathname.includes('/api/')) return;

  if (e.request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request)
          .then(r => r || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Código (JS/CSS/lang): NETWORK-FIRST. Online siempre se baja la última versión; la caché
  // es solo fallback offline. Antes era stale-while-revalidate, que servía SIEMPRE la copia
  // cacheada primero → un fix desplegado tardaba (o no llegaba, si un SW viejo había cacheado
  // ignorando el ?v=). Con network-first un deploy llega en la siguiente recarga, sin depender
  // del ?v= ni de bumpear CACHE_VERSION.
  const esCodigo = /\.(js|css|mjs)$/.test(url.pathname) || url.pathname.startsWith('/lang/');
  if (esCodigo) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Resto de estáticos (iconos, imágenes, manifest): cache-first.
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/offline.html')))
  );
});

// Badge: recibir mensaje del dashboard para actualizar el badge del icono
self.addEventListener('message', e => {
  if (e.data?.type === 'SET_BADGE') {
    if (navigator.setAppBadge) {
      e.data.count > 0
        ? navigator.setAppBadge(e.data.count)
        : navigator.clearAppBadge();
    }
  }
});
