// Offline support: answer from the cache, refresh it in the background
// (stale-while-revalidate), so the app opens instantly with or without a network.
const CACHE = "laws-v1";
const SHELL = ["./", "index.html", "laws_graph.json", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== location.origin) return;
    event.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        // no-cache: always ask the server (a cheap 304 when unchanged), so the
        // HTTP cache cannot hand back a stale copy after a deploy
        const fresh = fetch(url.href, { cache: "no-cache" })
            .then(response => {
                if (response.ok) cache.put(url.pathname, response.clone());
                return response;
            })
            .catch(() => cached || Response.error());
        if (cached) {
            event.waitUntil(fresh);
            return cached;
        }
        return fresh;
    }));
});
