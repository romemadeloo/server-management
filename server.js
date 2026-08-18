/**
 * Local sync server for the Server Management dashboard.
 *
 * Serves the static app and holds the shared appData in memory (persisted
 * to shared-state.json on disk). Every POST /api/state broadcasts the new
 * state to all connected browser tabs over Server-Sent Events, so two
 * people looking at the dashboard at the same time — e.g. host + guest in
 * a VS Code Live Share session with this port shared — see each other's
 * assign/edit/release actions live.
 *
 * Also proxies Jira (GET /api/jira/:key ticket lookups, POST /api/jira/comment,
 * GET/POST /api/jira-config, POST /api/jira-config/test) so the browser
 * never needs an API token — credentials live server-side in
 * jira-config.json, which is not part of `state` and is never sent to a
 * browser tab (the config GET response masks the token).
 *
 * Every 30s: pings every repo's own URL to set its health to "online" or
 * "offline" (any repo down makes its environment show "Needs attention"),
 * and applies the auto-release rules from appData.settings — expired
 * bookings when onExpiry is "auto-release", or bookings whose linked ticket
 * has moved to a Jira "done" status when jira.autoReleaseOnClose is on.
 *
 * Run: node server.js
 * Then open http://localhost:4000 (or share that port via Live Share).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { buildDefaultAppData, migrateAppData, matchRepositoriesToKeys, matchUserIdsByLabels, findServerForTicket, JIRA_TERMINAL_STATUSES } = require("./js/data.js");

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
// STATE_FILE points at a mounted disk on a host, so bookings and configured
// environments survive a restart. Without it the app still runs — state just
// resets to the seed in js/data.js whenever the process is replaced.
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, "shared-state.json");
const JIRA_CONFIG_FILE = path.join(ROOT, "jira-config.json");

// Accept a saved baseUrl with or without a protocol (people paste bare
// domains like "company.atlassian.net") — fetch() throws on a protocol-less
// URL, which otherwise surfaces as a confusing "couldn't reach" error.
function normalizeBaseUrl(base) {
  const trimmed = (base || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

const jiraIssuePath = (base, key, fields) => `${normalizeBaseUrl(base)}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields || "summary,status,assignee"}`;
const jiraCommentPath = (base, key) => `${normalizeBaseUrl(base)}/rest/api/3/issue/${encodeURIComponent(key)}/comment`;
const jiraMyselfPath = (base) => `${normalizeBaseUrl(base)}/rest/api/3/myself`;
const jiraBrowseUrl = (base, key) => `${normalizeBaseUrl(base)}/browse/${key}`;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (parsed.users && parsed.accounts && parsed.servers) {
        if (migrateAppData(parsed)) {
          try { fs.writeFileSync(STATE_FILE, JSON.stringify(parsed, null, 2)); } catch (err) { /* read-only disk */ }
        }
        return parsed;
      }
    } catch (err) {
      // fall through to reseed
    }
  }
  const seeded = buildDefaultAppData();
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(seeded, null, 2));
  } catch (err) {
    // Read-only disk (most PaaS hosts). Run from memory instead of dying —
    // persist() already ignores its own write errors for the same reason.
    console.warn("Could not write " + STATE_FILE + " — running with in-memory state only.");
  }
  return seeded;
}

let state = loadState();
const sseClients = new Set();

function persist() {
  fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
}

function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// ---------- Jira config (credentials stay server-side only) ----------
// Never part of `state`, so never broadcast to browser tabs over SSE.
// Read fresh each call so editing jira-config.json by hand still works.

// A deployment supplies credentials as environment variables — its disk is
// usually read-only, and jira-config.json is gitignored precisely so the
// token never rides along in the repo. Env wins over the file so a stale
// local file can't quietly override what the host is configured with.
function jiraConfigFromEnv() {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !apiToken) return null;
  return { baseUrl: baseUrl.trim(), email: email.trim(), apiToken: apiToken.trim() };
}

