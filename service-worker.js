/**
 * ODNIS Service Worker
 * Stratégie: Cache-First pour les assets statiques, Network-First pour les données
 */

const CACHE_NAME = 'odnis-v1.0.0';
const RUNTIME_CACHE = 'odnis-runtime-v1';

// Assets à précacher (shell de l'app)
const PRECACHE_ASSETS = [
  '/',
  '/index-ios.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Pages de l'app
  '/dashboard.html',
  '/create-account.html',
  '/create-account-pro.html',
  // Polices (Google Fonts sont gérées séparément)
];

// URLs réseau à ne jamais mettre en cache
const NETWORK_ONLY = [
  '/api/',
  'maps.googleapis.com',
  'analytics',
];

// ─── INSTALL ───
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ───
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Network-only pour les APIs
  if (NETWORK_ONLY.some(u => request.url.includes(u))) {
    event.respondWith(fetch(request));
    return;
  }

  // Google Fonts — Cache puis réseau
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Stratégie Cache-First pour les assets statiques (HTML, CSS, JS, images)
  if (
    request.destination === 'document' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached); // fallback offline

        return cached || networkFetch;
      })
    );
    return;
  }

  // Network-First pour tout le reste (API, data)
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ─── BACKGROUND SYNC ───
self.addEventListener('sync', event => {
  if (event.tag === 'sync-favorites') {
    event.waitUntil(syncFavorites());
  }
  if (event.tag === 'sync-reports') {
    event.waitUntil(syncReports());
  }
});

async function syncFavorites() {
  // Synchroniser les favoris hors-ligne
  const db = await getDB();
  const pending = await db.getAll('pending-favorites');
  for (const item of pending) {
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      await db.delete('pending-favorites', item.id);
    } catch (e) {
      console.warn('[ODNIS SW] Sync favorites failed:', e);
    }
  }
}

async function syncReports() {
  // Synchroniser les signalements rupture hors-ligne
  console.log('[ODNIS SW] Syncing reports...');
}

// ─── PUSH NOTIFICATIONS ───
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: 'ODNIS', body: event.data.text() }; }

  const options = {
    body: data.body || 'Nouvelle notification ODNIS',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'odnis-notif',
    renotify: true,
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ODNIS', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existing = clientList.find(c => c.url === targetUrl && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});

// ─── MESSAGE HANDLER ───
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[ODNIS SW] Service Worker chargé — version:', CACHE_NAME);
