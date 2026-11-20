/* UaF-Lernapp Service Worker – App-Shell + Fragenkatalog offline.
 * CACHE_VERSION wird von scripts/build.mjs mit App-Version und Inhalts-Hash ersetzt.
 * Der Lernstand liegt in IndexedDB und wird vom Service Worker NIE angefasst. */
const CACHE_VERSION = '1.1.0-e18175b468';
const CACHE_PREFIX = 'uaf-lernapp-';
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const RUNTIME = CACHE_PREFIX + 'runtime';

const PRECACHE = [
  './',
  'index.html',
  'app.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/app-state.js',
  'js/config.js',
  'js/srs.js',
  'js/session.js',
  'js/stats.js',
  'js/exam.js',
  'js/db.js',
  'js/migrations.js',
  'js/backup.js',
  'js/catalog-parser.js',
  'js/derive.js',
  'js/grading.js',
  'js/speech.js',
  'js/sync.js',
  'js/ui/dom.js',
  'js/ui/card.js',
  'js/ui/views-main.js',
  'js/ui/views-session.js',
  'data/catalog.json',
  'data/catalog-overrides.json',
  'data/vehicles.json',
  'data/signs.json',
  'data/forms2025.json',
  'assets/icons/icon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/signs/taktische-formation.svg',
  'assets/signs/befehlsstelle.svg',
  'assets/signs/stelle-einrichtung.svg',
  'assets/signs/person.svg',
  'assets/signs/massnahme.svg',
  'assets/forms/zeichen-zugfuehrer-ee-drk.svg',
  'assets/forms/verbindungswege.svg',
  'assets/forms/fuehrungskreislauf.svg',
];

self.addEventListener('install', event => {
  // Kein skipWaiting(): Updates werden erst nach Bestätigung in der App aktiv.
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: CACHE_VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('index.html');
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('Offline – App noch nicht im Cache.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(RUNTIME)).put(req, res.clone());
      return res;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
