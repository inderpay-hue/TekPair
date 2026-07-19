// TekPair Service Worker
const CACHE_VERSION = 'tekpair-v20260719a';
const ASSETS = [
  '/offline.html',
  '/dashboard.html',
  '/app.html',
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

// fetch con timeout (AbortController) — evita que un fetch colgado dispare el modo offline en Safari/WebKit.
function fetchTimeout(req, ms, init) {
  return new Promise(function(resolve, reject) {
    var ctrl = new AbortController();
    var to = setTimeout(function(){ ctrl.abort(); }, ms);
    fetch(req, Object.assign({}, init || {}, { signal: ctrl.signal }))
      .then(function(r){ clearTimeout(to); resolve(r); }, function(err){ clearTimeout(to); reject(err); });
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.hostname.includes('supabase') || url.pathname.includes('/api/')) return;

  // Navegaciones / HTML: NETWORK-FIRST robusto y Safari-friendly. Nunca cae a offline
  // mientras haya una copia cacheada (de cualquier versión). offline.html = último recurso REAL.
  const esNav = e.request.mode === 'navigate' || (e.request.headers.get('accept') || '').includes('text/html');
  if (esNav) {
    e.respondWith((async () => {
      // 1) Red con timeout
      try {
        const res = await fetchTimeout(e.request, 7000);
        if (res && (res.ok || res.type === 'opaqueredirect')) {
          try { const c = await caches.open(CACHE_VERSION); c.put(e.request, res.clone()); } catch (_) {}
          return res;
        }
        // Respuesta no-ok (p.ej. 5xx transitorio durante un deploy): preferir caché si la hay.
        const cachedNok = await caches.match(e.request);
        return cachedNok || res;
      } catch (err) {
        // 2) Reintento único: WebKit a veces aborta el primer fetch justo al activar un SW nuevo.
        try {
          const res2 = await fetch(e.request, { cache: 'no-store' });
          if (res2 && res2.ok) { try { const c = await caches.open(CACHE_VERSION); c.put(e.request, res2.clone()); } catch (_) {} return res2; }
        } catch (_) {}
        // 3) Fallback: caché de esta URL (cualquier versión) → dashboard precacheado → offline.
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (/dashboard/.test(url.pathname)) { const home = await caches.match('/dashboard.html'); if (home) return home; }
        return (await caches.match('/offline.html')) || Response.error();
      }
    })());
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