function loadJiraConfig() {
  const fromEnv = jiraConfigFromEnv();
  if (fromEnv) return fromEnv;
  if (!fs.existsSync(JIRA_CONFIG_FILE)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(JIRA_CONFIG_FILE, "utf8"));
    if (!config.baseUrl || !config.email || !config.apiToken) return null;
    return config;
  } catch (err) {
    return null;
  }
}

function jiraConfigured() {
  const config = loadJiraConfig();
  return !!config && state.settings.jira.enabled;
}

function jiraAuthHeader(config) {
  return "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
}

async function handleJiraConfigGet(res) {
  const config = loadJiraConfig();
  sendJson(res, 200, {
    baseUrl: config ? config.baseUrl : "",
    email: config ? config.email : "",
    hasToken: !!(config && config.apiToken),
    // Settings shows these read-only when the host owns them.
    managedByEnv: !!jiraConfigFromEnv()
  });
}

async function handleJiraConfigPost(req, res) {
  try {
    const body = await readBody(req);
    if (jiraConfigFromEnv()) {
      sendJson(res, 200, {
        ok: false,
        error: "Jira credentials come from environment variables on this deployment. Change them in your host's settings, not here."
      });
      return;
    }
    const existing = loadJiraConfig() || {};
    const next = {
      baseUrl: (body.baseUrl || "").trim(),
      email: (body.email || "").trim(),
      apiToken: body.apiToken ? body.apiToken.trim() : (existing.apiToken || "")
    };
    fs.writeFileSync(JIRA_CONFIG_FILE, JSON.stringify(next, null, 2));
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: "Couldn't save those Jira settings." });
  }
}

