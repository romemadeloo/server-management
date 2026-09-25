# PWA Plan — Glophics Portal

Make the portal **installable** (its own window, its own icon, in the taskbar or on a home screen) and
give it an **honest offline state**. It does **not** make the board readable offline, and that is on
purpose; see "What this deliberately does not do".

## Starting point

- Next.js 15 App Router, Tailwind v4, Neon Postgres, Pusher. No manifest, no service worker.
- Every page the board appears on is a **Server Component**: the board, tickets and team are rendered
  from the database on each request, not read from a JSON API. So "cache the board response" has no
  single response to cache. An offline board would mean caching rendered, per-user HTML and RSC
  payloads.
- `middleware.ts` runs on every path except `_next/static`, `_next/image` and `favicon.ico`. Without
  a session cookie it redirects to `/login`. Browsers fetch a manifest **without cookies**, so a
  manifest behind that redirect cannot be installed. That has to change first (1.2).
- Realtime state already exists: `useRealtime().state` in `components/providers/PusherProvider.tsx`
  says whether the socket is connected, and every reconnect runs the catch-up refetch.
- `public/` is marked legacy only for its current contents (`index.html`, `js/`). Next serves static
  files from `public/` and nowhere else, so the few files that need to be there go there, and Phase 13
  must delete the legacy files **without deleting the directory**.

---

## What this deliberately does not do

**It caches no data: no `/api/*`, no rendered pages, no chat.** There are three reasons, and each one is
enough on its own:

1. **Q11 already recommends against it.** `docs/06-OPEN-QUESTIONS.md` Q11: "a stale board that
   *looks* live is arguably worse for this product than an honest error — someone deploying onto an
   environment the cache says is free is the exact failure the app exists to prevent."
   `docs/03-REALTIME-SPEC.md` lists the old `localStorage` board cache as *Dropped*.
2. **Invariant 4, instant revocation.** `/api/chat/attachments/[id]` checks membership on **every**
   read, so that removing someone from a group cuts them off at once. A cached copy in Cache Storage
   would keep serving that file with no server involved. The same goes for avatars, link-preview
   images and any cached page.
3. **Logout would not clear it.** Cache Storage outlives the session cookie. On a shared machine the
   next person would get the previous person's board and conversations offline.

**No offline mutation queue.** Claims mostly come from Jira sync. Replaying a claim queued hours
earlier against a board that has since changed would be last-write-wins, the same problem the
migration removed when it dropped `POST /api/state`.

**No Web Push (yet).** Desktop notifications are the Notification API and fire only while a tab is
open (`lib/notify/desktop.ts`). Push needs VAPID keys, a stored per-device subscription and a
server-side sender. That is a separate project once this one is working, and adding a service worker
now is the first step towards it.

**No Workbox or `next-pwa`.** `next-pwa` is unmaintained and does not support the App Router
properly. Workbox's precache manifest needs a build plugin, and a service worker that does one thing
does not need either. If precaching is ever wanted, the maintained successor is Serwist
(`@serwist/next`).

---

## Phase 1: Installable

### 1.1 Manifest: `app/manifest.ts`

Next 15 generates `/manifest.webmanifest` from this file and adds the `<link rel="manifest">`
automatically. Nothing goes in `public/`, and no metadata field needs setting.

```ts
import type { MetadataRoute } from "next";

/**
 * The colours are the DEFAULT palette's (--color-brand-500 and --color-canvas
 * in app/globals.css). A manifest is static and cannot follow a user's chosen
 * palette. The title-bar colour can, via viewport.themeColor; see 1.3.
 *
 * No `orientation`: this is a wide, desktop-first board, and locking it to
 * portrait would make it worse on the one device class it is actually used on.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Glophics Portal",
    short_name: "Glophics",
    description: "Which QA/staging environments are free, and which are held by a Jira ticket.",
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ecefee",
    theme_color: "#007f6d",
    // `any` and `maskable` are separate entries. "any maskable" on one icon is
    // a Lighthouse warning: the same art cannot be both full-bleed and padded.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Only pages every role can open. /chat is gated on the `chat` capability,
    // and a shortcut that lands on a refusal is worse than no shortcut.
    shortcuts: [
      { name: "Dashboard", url: "/dashboard" },
      { name: "Environments", url: "/environments" },
      { name: "My tickets", url: "/my-tickets" },
    ],
  };
}
```

