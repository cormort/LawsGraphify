const CACHE = "laws-v8";
const DATA = "laws-data";
const SHELL = ["./", "index.html", "codex.css", "codex.js", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
    event.waitUntil(caches.keys().then(async keys => {
        const old = keys.filter(k => k !== CACHE && k !== DATA);
        await Promise.all(old.map(k => caches.delete(k)));
        await self.clients.claim();
        if (old.length) await tellUpdated();
    }));
});

async function tellUpdated(clientId) {
    for (let tries = 0; clientId && tries < 50; tries++) {
        const client = await self.clients.get(clientId);
        if (client) return client.postMessage("app-updated");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage("app-updated");
}

function refresh(cache, url, before, clientId) {
    return fetch(url.href, { cache: "no-cache" }).then(async response => {
        if (response.ok) {
            if (before && await before.text() !== await response.clone().text()) await tellUpdated(clientId);
            await cache.put(url.pathname, response.clone());
        }
        return response;
    });
}

self.addEventListener("fetch", event => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/laws/")) return;
    event.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        const before = event.request.mode === "navigate" && cached?.clone();
        const fresh = refresh(cache, url, before, event.resultingClientId)
            .catch(() => cached || Response.error());
        if (cached) {
            event.waitUntil(fresh);
            return cached;
        }
        return fresh;
    }));
});

self.addEventListener("message", event => {
    if (event.data !== "check-update") return;
    const url = new URL(event.source.url);
    url.hash = url.search = "";
    event.waitUntil(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(url.href);
        if (cached) await refresh(cache, url, cached, event.source.id).catch(() => {});
    }));
});