async function handleJiraConfigTest(res) {
  const config = loadJiraConfig();
  if (!config) {
    sendJson(res, 200, { ok: false, error: "Fill in site URL, email, and API token first." });
    return;
  }
  try {
    const response = await fetch(jiraMyselfPath(config.baseUrl), {
      headers: { Authorization: jiraAuthHeader(config), Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (response.status === 401 || response.status === 403) {
      sendJson(res, 200, { ok: false, error: "Jira rejected those credentials." });
      return;
    }
    if (!response.ok) {
      sendJson(res, 200, { ok: false, error: `Jira returned an unexpected error (${response.status}).` });
      return;
    }
    const data = await response.json();
    sendJson(res, 200, { ok: true, displayName: data.displayName || config.email });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: "Couldn't reach that Jira site." });
  }
}

// Extra ticket fields we auto-fill the booking form from — matched by
// display name (case-insensitive) rather than hardcoded customfield_XXXXX
// IDs, since those IDs are specific to one Jira site's field configuration.
// A name can map to more than one field (recreated across projects, etc.);
// pickFieldValue() picks whichever one actually has a value.
const AUTOFILL_FIELD_NAMES = ["ticket assignee", "account name", "branch", "repository", "start date", "due date"];

let fieldIdCache = null;
let fieldIdCacheAt = 0;
const FIELD_CACHE_TTL_MS = 10 * 60 * 1000;

async function loadFieldIdMap(config) {
  if (fieldIdCache && Date.now() - fieldIdCacheAt < FIELD_CACHE_TTL_MS) return fieldIdCache;
  try {
    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/rest/api/3/field`, {
      headers: { Authorization: jiraAuthHeader(config), Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return fieldIdCache || {};
    const fields = await response.json();
    const map = {};
    fields.forEach((f) => {
      const key = (f.name || "").toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(f.id);
    });
    fieldIdCache = map;
    fieldIdCacheAt = Date.now();
    return map;
  } catch (err) {
    return fieldIdCache || {};
  }
}

function pickFieldValue(issueFields, ids) {
  for (const id of ids || []) {
    const v = issueFields[id];
    const empty = v === null || v === undefined || (Array.isArray(v) && v.length === 0);
    if (!empty) return v;
  }
  return null;
}

// Single-value "labels" fields (Account Name, Branch) still come back as a
// one-element array from Jira's API — unwrap to a plain value.
function firstOf(v) {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

async function handleJiraLookup(key, res) {
  // Always 200 with {ok:false, error} on failure — the client only reads
  // the body, and a non-2xx status here just shows up as console noise for
  // an entirely expected condition (not configured, ticket not found, etc).
  if (!state.settings.jira.enabled) {
    sendJson(res, 200, { ok: false, error: "Jira integration is turned off in Settings." });
    return;
  }
  const config = loadJiraConfig();
  if (!config) {
    sendJson(res, 200, { ok: false, error: "Jira isn't configured yet — add your site URL and API token in Settings." });
    return;
  }

  try {
    const fieldMap = await loadFieldIdMap(config);
    const fieldIds = new Set(["summary", "status", "assignee"]);
    AUTOFILL_FIELD_NAMES.forEach((name) => (fieldMap[name] || []).forEach((id) => fieldIds.add(id)));

    const response = await fetch(jiraIssuePath(config.baseUrl, key, Array.from(fieldIds).join(",")), {
      headers: { Authorization: jiraAuthHeader(config), Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });

    if (response.status === 404) {
      sendJson(res, 200, { ok: false, error: `${key} wasn't found in Jira.` });
      return;
    }
    if (response.status === 401 || response.status === 403) {
      sendJson(res, 200, { ok: false, error: "Jira rejected the configured credentials." });
      return;
    }
    if (!response.ok) {
      sendJson(res, 200, { ok: false, error: `Jira returned an unexpected error (${response.status}).` });
      return;
    }

    const data = await response.json();
    sendJson(res, 200, {
      ok: true,
      key: data.key,
      summary: data.fields.summary || "",
      status: data.fields.status ? data.fields.status.name : "Unknown",
      statusCategory: data.fields.status ? data.fields.status.statusCategory.key : "new",
      assignee: data.fields.assignee ? data.fields.assignee.displayName : null,
      url: jiraBrowseUrl(config.baseUrl, data.key),
      ticketAssignees: pickFieldValue(data.fields, fieldMap["ticket assignee"]) || [],
      accountName: firstOf(pickFieldValue(data.fields, fieldMap["account name"])),
      branch: firstOf(pickFieldValue(data.fields, fieldMap["branch"])),
      repository: pickFieldValue(data.fields, fieldMap["repository"]) || [],
      startDate: pickFieldValue(data.fields, fieldMap["start date"]),
      dueDate: pickFieldValue(data.fields, fieldMap["due date"])
    });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: "Couldn't reach Jira from this server." });
  }
}

async function handleJiraComment(req, res) {
  try {
    const { key, comment } = await readBody(req);
    if (!jiraConfigured() || !key || !comment) {
      sendJson(res, 200, { ok: false, error: "Jira isn't configured, or nothing to comment on." });
      return;
    }
    const config = loadJiraConfig();
    const response = await fetch(jiraCommentPath(config.baseUrl, key), {
      method: "POST",
      headers: { Authorization: jiraAuthHeader(config), Accept: "application/json", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] }
      })
    });
    sendJson(res, 200, { ok: response.ok });
  } catch (err) {
    sendJson(res, 200, { ok: false, error: "Couldn't post that comment to Jira." });
  }
}

// ---------- Live reachability checks ----------
// Every server hosts all of its account's repos at once, each with its own
// URL — ping each independently. Any HTTP response at all (even 404/500)
// counts as reachable; only a request that can't complete (DNS failure,
// connection refused, timeout) marks that repo offline.

const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

async function isUrlReachable(url) {
  if (!url) return false;
  try {
    await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS) });
    return true;
  } catch (err) {
    return false;
  }
}

