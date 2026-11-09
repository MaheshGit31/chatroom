// sw.js - shows generic push alerts (message text is end-to-end encrypted, so the server can't include it)
self.addEventListener('push', (event) => {
  let data = {};                                              // payload from the server
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Chatroom', {
    body: data.body || 'You have a new message',              // generic text
    tag: data.convId || 'chatroom',                           // one notification per conversation
    data: { convId: data.convId || null },                    // used when clicked
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const convId = event.notification.data && event.notification.data.convId;
  const url = '/' + (convId ? '?c=' + convId : '');           // open straight into that chat
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

const SHELL = 'chatroom-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || r.mode !== 'navigate') return;
  e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(SHELL).then((x) => x.put('/', c)); return res; }).catch(() => caches.match('/').then((m) => m || new Response('offline', { status: 503 }))));
});
