const CACHE = 'noroemon-v2';
const STATIC = ['./', './index.html'];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);

    // Network-first for JS/TS dist files — always get fresh code
    if (url.pathname.includes('/dist/') || url.pathname.endsWith('.js')) {
        e.respondWith(
            fetch(e.request).then((resp) => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE).then((c) => c.put(e.request, clone));
                }
                return resp;
            }).catch(() => caches.match(e.request).then((c) => c ?? new Response('Offline', { status: 503 })))
        );
        return;
    }

    // Cache-first for everything else (fonts, images, etc.)
    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;
            return fetch(e.request).then((resp) => {
                if (resp.ok) {
                    const clone = resp.clone();
                    caches.open(CACHE).then((c) => c.put(e.request, clone));
                }
                return resp;
            }).catch(() => new Response('Offline', { status: 503 }));
        })
    );
});
