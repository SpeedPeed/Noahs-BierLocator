'use strict';
// Service Worker: App-Hülle offline verfügbar machen.
// App-Dateien: zuerst Netzwerk (Updates kommen sofort an), offline aus dem Cache.
// Kartenkacheln, Schriften & Bibliotheken: Cache zuerst, im Hintergrund aktualisieren.
// Live-Daten (Overpass, Routing, Wetter, Supabase) werden nicht gecacht.
const VERSION = 'v3.2.0';
const SHELL_CACHE = `bierlocator-shell-${VERSION}`;
const RUNTIME_CACHE = 'bierlocator-runtime-v2';

const SHELL_FILES = [
  './', './index.html', './styles.css', './manifest.json',
  './js/main.js', './js/config.js', './js/util.js', './js/icons.js', './js/state.js', './js/store.js',
  './js/places.js', './js/placeInfo.js', './js/geo.js', './js/weather.js', './js/community.js',
  './js/openingHours.js', './js/prices.js', './js/bac.js', './js/legal.js', './js/share.js', './js/map.js',
  './js/tour/planner.js', './js/tour/routing.js', './js/tour/tourPlan.js',
  './js/ui/dom.js', './js/ui/sheet.js', './js/ui/finder.js', './js/ui/detail.js', './js/ui/tourUi.js',
  './js/ui/bacUi.js', './js/ui/autocomplete.js', './js/chainPrices.js', './data/chain-prices.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-192-maskable.png', './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

const CACHE_FIRST_HOSTS = ['tile.openstreetmap.org', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimRuntime() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length > 600) await Promise.all(keys.slice(0, keys.length - 500).map(k => cache.delete(k)));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  if (CACHE_FIRST_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache => cache.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); trimRuntime(); }
          return res;
        }).catch(() => cached);
        return cached || network;
      }))
    );
  }
  // alles andere (APIs): normal durchs Netz
});
