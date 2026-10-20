// Network-first service worker for the app shell only.
// Phones always get the newest files when online; the cached copy is only
// used when there is no connection, so updates never need a version bump.
const CACHE = 'hsf-shell-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'api.js', 'config.js', 'mock.js', 'ui.js', 'util.js',
  'views/signin.js', 'views/book.js', 'views/bookings.js', 'views/owner.js', 'views/account.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg',
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return; // API calls are POST: never intercepted
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API (script.google.com / googleusercontent.com), fonts: pass through
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});
