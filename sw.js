// Offline support: the itinerary keeps working in subway tunnels and on the plane.
// - Pages: network-first (updates arrive immediately), cached copy as offline fallback.
// - Static libraries (Leaflet, Firebase SDK): cache-first — they're versioned URLs.
// - Live data (map tiles, Firestore, exchange rates, chat): network only; the page
//   already has its own offline fallbacks for those.
var CACHE = 'ksth-v2';

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(['./']); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // navigations + same-origin: network-first with cache fallback
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(function (res) {
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
  // everything else (tiles, Firestore, rate APIs): straight to network
});

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