### 1.2 Let the manifest, icons and worker through without a cookie: `middleware.ts`

Add them to `PUBLIC_PATHS`. Do **not** add them to the matcher exclusion. The matcher skips the IP
allowlist as well, and the allowlist's rule is one answer for every path. With `PUBLIC_PATHS` a
stranger still gets `403`, and an allowed address gets the file without having to be signed in.

```ts
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  // PWA plumbing. The browser fetches the manifest and its icons WITHOUT
  // cookies, so behind the sign-in redirect the app cannot be installed. None
  // of these carries anything about the board. They still pass the IP gate.
  "/manifest.webmanifest",
  "/icons",
  "/sw.js",
  "/offline.html",
];
```

### 1.3 iOS and the title bar: `app/layout.tsx`

```ts
export const metadata: Metadata = {
  title: "Glophics Portal",
  description: "Which QA/staging environments are free, and which are held by a Jira ticket.",
  // Safari ignores the manifest's icons and reads this instead.
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Glophics", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Light and dark defaults. Following a CUSTOM palette would mean updating
  // <meta name="theme-color"> from THEME_INIT. Optional, and not part of this pass.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#007f6d" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1211" },
  ],
};
```

### 1.4 Icons: `public/icons/`

Four PNGs, generated **once** from one SVG (the grid mark from the legacy `public/index.html`) and
committed. Use a one-off `npx sharp-cli`, or any exporter. Do not add `sharp` as a dependency for a job
that runs once.

| File | Size | Notes |
|---|---|---|
| `icon-192.png` | 192×192 | `any` |
| `icon-512.png` | 512×512 | `any`; also the splash screen image |
| `maskable-512.png` | 512×512 | mark inside the central 80% safe zone, brand background edge to edge |
| `apple-touch-icon.png` | 180×180 | opaque background; iOS fills transparency with black |

**Exit:** Chrome/Edge show the install icon in the address bar, and DevTools → Application → Manifest
shows no errors.

---

## Phase 2: A service worker that only says "you're offline"

### 2.1 `public/sw.js`, plain JavaScript and hand-written

It intercepts **navigations only**. Online, it passes each one straight to the network. Offline, it
shows one static page. It never stores a response it received, so there is nothing to invalidate on
deploy and nothing left behind at logout.

```js
/**
 * The whole service worker. What it deliberately does NOT do matters more than
 * what it does. See plan.md "What this deliberately does not do".
 *
 *   - It caches exactly one file, /offline.html, which is static and says
 *     nothing about the board.
 *   - It never caches /api/*, rendered pages, RSC payloads or attachments.
 *     Those are per-user, and attachment reads re-check membership on every
 *     request (invariant 4). A cached copy would outlive both a revocation and
 *     a logout.
 *   - It does not touch /_next/static. Those files are content-hashed and sent
 *     `immutable`, so the browser's HTTP cache already does the job, and a
 *     second cache here would only grow with every deploy.
 *
 * An HTTP error (403 from the IP gate, 500 from the app) is a RESPONSE, not a
 * network failure, so it passes through unchanged. Only "could not reach the
 * server at all" gets the offline page.
 *
 * Bump CACHE when offline.html changes. `activate` deletes every other cache.
 */
const CACHE = "glophics-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  // Nothing cached here can be stale in a way that breaks a running page, so a
  // new worker may take over at once. No "update available" toast is needed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      // Navigation preload starts the network request while the worker boots,
      // so intercepting navigations costs no latency when online.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        return (await event.preloadResponse) || (await fetch(event.request));
      } catch {
        return (await caches.match(OFFLINE_URL)) || Response.error();
      }
    })(),
  );
});
```

