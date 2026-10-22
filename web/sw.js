// Offline support: answer from the cache, refresh it in the background
// (stale-while-revalidate), so the app opens instantly with or without a network.
// Law texts (laws/) are not handled here: the page keeps them in DATA and asks
// before downloading the ones that changed.
const CACHE = "laws-v4";
const DATA = "laws-data";
const SHELL = ["./", "index.html", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

// A new sw.js caches the new page while installing, so the comparison below
// would find nothing new: tell the pages opened under the old worker instead
self.addEventListener("activate", event => {
    event.waitUntil(caches.keys().then(async keys => {
        const old = keys.filter(k => k !== CACHE && k !== DATA);
        await Promise.all(old.map(k => caches.delete(k)));
        await self.clients.claim();
        if (old.length) await tellUpdated();
    }));
});

// The page being opened may not exist yet when the fresh copy arrives (a fast
// network), so wait for it; without resultingClientId, tell every open page
async function tellUpdated(clientId) {
    for (let tries = 0; clientId && tries < 50; tries++) {
        const client = await self.clients.get(clientId);
        if (client) return client.postMessage("app-updated");
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage("app-updated");
}

// no-cache: always ask the server (a cheap 304 when unchanged), so the HTTP
// cache cannot hand back a stale copy after a deploy. before: the cached page
// the client is showing; if the server's differs, tell the client
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
        const before = event.request.mode === "navigate" && cached?.clone();  // cached itself goes to the page
        const fresh = refresh(cache, url, before, event.resultingClientId)
            .catch(() => cached || Response.error());
        if (cached) {
            event.waitUntil(fresh);
            return cached;
        }
        return fresh;
    }));
});

// An installed app brought back from the background is not reloaded, so no
// navigation reaches the fetch handler; the page asks when it comes to the front
self.addEventListener("message", event => {
    if (event.data !== "check-update") return;
    const url = new URL(event.source.url);
    url.hash = url.search = "";
    event.waitUntil(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(url.href);
        if (cached) await refresh(cache, url, cached, event.source.id).catch(() => {});
    }));
});
