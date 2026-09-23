// Offline support: the itinerary keeps working in subway tunnels and on the plane.
// - Pages: network-first (updates arrive immediately), cached copy as offline fallback.
// - Static libraries (Leaflet, Firebase SDK): cache-first — they're versioned URLs.
// - Map tiles (OpenStreetMap): network-first, and every tile viewed is kept in its own
//   capped cache so map areas you've looked at still show offline.
// - Live data (Firestore, exchange rates, chat): network only; the page
//   already has its own offline fallbacks for those.
var CACHE = 'ksth-v7';
var TILES = 'ksth-tiles';
var TILE_MAX = 1500; // ~25 KB each, so ~35 MB at most
var tilePuts = 0;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(['./']); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== TILES; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // navigations + same-origin: network-first with cache fallback.
  // 'no-cache' forces revalidation with the server, skipping the CDN's 10-min
  // HTTP cache — so new deploys reach every device on the next open.
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, req.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('./'); });
      })
    );
    return;
  }

  // static CDN libraries: cache-first
  if (url.hostname === 'unpkg.com' || url.hostname === 'www.gstatic.com') {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
  }
  // map tiles: network first (fresh when online), saved copy when offline
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(TILES).then(function (c) {
            return c.put(req, copy).then(function () {
              if (++tilePuts % 50 === 0) trimTiles(c);
            });
          });
        }
        return res;
      }).catch(function () {
        return caches.open(TILES).then(function (c) { return c.match(req); }).then(function (hit) {
          return hit || Response.error();
        });
      })
    );
    return;
  }

  // everything else (Firestore, rate APIs): straight to network
});

function trimTiles(c) {
  // keys come back oldest-first: drop the oldest beyond the cap
  return c.keys().then(function (keys) {
    return Promise.all(keys.slice(0, Math.max(0, keys.length - TILE_MAX)).map(function (k) { return c.delete(k); }));
  });
}

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      return clients.openWindow('./');
    })
  );
});
