import { NextResponse, type NextRequest } from "next/server";
import { allowsIp, clientIp, parseAllowlist } from "@/lib/ip-allowlist";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * The outermost gate. Two jobs, in this order, and nothing else:
 *
 *   1. The IP allowlist — ahead of routing, sessions and even the sign-in
 *      screen, so a stranger gets one answer for every path. This ordering is
 *      the whole point; see docs/00-CONTEXT-CURRENT-SYSTEM.md.
 *
 *   2. A cookie *presence* check, to send a signed-out visitor to /login rather
 *      than rendering a shell they cannot fill.
 *
 * What this deliberately does NOT do is decide whether the session is valid or
 * what the user may do. Middleware runs on the Edge runtime: it cannot reach
 * node:crypto to verify anything, and a role check here would be a second
 * boundary to keep in step with the real one. The authoritative check is
 * `requireUser()` in lib/auth/require.ts, on the Node runtime, called by every
 * route handler and protected Server Component.
 *
 * So a forged cookie gets past *this* file and is then refused with a 401 by the
 * handler. That is intended — presence is a redirect hint, not a credential.
 */

// Parsed once per isolate rather than per request. ALLOWED_IPS is build/deploy
// configuration, so it cannot change under a running isolate anyway.
const allowlist = parseAllowlist();

// Fail closed in production, open in development. See lib/ip-allowlist.ts and
// docs/06-OPEN-QUESTIONS.md Q3 — on a public URL, a missing env var must not
// silently expose the portal.
const failClosedWhenUnset = process.env.NODE_ENV === "production";

if (allowlist.invalid.length) {
  console.warn(`[ip-allowlist] ignoring unparseable entries: ${allowlist.invalid.join(", ")}`);
}
if (allowlist.open) {
  console.warn(
    failClosedWhenUnset
      ? "[ip-allowlist] ALLOWED_IPS is empty — REFUSING ALL REQUESTS. Set it to open the portal."
      : "[ip-allowlist] ALLOWED_IPS is empty — allowing every address (development only).",
  );
}

/**
 * Paths a person may reach without a session — the sign-in handshake, and the
 * screen it happens on.
 *
 * Machine-authenticated endpoints are NOT here; they short-circuit earlier, in
 * isMachineAuthenticated(), because they need to skip the IP gate as well.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
  // Cookie-free installation assets still pass the IP gate above the session check.
  "/manifest.webmanifest",
  "/icons",
  "/sw.js",
  "/offline.html",
];

/**
 * Endpoints called by a machine, not a person, and authenticated by a secret
 * rather than by where the request came from.
 *
 * These are exempt from the IP allowlist, and that is a deliberate ordering
 * decision rather than an oversight. The allowlist exists to control which
 * *humans* can reach the portal; it cannot be used to gate a callback whose
 * source addresses belong to Pusher or to Vercel's own scheduler. Applying it
 * would mean the Pusher webhook getting a bare 403 and Pusher backing off from
 * delivering presence at all, and cron jobs silently never running.
 *
 * What replaces the network check is stronger, not weaker:
 *   /api/pusher/webhook  HMAC-SHA256 of the raw body against PUSHER_SECRET
 *   /api/cron/*          a bearer CRON_SECRET, and the route REFUSES when unset
 *
 * An IP is spoofable and a shared secret is not, so this is the right way round.
 */
function isMachineAuthenticated(pathname: string): boolean {
  return pathname === "/api/pusher/webhook" || pathname.startsWith("/api/cron/");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Ahead of the IP gate, because these have no allowlistable origin. See above.
  if (isMachineAuthenticated(pathname)) return NextResponse.next();

  // ---- 1. the gate ----
  if (!allowsIp(clientIp(req.headers), allowlist, failClosedWhenUnset)) {
    // Plain text, and it says nothing about what runs here — a refusal should
    // not confirm there is a portal worth coming back for.
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasCookie = req.cookies.has(SESSION_COOKIE);

  // ---- 2. the redirect hint ----
  if (!isPublic && !hasCookie) {
    // An API call gets a 401 it can act on, not an HTML redirect it would have
    // to detect by sniffing the response body.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "Sign in to continue." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Path only, never the full URL — an open-redirect via ?next= is exactly the
    // kind of thing a login page invites.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  /**
   * There is deliberately NO "already has a cookie, bounce /login to the board"
   * rule here, and it must not be added back.
   *
   * Middleware only knows whether a cookie *exists*; the app layout knows
   * whether it *resolves*. A cookie that is present but dead — expired, revoked,
   * or pointing at a row that no longer exists after a re-import — makes those
   * two disagree, and if both redirect the disagreement becomes an infinite
   * loop: the layout sends /dashboard to /login, and this would send /login
   * straight back to /dashboard.
   *
   * So the "you are already signed in" redirect lives in app/login/page.tsx,
   * where the session is actually resolved. One authority, no loop.
   */
  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next's own build output. The legacy gate covered static
   * files too — a refusal had to be identical for every path — so `_next/static`
   * is the only exemption, and only because those are the framework's assets
   * rather than anything about this board.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
