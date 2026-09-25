import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const WORKER_SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const CACHE = "glophics-offline-v1";

/** Run the shipped worker, not a second implementation. These fakes deliberately
 * expose no cache.put: accidentally caching a network response must fail. */
function createWorker(network: () => Promise<Response> = async () => new Response("live")) {
    const handlers = new Map<string, (event: unknown) => void>();
    const entries = new Map<string, Map<string, Response>>();
    const cached_requests: Request[] = [];
    let network_calls = 0;
    let claimed = false;
    let skipped = false;
    let preload_enabled = false;

    runInNewContext(WORKER_SOURCE, {
        // Browsers resolve relative Request URLs against the worker location.
        Request: class extends Request {
            constructor(input: string, init?: RequestInit) {
                super(new URL(input, "https://portal.test"), init);
            }
        },
        Response,
        fetch: async () => { network_calls += 1; return network(); },
        caches: {
            keys: async () => [...entries.keys()],
            delete: async (key: string) => entries.delete(key),
            open: async (key: string) => {
                if (!entries.has(key)) entries.set(key, new Map());
                const cache = entries.get(key)!;
                return {
                    add: async (request: Request) => {
                        cached_requests.push(request);
                        cache.set(request.url, new Response("offline"));
                    },
                    match: async (path: string) => cache.get(new URL(path, "https://portal.test").href)?.clone(),
                };
            },
        },
        self: {
            addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
            skipWaiting: async () => { skipped = true; },
            clients: { claim: async () => { claimed = true; } },
            registration: { navigationPreload: { enable: async () => { preload_enabled = true; } } },
        },
    });

    async function lifecycle(name: string) {
        let work: Promise<void> | undefined;
        handlers.get(name)!({ waitUntil: (promise: Promise<void>) => { work = promise; } });
        await work;
    }
    function request(path: string, mode = "navigate", method = "GET", preload: Promise<Response | undefined> = Promise.resolve(undefined)) {
        let response: Promise<Response> | undefined;
        handlers.get("fetch")!({
            request: { url: `https://portal.test${path}`, mode, method },
            preloadResponse: preload,
            respondWith: (promise: Promise<Response>) => { response = promise; },
        });
        return response;
    }
    return { entries, cached_requests, lifecycle, request,
        stats: () => ({ network_calls, claimed, skipped, preload_enabled }) };
}

test("worker installs only the offline page and replaces only its own old caches", async () => {
    const worker = createWorker();
    worker.entries.set("glophics-offline-v0", new Map());
    worker.entries.set("unrelated-cache", new Map());
    await worker.lifecycle("install");
    await worker.lifecycle("activate");
    assert.deepEqual([...worker.entries.keys()].sort(), [CACHE, "unrelated-cache"].sort());
    assert.equal(worker.cached_requests.length, 1);
    assert.equal(worker.cached_requests[0]!.url, "https://portal.test/offline.html");
    assert.equal(worker.cached_requests[0]!.cache, "reload");
    assert.deepEqual(worker.stats(), { network_calls: 0, claimed: true, skipped: true, preload_enabled: true });
});

test("worker leaves APIs, RSC, attachments, assets and form posts to the browser", () => {
    const worker = createWorker();
    for (const path of ["/api/claims", "/api/chat/attachments/123", "/dashboard?_rsc=abc", "/_next/static/app.js"]) {
        assert.equal(worker.request(path, "cors"), undefined);
    }
    assert.equal(worker.request("/dashboard", "navigate", "POST"), undefined);
    assert.equal(worker.stats().network_calls, 0);
    assert.equal(worker.entries.size, 0);
});

test("worker passes through live HTML and HTTP errors without caching them", async () => {
    for (const status of [200, 403, 500]) {
        const response = new Response("server response", { status });
        const worker = createWorker(async () => response);
        assert.equal(await worker.request("/dashboard"), response);
        assert.equal(worker.entries.size, 0);
    }
});

test("worker uses navigation preload without a duplicate network request", async () => {
    const worker = createWorker();
    const response = new Response("preloaded");
    assert.equal(await worker.request("/dashboard", "navigate", "GET", Promise.resolve(response)), response);
    assert.equal(worker.stats().network_calls, 0);
});

test("network and preload failures show only the static offline page, including at login", async () => {
    const worker = createWorker(async () => { throw new TypeError("offline"); });
    await worker.lifecycle("install");
    for (const path of ["/dashboard", "/login", "/chat"]) {
        assert.equal(await (await worker.request(path))!.text(), "offline");
    }
    assert.equal(await (await worker.request("/dashboard", "navigate", "GET", Promise.reject(new TypeError("offline"))))!.text(), "offline");
    assert.deepEqual([...worker.entries.get(CACHE)!.keys()], ["https://portal.test/offline.html"]);
});

test("a missing offline entry remains a network error", async () => {
    const worker = createWorker(async () => { throw new TypeError("offline"); });
    assert.equal((await worker.request("/dashboard"))!.type, "error");
});
