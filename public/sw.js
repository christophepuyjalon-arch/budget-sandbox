// Budget — fonctionnement hors ligne : l'interface est mise en cache.
// Les données (/api/...) ne passent jamais par le cache du service worker :
// l'app garde elle-même la dernière version reçue.
const CACHE = 'budget-v27';
const COQUILLE = ['/', '/style.css', '/app.js', '/vendor/qrcode.js', '/vendor/chart.umd.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/callback') return;
  // En ligne d'abord (mises à jour immédiates), sinon la copie en cache.
  const cle = req.mode === 'navigate' ? '/' : req;
  e.respondWith(
    fetch(req).then((r) => {
      if (r.ok && req.mode !== 'navigate') { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(req, copie)); }
      return r;
    }).catch(() => caches.match(cle, { ignoreSearch: true }))
  );
});
