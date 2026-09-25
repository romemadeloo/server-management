/** Cookie-free checks against a running production server, from an allowed IP.
 * BASE_URL=http://localhost:3000 npm run verify:pwa. No database writes. */
import ts from "typescript";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean) {
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
    if (ok) passed += 1;
    else failed += 1;
}

function get(path: string) {
    return fetch(new URL(path, BASE_URL), {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
    });
}

async function checkIcon(path: string, size: number) {
    const response = await get(path);
    check(`${path}: public PNG`, response.status === 200 &&
        (response.headers.get("content-type") ?? "").includes("image/png"));
    const bytes = Buffer.from(await response.arrayBuffer());
    const is_png = bytes.length >= 24 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR";
    check(`${path}: ${size}x${size} pixels`, is_png &&
        bytes.readUInt32BE(16) === size && bytes.readUInt32BE(20) === size);
}

try {
    const response = await get("/manifest.webmanifest");
    check("manifest: 200 without a cookie", response.status === 200);
    check("manifest: JSON MIME type", /(?:manifest\+json|application\/json)/.test(response.headers.get("content-type") ?? ""));
    if (response.status !== 200) throw new Error("Manifest unavailable; use a running server and an allowed IP.");
    const manifest = await response.json() as {
        name?: string; start_url?: string; display?: string; id?: string; scope?: string;
        icons?: { src: string; sizes: string; purpose: string; type: string }[];
    };
    check("manifest: identity and standalone launch", manifest.name === "Glophics Portal" &&
        manifest.start_url === "/dashboard" && manifest.display === "standalone" &&
        manifest.id === "/" && manifest.scope === "/");
    for (const size of [192, 512]) {
        check(`manifest: ${size} any icon`, !!manifest.icons?.some((icon) =>
            icon.sizes === `${size}x${size}` && icon.purpose === "any"));
    }
    check("manifest: separate maskable icon", !!manifest.icons?.some((icon) =>
        icon.sizes === "512x512" && icon.purpose === "maskable"));
    for (const icon of manifest.icons ?? []) {
        const local = icon.src.startsWith("/icons/") && new URL(icon.src, BASE_URL).origin === new URL(BASE_URL).origin;
        check(`${icon.src}: local PNG declaration`, local && icon.type === "image/png");
        if (local) await checkIcon(icon.src, Number(icon.sizes.split("x")[0]));
    }
    await checkIcon("/icons/apple-touch-icon.png", 180);

    const worker = await get("/sw.js");
    check("worker: public JavaScript", worker.status === 200 &&
        (worker.headers.get("content-type") ?? "").includes("application/javascript"));
    check("worker: updates bypass HTTP cache", ["no-cache", "no-store", "must-revalidate"].every((value) =>
        (worker.headers.get("cache-control") ?? "").includes(value)));
    // Tokenize rather than regex-strip comments: the privacy comment itself names
    // API paths, and strings containing // must not be mistaken for comments.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, await worker.text());
    let worker_code = "";
    while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) worker_code += scanner.getTokenText();
    check("worker: no arbitrary cache writes or API paths", !worker_code.includes(".put(") &&
        !worker_code.includes(".addAll(") && !worker_code.includes("/api/"));

    const offline = await get("/offline.html");
    check("offline: public HTML", offline.status === 200 &&
        (offline.headers.get("content-type") ?? "").includes("text/html"));
    const offline_html = await offline.text();
    check("offline: self-contained with a retry link", !/<script\b|<link\b|<img\b/i.test(offline_html) &&
        offline_html.includes('href="/dashboard"'));

    const dashboard = await get("/dashboard");
    check("dashboard: still redirects to login", [302, 303, 307, 308].includes(dashboard.status) &&
        new URL(dashboard.headers.get("location") ?? "/", BASE_URL).pathname === "/login");
    for (const path of ["/api/claims", "/api/chat/conversations"]) {
        check(`${path}: still requires authentication`, (await get(path)).status === 401);
    }
    const login = await get("/login");
    const login_html = await login.text();
    check("login: installation metadata", login.status === 200 &&
        login_html.includes('rel="manifest"') && login_html.includes("/manifest.webmanifest") &&
        login_html.includes('rel="apple-touch-icon"') && login_html.includes('name="theme-color"'));
} catch (error) {
    failed += 1;
    console.error(error instanceof Error ? error.message : error);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
