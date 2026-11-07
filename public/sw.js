/* Wesla service worker. Deliberately does NOT cache anything (no stale-app bugs).
   It exists for: (1) installability, (2) showing notifications on Android (new Notification() is not allowed there),
   (3) receiving Web Push messages when push is enabled in phase 2. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'وصلة', {
    body: d.body || '', icon: '/logo-192.png', badge: '/logo-192.png', tag: d.tag, dir: 'rtl', lang: 'ar', data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