async function runHealthChecks() {
  const checks = [];
  state.servers.forEach((server) => {
    Object.keys(server.repos).forEach((repoName) => {
      const url = server.repos[repoName].url;
      // No URL yet isn't a failure to report as "offline" — it's just not
      // set up. Only a URL that's actually there and unreachable counts.
      if (!url) {
        checks.push(Promise.resolve({ serverId: server.id, repoName, health: "unconfigured" }));
        return;
      }
      checks.push(
        isUrlReachable(url).then((reachable) => ({
          serverId: server.id,
          repoName,
          health: reachable ? "online" : "offline"
        }))
      );
    });
  });

  const results = await Promise.all(checks);
  let changed = false;
  results.forEach(({ serverId, repoName, health }) => {
    const server = state.servers.find((s) => s.id === serverId);
    if (server && server.repos[repoName] && server.repos[repoName].health !== health) {
      server.repos[repoName].health = health;
      changed = true;
    }
  });
  if (changed) { persist(); broadcast(); }
}

// ---------- Bulk Jira sync ----------
// Instead of looking up one ticket at a time, this pulls every ticket Jira
// has touched recently in one search and derives each environment's
// occupancy from the results — no manual "book this ticket" step needed.
//
// A ticket claims its matched repos the moment its status first enters
// settings.jira.occupyingStatuses, and releases them the moment its status
// enters settings.jira.releasingStatuses. Any *other* status leaves an
// already-active claim untouched (e.g. QA FAILED doesn't free the
// environment — the ticket bounced back, it's still being worked). This
// means claims are stateful: they live in state.tickets and only sync()
// adds/removes them, never a plain "recompute from current status" pass.
//
// The search window (`updated >= -30d`) is a practical bound, not a
// guarantee: a claim that's genuinely still open but hasn't been touched
// in Jira for 30+ days won't be re-confirmed by a sync pass, but it also
// won't be silently dropped — it just stays claimed until the ticket is
// updated again (or someone hits Force free).

// Plain time-based expiry — independent of Jira, applies to every claim
// (manual or jira-sourced) that has an endTime. Only acts when
// settings.onExpiry is "auto-release"; "remind"/"remind-flag" are display-
// only and need no server-side action.
function runExpiryChecks() {
  if (state.settings.onExpiry !== "auto-release") return;
  const now = Date.now();
  const before = state.tickets.length;
  state.tickets = state.tickets.filter((t) => !(t.endTime && new Date(t.endTime).getTime() <= now));
  if (state.tickets.length !== before) { persist(); broadcast(); }
}

const JIRA_SYNC_WINDOW = "updated >= -30d ORDER BY updated DESC";
const JIRA_SYNC_PAGE_SIZE = 100;
// Bounds one sync at 500 issues so a large backlog can't stall the poll.
const JIRA_SYNC_MAX_PAGES = 5;
let lastJiraSyncAt = 0;
let lastJiraSyncError = null;

