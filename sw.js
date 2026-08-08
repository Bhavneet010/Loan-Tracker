
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDY0AMy0eZI_74nJSoy46uHqgKvh9NkKw8",
  projectId: "loan-tracker-4af27",
  messagingSenderId: "700827916451",
  appId: "1:700827916451:web:d872bf2905d234bdb60716"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Received background message ', payload);
  const notificationTitle = payload.notification?.title || "Nirnay Update";
  const notificationOptions = {
    body: payload.notification?.body || "New activity detected.",
    icon: './icon-192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

const CACHE = 'nirnay-v203';
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
  './css/audit.css',
  './css/calendar.css',
  './css/core.css',
  './css/forms.css',
  './css/decision-sheet.css',
  './css/notifications.css',
  './css/renewals.css',
  './css/dark-mode.css',
  './css/neo-brutalist.css',
  './css/sketchnote.css',
  './css/snapshot-modal.css',
  './css/snapshot-report.css',
  './css/tasks.css',
  './css/officer-tasks.css',
  './js/animate.js',
  './js/app.js',
  './js/bank-holidays.js',
  './js/biometric.js',
  './js/config.js',
  './js/db.js',
  './js/derived.js',
  './js/fresh-group-state.js',
  './js/importers.js',
  './js/lazy-action.js',
  './js/lazy-actions.js',
  './js/loan-actions.js',
  './js/officer-availability.js',
  './js/ui-forms.js',
  './js/ui-decision-sheet.js',
  './js/ui-reminder-mail.js',
  './js/notifications.js',
  './js/officer-tasks.js',
  './js/push-notifications.js',
  './js/presence.js',
  './js/state.js',
  './js/ui-calendar.js',
  './js/ui-components.js',
  './js/ui-core.js',
  './js/ui-logic.js',
  './js/ui-render.js',
  './js/ui-settings.js',
  './js/ui-stats.js',
  './js/ui-tabs-loans.js',
  './js/ui-tabs-renewals.js',
  './js/ui-tasks.js',
  './js/utils.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('nirnay-v') && key !== CACHE)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis') || url.hostname.includes('gstatic')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && e.request.method === 'GET') {
        const clone = res.clone();
        return caches.open(CACHE)
          .then(c => c.put(e.request, clone))
          .then(() => res);
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