### 2.2 `public/offline.html`

Self-contained: inline CSS, no web font, no script, `prefers-color-scheme` for dark mode. It is a
static file outside the app, so the semantic-token rule does not reach it. Its colours are the default
palette's literal hex values, with a comment saying where they come from. The copy says what is true:

> **You're offline.** The board can't be shown without a connection, because an out-of-date board
> could say an environment is free when it isn't. It will load as soon as you're back online.

The page should have a **Try again** link to `/dashboard`.

### 2.3 Headers: `next.config.ts`

Add this next to the existing `/:path*` security headers, which stay as they are:

```ts
{
  // Browsers already bypass the HTTP cache for worker updates past 24h. This
  // makes a deploy's new worker be picked up on the next navigation instead.
  source: "/sw.js",
  headers: [
    { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
    { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  ],
},
```

`Service-Worker-Allowed` is not needed. The worker lives at `/`, which is already its maximum scope.

### 2.4 Registration: `components/pwa/ServiceWorkerRegister.tsx`

A separate client component, because both layouts are Server Components. It is mounted in the
**root** `app/layout.tsx`, so `/login` also gets the offline page.

```tsx
"use client";

import { useEffect } from "react";

/**
 * Registers once per page load. The empty dependency list matters: keyed on the
 * pathname, this would re-register on every client-side navigation.
 *
 * Production only. A worker in `next dev` intercepts navigations during HMR,
 * and every "why is my change not showing" question then starts with
 * unregistering it by hand.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.warn("[pwa] service worker registration failed", err));
  }, []);
  return null;
}
```

**Exit:** after running `npm run build && npm start`, turning on DevTools → Network → Offline and
reloading shows `offline.html`. The Cache Storage panel shows exactly one cache holding one entry.

---

## Phase 3: Say so while a page is open

The service worker only covers *navigations*. An already-open board that loses its connection keeps
showing what it last rendered, and that stale board is the risk Q11 describes. That risk exists
**today**, with or without a PWA. A PWA makes it more likely, because an installed window stays open for
days.

### 3.1 `components/pwa/OfflineBanner.tsx`

Mounted in `app/(app)/layout.tsx`, inside `PusherProvider`, because it reads `useRealtime()`.

- **Offline** means `navigator.onLine === false`, **or** the Pusher state is `unavailable`/`failed`.
  `navigator.onLine` alone says `true` on a network with no route out. The socket is the better
  signal, and it already exists.
- Show it only after the condition has held for ~5 s. Pusher passes through `connecting` on every
  laptop wake, and a banner that flashes each time teaches people to ignore it.
- Copy: *"You're offline. The board may be out of date. Don't rely on it before deploying."* Do **not**
  say "changes will sync when reconnected": nothing is queued, so that would be false.
- Tokens: `bg-warn-soft text-warn-strong border-line` (there is no `bg-warning`).
- Clearing it needs no extra work. The reconnect catch-up in `PusherProvider` already refreshes the
  board.

---

## Phase 4: Install entry point

### 4.1 An **Install app** item in the account menu, not a floating popup

Put it next to the desktop-notifications toggle in `components/shell/AccountMenu.tsx`, following the
same pattern: opt-in, one click, and hidden when it can't do anything.

- A small hook, `components/pwa/useInstallPrompt.ts`, keeps the `beforeinstallprompt` event
  (`preventDefault()`, then store it) and clears it on `appinstalled`.
- The menu item renders only while an event is held. That already hides it when the app is installed,
  and in Safari and Firefox, which never fire the event.
- TypeScript has no `BeforeInstallPromptEvent` type, so declare it in `types/pwa.d.ts`
  (`prompt(): Promise<void>`, `userChoice: Promise<{ outcome: "accepted" | "dismissed" }>`) and add
  `beforeinstallprompt` to `WindowEventMap`.
- Safari: optionally, a one-line hint in the same menu (*"Share → Add to Home Screen"*) when
  `navigator.standalone === false`.

A menu item needs no "remind me later" logic, no timer and no `localStorage`. A popup that fires 30 s
into every visit would need all three.

