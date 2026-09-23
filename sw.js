// ============================================================
// sw.js — Service worker : fonctionnement hors ligne
// ------------------------------------------------------------
// À la première visite en ligne, tous les fichiers de l'application sont
// mis en cache. Ensuite l'app s'ouvre sans réseau (chantier, cave, sous-sol).
// Une nouvelle version (CACHE_NAME changé) remplace l'ancienne au rechargement
// suivant. Inerte quand la page est ouverte en file:// (pas de service worker).
// ============================================================
const CACHE_NAME = 'annoteur-v1.8.3';
const FILES = [
  './', './index.html', './app.js', './geometry.js', './migrate.js',
  './export-vector.js', './tools-metier.js', './symbols.js',
  './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/fabric.min.js',
  './vendor/jspdf.umd.min.js', './vendor/pdf-lib.min.js', './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord, réseau en secours : l'app doit démarrer vite et sans réseau.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});