// Uses /rest/api/3/search/jql — the old /rest/api/3/search was removed by
// Atlassian and now answers 410. The replacement pages with an opaque
// nextPageToken cursor rather than startAt, and reports the end with isLast.
async function fetchJiraSearchIssues(config, fieldIds) {
  const jql = encodeURIComponent(JIRA_SYNC_WINDOW);
  const fields = encodeURIComponent(Array.from(fieldIds).join(","));
  const base = normalizeBaseUrl(config.baseUrl);
  const issues = [];
  let token = null;

  for (let page = 0; page < JIRA_SYNC_MAX_PAGES; page++) {
    const cursor = token ? `&nextPageToken=${encodeURIComponent(token)}` : "";
    const url = `${base}/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=${JIRA_SYNC_PAGE_SIZE}${cursor}`;
    const response = await fetch(url, {
      headers: { Authorization: jiraAuthHeader(config), Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Jira search returned ${response.status}`);
    const data = await response.json();
    issues.push(...(data.issues || []));
    token = data.nextPageToken;
    if (data.isLast || !token) break;
  }
  return issues;
}

function extractTicketFields(issue, fieldMap) {
  const f = issue.fields;
  return {
    key: issue.key,
    summary: f.summary || "",
    status: f.status ? f.status.name : "Unknown",
    statusCategory: f.status ? f.status.statusCategory.key : "new",
    ticketAssignees: pickFieldValue(f, fieldMap["ticket assignee"]) || [],
    accountName: firstOf(pickFieldValue(f, fieldMap["account name"])),
    branch: firstOf(pickFieldValue(f, fieldMap["branch"])),
    repository: pickFieldValue(f, fieldMap["repository"]) || [],
    startDate: pickFieldValue(f, fieldMap["start date"]),
    dueDate: pickFieldValue(f, fieldMap["due date"])
  };
}

function statusIn(list, statusName) {
  return (list || []).some((s) => s.trim().toLowerCase() === (statusName || "").trim().toLowerCase());
}

async function runJiraSync(force) {
  if (!state.settings.jira.enabled) return { ok: false, reason: "disabled" };
  if (!force && !state.settings.jira.autoSync) return { ok: false, reason: "auto-sync-off" };
  const config = loadJiraConfig();
  if (!config) return { ok: false, reason: "not-configured" };

  const intervalMs = Math.max(1, state.settings.jira.pollIntervalMinutes || 1) * 60000;
  if (!force && Date.now() - lastJiraSyncAt < intervalMs) return { ok: false, reason: "throttled" };
  lastJiraSyncAt = Date.now();

  try {
    const fieldMap = await loadFieldIdMap(config);
    const fieldIds = new Set(["summary", "status"]);
    AUTOFILL_FIELD_NAMES.forEach((name) => (fieldMap[name] || []).forEach((id) => fieldIds.add(id)));

    const issues = await fetchJiraSearchIssues(config, fieldIds);
    const jira = state.settings.jira;
    const skipped = [];
    const waiting = [];

    issues.forEach((issue) => {
      const t = extractTicketFields(issue, fieldMap);
      const existing = state.tickets.find((tk) => tk.id === t.key && tk.source === "jira");

      if (existing) {
        if (statusIn(jira.releasingStatuses, t.status)) {
          state.tickets = state.tickets.filter((tk) => tk !== existing);
        } else {
          // Sticky: repos/serverId/userIds don't move mid-claim — only the
          // display-facing fields refresh each pass.
          existing.status = t.status;
          existing.summary = t.summary;
          existing.lastSyncedAt = new Date().toISOString();
        }
        return;
      }

      if (!statusIn(jira.occupyingStatuses, t.status)) {
        // Not claiming anything yet. If it still matches a real environment
        // it's worth surfacing — the row can then say "N more tickets on
        // this branch aren't in QA testing yet, so they hold nothing".
        // Releasing and terminal statuses are done with the environment,
        // not waiting on it.
        if (!statusIn(jira.releasingStatuses, t.status) && !statusIn(JIRA_TERMINAL_STATUSES, t.status)) {
          const match = findServerForTicket(t, state.accounts, state.servers);
          if (match.server) {
            waiting.push({ key: t.key, serverId: match.server.id, status: t.status, summary: t.summary });
          }
        }
        return;
      }

      const { server, error } = findServerForTicket(t, state.accounts, state.servers);
      if (error) {
        skipped.push({ key: t.key, reason: error, status: t.status, accountName: t.accountName, branch: t.branch });
        return;
      }

      if (!t.repository || !t.repository.length) {
        skipped.push({ key: t.key, reason: "Repository field is empty.", status: t.status, accountName: t.accountName, branch: t.branch });
        return;
      }
      const repoCheck = matchRepositoriesToKeys(t.repository, Object.keys(server.repos));
      if (!repoCheck.matched.length) {
        skipped.push({ key: t.key, reason: `Repository field ("${t.repository.join(", ")}") doesn't match any repo on ${server.name}.`, status: t.status, accountName: t.accountName, branch: t.branch });
        return;
      }

      const userMatch = matchUserIdsByLabels(t.ticketAssignees, state.users);
      const startTime = t.startDate ? new Date(`${t.startDate}T09:00`).toISOString() : new Date().toISOString();
      const endTime = t.dueDate ? new Date(`${t.dueDate}T18:00`).toISOString() : null;

      state.tickets.push({
        id: t.key,
        source: "jira",
        serverId: server.id,
        accountName: t.accountName,
        branch: t.branch,
        repos: repoCheck.matched,
        userIds: userMatch.matched,
        rawAssignees: t.ticketAssignees,
        status: t.status,
        summary: t.summary,
        note: null,
        startTime,
        endTime,
        claimedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString()
      });
    });

    state.jiraSkipped = skipped;
    state.jiraWaiting = waiting;
    lastJiraSyncError = null;
    state.lastJiraSyncAt = new Date().toISOString();
    // jiraSkipped/lastJiraSyncAt update every pass regardless of `changed` —
    // always worth a broadcast so the sync bar's "synced Xs ago" stays live.
    persist();
    broadcast();
    return { ok: true, issueCount: issues.length, skippedCount: skipped.length };
  } catch (err) {
    lastJiraSyncError = err.message || "Jira sync failed.";
    return { ok: false, reason: "error", error: lastJiraSyncError };
  }
}

