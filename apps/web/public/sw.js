/* Service worker da Prospecção: só notificações (não guarda páginas em cache: a tela é sempre a
   mais nova). Recebe o aviso do servidor (Web Push) e, no toque, abre a tela certa. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { titulo: e.data ? e.data.text() : 'Prospecção' };
  }
  const titulo = d.titulo || 'Prospecção';
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: d.texto || '',
      icon: '/icone-192.png',
      badge: '/icone-192.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { link: d.link || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = e.notification.data?.link || '/';
  const destino = new URL(link, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (j.url.startsWith(self.location.origin) && 'focus' in j) {
          j.navigate(destino).catch(() => undefined);
          return j.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});

// Sem cache: tudo vai para a rede (o navegador exige um "fetch" para instalar como app).
self.addEventListener('fetch', () => undefined);
