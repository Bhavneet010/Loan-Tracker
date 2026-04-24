const CACHE = 'nirnay-v17';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './assets/icons/ic_launcher_1024.png',
  './assets/icons/nirnay-icon-master.svg',
  './assets/splash/splash-dark.png',
  './assets/splash/splash-light.png',
  './assets/splash/splash-dark-master.svg',
  './assets/splash/splash-light-master.svg',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/derived.js',
  './js/importers.js',
  './js/loan-actions.js',
  './js/notifications.js',
  './js/performance.js',
  './js/state.js',
  './js/ui-components.js',
  './js/ui-core.js',
  './js/ui-logic.js',
  './js/ui-render.js',
  './js/ui-settings.js',
  './js/ui-stats.js',
  './js/ui-tabs-loans.js',
  './js/ui-tabs-renewals.js',
  './js/utils.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
