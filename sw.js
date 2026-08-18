/* Babel service worker — offline app shell.
   Bump CACHE on every release so clients pull the new files. */
const CACHE = 'babel-v7';
const ASSETS = [
  'Babel.html',
  'index.html',
  'manifest.webmanifest',
  'icons/babel-192.png',
  'icons/babel-512.png',
  'icons/babel-maskable-512.png'
];

// addAll is all-or-nothing: one missing icon rejected the whole precache and
// left NOTHING cached, while activate had already deleted the previous cache —
// so the app simply would not open offline, silently. Cache each asset on its
// own, and treat only the app shell as required.
const REQUIRED = ['Babel.html', 'index.html'];
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(
      ASSETS.map((a) => c.add(a).then(() => null).catch(() => a))
    ).then((results) => {
      const failed = results.filter(Boolean);
      if (failed.length) console.error('[Babel SW] not cached:', failed.join(', '));
      const missing = failed.filter((f) => REQUIRED.indexOf(f) !== -1);
      // If the shell itself is missing there is no offline app; fail loudly
      // rather than activating a worker that serves a blank screen.
      if (missing.length) throw new Error('[Babel SW] app shell missing: ' + missing.join(', '));
    })).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Let the page trigger an immediate activation of a waiting worker.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  // Lets the page show which worker is actually serving it, so a stale build
  // is visible instead of being guessed at.
  if (e.data === 'VERSION' && e.ports && e.ports[0]) {
    caches.open(CACHE)
      .then((c) => c.keys())
      .then((k) => e.ports[0].postMessage({ cache: CACHE, entries: k.length }))
      .catch(() => e.ports[0].postMessage({ cache: CACHE, entries: -1 }));
  }
});

// Navigations: network-first (so a freshly hosted version shows up), fall back
// to cache when offline. Other assets: cache-first with background refresh.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Only handle same-origin requests — let cross-origin (Supabase, CDN) pass straight through.
  if (new URL(req.url).origin !== self.location.origin) return;
  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('Babel.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached || Response.error());
      return cached || net;
    })
  );
});
