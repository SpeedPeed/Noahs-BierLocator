'use strict';
// Service Worker für Bier-Locator: cached die App-Hülle (HTML/CSS/JS/Icons) fürs
// Offline-Starten und "Zum Startbildschirm hinzufügen". Live-Daten (Overpass,
// Nominatim, OSRM, Wetter) werden bewusst NICHT aggressiv gecacht — die App
// braucht für Suche/Routing ohnehin eine Internetverbindung, hier geht es nur
// darum, dass die App selbst schnell und auch mal offline startet.
const SHELL_CACHE = 'bierlocator-shell-v1';
const RUNTIME_CACHE = 'bierlocator-runtime-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // Overpass-Anfragen sind POST — unangetastet durchlassen

  const isSameOrigin = new URL(req.url).origin === self.location.origin;

  if (isSameOrigin) {
    // App-Hülle: erst aus dem Cache (schnell, offline-fähig), im Hintergrund aktualisieren.
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  } else {
    // Externe Inhalte (Kartenkacheln, Fonts, Leaflet): erst Netzwerk, sonst letzten
    // bekannten Stand aus dem Cache — sinnvoll bei kurzzeitig schlechtem Empfang.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