runHealthChecks();
setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS);
setInterval(runExpiryChecks, HEALTH_CHECK_INTERVAL_MS);
runJiraSync(true).catch(() => {});
setInterval(() => runJiraSync(false).catch(() => {}), 20000);

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const relative = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(ROOT, decodeURIComponent(relative)));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/state" && req.method === "GET") {
    sendJson(res, 200, state);
    return;
  }

  if (req.url === "/api/state" && req.method === "POST") {
    readBody(req).then((parsed) => {
      if (!parsed.users || !parsed.accounts || !parsed.servers) {
        sendJson(res, 400, { ok: false, error: "Invalid state payload" });
        return;
      }
      if (!Array.isArray(parsed.tickets)) parsed.tickets = [];
      if (!parsed.notes) parsed.notes = {};
      if (!Array.isArray(parsed.jiraSkipped)) parsed.jiraSkipped = state.jiraSkipped || [];
      if (!Array.isArray(parsed.jiraWaiting)) parsed.jiraWaiting = state.jiraWaiting || [];
      if (!parsed.settings) parsed.settings = state.settings;
      state = parsed;
      persist();
      broadcast();
      sendJson(res, 200, { ok: true });
    }).catch(() => sendJson(res, 400, { ok: false, error: "Invalid state payload" }));
    return;
  }

  if (req.url === "/api/jira-config" && req.method === "GET") {
    handleJiraConfigGet(res);
    return;
  }
  if (req.url === "/api/jira-config" && req.method === "POST") {
    handleJiraConfigPost(req, res);
    return;
  }
  if (req.url === "/api/jira-config/test" && req.method === "POST") {
    handleJiraConfigTest(res);
    return;
  }
  if (req.url === "/api/jira/comment" && req.method === "POST") {
    handleJiraComment(req, res);
    return;
  }
  if (req.url === "/api/jira/sync-now" && req.method === "POST") {
    runJiraSync(true).then((result) => sendJson(res, 200, result)).catch(() => sendJson(res, 200, { ok: false, reason: "error" }));
    return;
  }

  const jiraMatch = req.url.match(/^\/api\/jira\/([A-Za-z][A-Za-z0-9]*-\d+)$/);
  if (jiraMatch && req.method === "GET") {
    handleJiraLookup(jiraMatch[1].toUpperCase(), res);
    return;
  }

  if (req.url === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server Management running at http://localhost:${PORT}`);
  console.log("Share this port via VS Code Live Share (Shared Servers) so other viewers stay in sync.");
});
