// Offline support for Baseball.
// Online: every request goes to the network first, exactly as without this file,
// and a copy is kept. Offline (or a connection stalled > 5 s): the kept copy is used.
// Only touches /baseball/ and the two Google Fonts hosts; other games on
// twitchdodge.github.io are left alone.
const CACHE = 'baseball-offline-v1';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Archivo+Black&display=swap';
const CORE = ['./', './index.html', './site.webmanifest', './favicon.ico',
  './icon-16.png', './icon-32.png', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './apple-touch-icon.png'];
const SCOPE_PATH = new URL('./', self.location).pathname;   // "/baseball/"
const WAIT_MS = 5000;

async function keep(cache, key, res) {
  try { if (res && (res.ok || res.type === 'opaque')) await cache.put(key, res); } catch (_) {}
}

async function cacheFonts(cache) {
  try {
    const r = await fetch(FONT_CSS);
    if (!r.ok) return;
    const css = await r.clone().text();
    await keep(cache, FONT_CSS, r);
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)'"]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => fetch(u).then(fr => keep(cache, u, fr)).catch(() => {})));
  } catch (_) {}
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(u =>
      fetch(new Request(u, { cache: 'reload' })).then(r => keep(cache, u, r)).catch(() => {})));
    await cacheFonts(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('baseball-offline-') && n !== CACHE)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function fromCache(cache, req) {
  if (req.mode === 'navigate') {
    return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ||
           (await cache.match('./index.html')) || (await cache.match('./'));
  }
  return cache.match(req, { ignoreVary: true });
}

async function networkFirst(e) {
  const req = e.request;
  const cache = await caches.open(CACHE);
  const net = fetch(req).then(res => {
    e.waitUntil(keep(cache, req, res.clone()));
    return res;
  });
  const saved = await fromCache(cache, req);
  if (!saved) return net;                       // nothing kept yet: behave as if no service worker
  return Promise.race([
    net.catch(() => saved),
    new Promise(ok => setTimeout(() => ok(saved), WAIT_MS)),
  ]);
}

async function cacheFirst(e) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(e.request, { ignoreVary: true });
  if (saved) return saved;
  const res = await fetch(e.request);
  e.waitUntil(keep(cache, e.request, res.clone()));
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(e)); return; }
  if (url.hostname === 'fonts.googleapis.com' ||
      (url.origin === self.location.origin && url.pathname.startsWith(SCOPE_PATH))) {
    e.respondWith(networkFirst(e));
  }
});
