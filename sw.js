// Stale-while-revalidate service worker for the app shell only.
// Shell files are answered from the cache at once (fast start, works offline) and refreshed in the
// background, so a new release shows up on the next launch. API calls (cross-origin POST) are never touched.
const CACHE = 'hsf-shell-v11';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'api.js', 'config.js', 'mock.js', 'ui.js', 'util.js',
  'views/signin.js', 'views/book.js', 'views/bookings.js', 'views/owner.js', 'views/account.js', 'views/waiver.js', 'views/go.js',
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
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        // Refresh in the background (bypassing the browser HTTP cache) whether or not we have a copy.
        const network = fetch(req, { cache: 'no-cache' }).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () { return null; });
        if (hit) {
          event.waitUntil(network);
          return hit;
        }
        return network.then(function (res) {
          if (res) return res;
          if (req.mode === 'navigate') return cache.match('index.html');
          return Response.error();
        });
      });
    })
  );
});
