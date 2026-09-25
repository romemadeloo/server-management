/**
 * Cache only the static offline page. Never cache /api/*, authenticated HTML,
 * RSC payloads or chat files: stored responses would outlive logout and skip
 * permission checks. Hashed build assets already have the browser's HTTP cache.
 * See ADR-019. Bump CACHE whenever offline.html changes.
 */
const CACHE = "glophics-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
        // No cached application state can become incompatible with a running tab.
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter((key) => key.startsWith("glophics-offline-") && key !== CACHE)
            .map((key) => caches.delete(key)));
        // Start the network while the worker boots, avoiding a serial round trip.
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
        }
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    // A failed form POST must never look like a successful offline navigation.
    if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
    event.respondWith((async () => {
        try {
            // HTTP 403/500 are real responses, not an offline state.
            return (await event.preloadResponse) || (await fetch(event.request));
        } catch {
            const cache = await caches.open(CACHE);
            return (await cache.match(OFFLINE_URL)) || Response.error();
        }
    })());
});
