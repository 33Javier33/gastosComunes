const CACHE_NAME = 'gastos-comunes-v15';
const CACHE_TIMEOUT = 5000; // ms before falling back to cache

const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/index.css',
    '/index.js',
    '/manifest.json',
    'https://cdn.tailwindcss.com?plugins=forms',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@400,0&display=swap'
];

// ─── INSTALL: pre-cache static shell ─────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            cache.addAll(STATIC_ASSETS.filter(u => !u.startsWith('http')))
        ).then(() => self.skipWaiting())
    );
});

// ─── ACTIVATE: delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ─── FETCH: cache-first for static, network-first for GAS / API ──────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // POST a GAS (push de datos): dejar que el navegador lo maneje directamente,
    // sin timeout ni caché del SW para evitar devolver una respuesta obsoleta.
    if (url.hostname === 'script.google.com') {
        if (event.request.method === 'POST') return;
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Network-first for navigation requests so updates propagate
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirstWithFallback(event.request));
        return;
    }

    // Cache-first for everything else (fonts, CDN assets, local files)
    event.respondWith(cacheFirst(event.request));
});

// ─── STRATEGIES ──────────────────────────────────────────────────────────────

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('Offline – recurso no disponible', { status: 503 });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetchWithTimeout(request, CACHE_TIMEOUT);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        return cached || new Response(JSON.stringify({ ok: false, error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function networkFirstWithFallback(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request) || await caches.match('/index.html');
        return cached || new Response('Sin conexión', { status: 503 });
    }
}

function fetchWithTimeout(request, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request).then(r => { clearTimeout(timer); resolve(r); }).catch(reject);
    });
}

// ─── BACKGROUND SYNC (optional, queues pushes when offline) ──────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'sync-expenses') {
        event.waitUntil(broadcastSyncRequest());
    }
});

async function broadcastSyncRequest() {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SW_TRIGGER_SYNC' }));
}