---

## Phase 5: Verification

### 5.1 `scripts/verify-pwa.mts` → `npm run verify:pwa`

This runs against a running server (`BASE_URL`, default `http://localhost:3000`), **without** a
session cookie, from an allowed IP:

- `/manifest.webmanifest` returns 200 JSON with `name`, `start_url`, `display: "standalone"`, a 192 and
  a 512 `any` icon, and one `maskable`.
- Every icon it lists returns 200 `image/png` at the size it claims.
- `/sw.js` returns 200 JavaScript with `Cache-Control: no-cache…`, and `/offline.html` returns 200 HTML.
- **The boundary did not widen:** `/dashboard` still redirects to `/login`, and `/api/claims` and
  `/api/chat/conversations` still answer 401.
- `sw.js` contains no `cache.put` and does not mention `/api/`. This is a crude guard, but it is the
  cheapest way to stop someone adding "just a little" caching.

### 5.2 Manual

- [ ] Lighthouse → installable, and the manifest has no warnings
- [ ] Install on Chrome and Edge (desktop), and on Chrome Android. Add to Home Screen on iOS Safari
- [ ] Offline: reload shows `offline.html`, and **Try again** loads the board once back online
- [ ] Offline with a board open: the banner appears after ~5 s and clears on reconnect, and the board
      refreshes
- [ ] Sign out, go offline, reload: `offline.html`, and **no** board anywhere in Cache Storage
- [ ] Deploy with `CACHE` bumped: the old cache is gone after one navigation
- [ ] `npm test`, `npm run typecheck`, and `npm run build` succeed

---

## Decisions to record

These go in `docs/` **before** building, per CLAUDE.md:

| Where | What |
|---|---|
| `docs/06-OPEN-QUESTIONS.md` **Q11** | Answer: *accepted.* The board is not readable offline, and offline shows an honest offline state. |
| `docs/05-DECISIONS.md` **ADR-019** | "The PWA caches no data": the three reasons above. Revisit only with explicit "last updated" labelling and a logout-clears-caches path. |
| `docs/04-MIGRATION-PLAN.md` Phase 13 | Delete `public/index.html` and `public/js/` only. `public/` now also holds `sw.js`, `offline.html` and `icons/`. |

## Files

```
app/manifest.ts                          NEW
app/layout.tsx                           + icons.apple, appleWebApp, viewport.themeColor, <ServiceWorkerRegister />
app/(app)/layout.tsx                     + <OfflineBanner /> inside PusherProvider
middleware.ts                            + 4 entries in PUBLIC_PATHS
next.config.ts                           + /sw.js headers
public/sw.js                             NEW
public/offline.html                      NEW
public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png   NEW
components/pwa/ServiceWorkerRegister.tsx NEW
components/pwa/OfflineBanner.tsx         NEW
components/pwa/useInstallPrompt.ts       NEW
components/shell/AccountMenu.tsx         + Install app item
types/pwa.d.ts                           NEW
scripts/verify-pwa.mts                   NEW  (+ "verify:pwa" in package.json)
```

No new dependencies.

## Effort

| Phase | Est. |
|---|---|
| 1: Manifest, icons, middleware, metadata | 1.5–2 h |
| 2: Service worker, offline page, headers, registration | 1.5–2 h |
| 3: Offline banner | 1 h |
| 4: Install menu item | 1 h |
| 5: Verify script and device testing | 1.5–2 h |
| **Total** | **6.5–8 h** |

## Later, deliberately separate

- **Web Push**: VAPID keys, a `push_subscriptions` table keyed by auth user and device, a `push`
  handler in `sw.js`, and sending from the same place `notificationTargets` is computed. iOS supports
  it only for an installed PWA (16.4+).
- **Palette-following title bar**: update `<meta name="theme-color">` from `THEME_INIT` for custom
  palettes.
- **Offline reading**: only as a new decision that overturns ADR-019, with "last updated" on every
  cached view and caches cleared on logout and on `session.revoked`.
