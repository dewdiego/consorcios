// Service worker mínimo: habilita la instalación. No cachea nada, así siempre se ve la última versión.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
