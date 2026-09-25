# 04 — Migration plan

From the vanilla/file-based app to Next.js + Vercel + Neon + Pusher + Blob, with chat added on top.

**Read this first: this is a rewrite, not a feature.** Chat is roughly the last third of the work.
The first two thirds is moving an app that assumes a persistent process with local disk onto a platform
that offers neither. Sequencing it as "add chat" would mean building chat on foundations that are about
to be replaced.

Every phase has **exit criteria**. A phase is not done because the code exists; it is done when the
criteria pass. Phases 1–8 must not regress any behaviour listed in the
[parity checklist](#parity-checklist).

---

## Phase 0 — Decisions and provisioning

No application code.

- [ ] Answer the blocking questions in [06-OPEN-QUESTIONS.md](06-OPEN-QUESTIONS.md): ~~**Q1 (health
      checks)**~~ answered 2026-08-21, **Q3 (IP allowlist), Q4 (chat identity)**. The rest can be
      answered later; these three change the schema or the architecture.
- [ ] Create the Neon project. Note **both** connection strings (pooled and direct).
- [ ] Create the Pusher Channels app. Note cluster, key, secret, app id. Decide whether client events
      stay disabled (recommended — see [03-REALTIME-SPEC.md](03-REALTIME-SPEC.md) §6).
- [ ] Create the Vercel project and the Blob store.
- [ ] Confirm the Vercel plan's **cron frequency limit** and **function timeout**. A 20-second Jira
      poll is not achievable; establish what is.
- [ ] Reconcile `package-lock.json`. It declares `@neondatabase/serverless` and the name
      `server-manager` while `package.json` declares no dependencies and the name `server-management`.
      Delete the stale lockfile and regenerate.
- [ ] Environment variables, in Vercel and in `.env.local`:

```
DATABASE_URL                 Neon pooled connection string
DATABASE_URL_UNPOOLED        Neon direct — migrations only
SESSION_COOKIE_SECRET        (if signing the cookie; the token itself stays opaque)
ALLOWED_IPS                  replaces config/allowed-ips.json (no writable disk)
CRON_SECRET                  cron routes reject anything without it
PUSHER_APP_ID                server only
PUSHER_SECRET                server only — NEVER prefixed NEXT_PUBLIC_
NEXT_PUBLIC_PUSHER_KEY       public by design, ships in the bundle
NEXT_PUBLIC_PUSHER_CLUSTER
BLOB_READ_WRITE_TOKEN        set by the Vercel Blob integration
JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN
ADMIN_USERNAME / ADMIN_PASSWORD   first-run super admin
```

**Exit:** every service provisioned, every variable set in both environments, three blocking questions
answered in writing in [06-OPEN-QUESTIONS.md](06-OPEN-QUESTIONS.md).

---

## Phase 1 — Next.js scaffold, in place, old app untouched

The existing `server/` and `public/` keep running. Nothing is deleted until Phase 13.

- Next.js App Router + TypeScript + Tailwind (real build step — this retires the runtime CDN compile).
- **Port the design tokens first.** `public/js/ui/tokens.js` and the `@theme` block in
  `public/index.html` are the semantic palette (`bg-surface`, `text-muted`, and dark mode as one set of
  variable overrides with no `dark:` variant on any component). That system is good; move it to
  `tailwind.config` + CSS variables and keep the rule that components never name a literal colour.
- Port `public/js/ui/html.js` to `components/ui/*` — `Button`, `Table`, `Chip`, `DotChip`, `Avatar`,
  `AvatarStack`, `RepoStrip`, `StatTile`, `Notice`, `Modal`, `Field`, `Toggle`.
- Port `shared/data.js` into typed modules: `lib/shared/roles.ts` (`AUTH_ROLES` — **keep the one-list,
  enforced-twice property**), `lib/shared/occupancy.ts`, `lib/jira/matching.ts`.
- App shell: sidebar nav, topbar, theme switcher, account menu. Static data, no DB yet.

**Exit:** `next build` passes; the shell renders in light and dark; a Storybook-or-equivalent page
shows every ported primitive; `AUTH_ROLES` is imported by at least one client and one server module.

---

## Phase 2 — Schema and migration runner

- `lib/db/schema.sql` and `lib/db/migrations/0001_init.sql` from
  [02-DATA-MODEL.md](02-DATA-MODEL.md).
- `lib/db/client.ts`: the HTTP driver for one-shot queries, a pooled `Pool` for transactions, and a
  comment at each export saying which to reach for.
- `scripts/migrate.ts` — forward-only, tracked in `schema_migrations`, run against
  `DATABASE_URL_UNPOOLED`.
- `lib/db/queries/` skeletons per aggregate: `board`, `claims`, `chat`, `auth`, `jira`.

**Exit:** migrations apply to a clean Neon branch and are idempotent on re-run; every table, index and
constraint from doc 02 exists; a smoke test inserts and reads one row through each driver mode.

---

## Phase 3 — One-shot data import

The only time old and new storage touch.

- `scripts/import-legacy.ts` reads `shared-data/*.json` and `config/auth.json` and writes Postgres.
- **Run `migrateAppData()` from `shared/data.js` once, during the import**, to normalise old on-disk
  shapes. Then it is done forever — Postgres has a schema, so the runtime migration machinery does not
  come along.
- Mapping that needs care:
  - `notes.json` keys are `` `${serverId}::${repoName}` `` → split into `server_repos.note`.
  - `claims.repos[]` / `userIds[]` / `rawAssignees[]` → the three join tables.
  - `users[].jiraNames[]` → `directory_user_jira_names`, and **the global uniqueness index will reject
    duplicates**. Real duplicates in the current data must be resolved by hand before import, not
    silently coalesced — an ambiguous Jira label is exactly the bug that index exists to prevent.
  - `auth.json` sessions are **not** imported. Everyone signs in again once. Importing live tokens
    would mean writing plaintext tokens into the new store, which
    [02-DATA-MODEL.md](02-DATA-MODEL.md) explicitly moves away from.
  - `auth.json` `directoryUserId` links carry over as-is. Accounts that the old
    `linkAccountsToDirectory()` never resolved stay unlinked and get reported by the script.
- The script must be **re-runnable into a clean database** and must print a reconciliation summary:
  counts in, counts out, and every row it refused.

**Exit:** row counts match the JSON; a spot-check of three environments shows identical derived
occupancy under `lib/shared/occupancy.ts` and the old `getDisplayStatus()`; the script's refusal list
is empty or every entry has a documented decision.

---

## Phase 4 — Auth and the gate

- `middleware.ts` (Edge): IP allowlist, then a **cookie-presence** check only. Not the security
  boundary.
- `lib/auth/password.ts`: `scrypt` + per-user salt + `timingSafeEqual`, unchanged in substance.
  Node runtime.
- `lib/auth/session.ts`: create / resolve / revoke. Store **SHA-256 of the token**, never the token.
- `lib/auth/require.ts`: `requireUser(capability)` — the real boundary, called by every route handler
  and every protected Server Component.
- Login lockout moves from process memory to `auth_login_attempts`.
- Cookie gains **`Secure`** (Vercel is HTTPS; the old comment explaining its absence no longer applies).
- Routes: `/api/auth/{login,logout,me,password}`, `/api/auth/users/**`.
- First-run super admin seed from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

**Exit:** all four roles behave exactly as the table in
[00-CONTEXT-CURRENT-SYSTEM.md](00-CONTEXT-CURRENT-SYSTEM.md); a role change or deactivation kills
open sessions immediately; a non-allowlisted IP gets a bare `403` on **every** path including static
assets and the login page; lockout survives a redeploy.

---

## Phase 5 — Board read and write

The phase that retires the whole-board POST.

- Server Components read through `lib/db/queries/board.ts`. No client-side board fetch, no `appData`,
  no `localStorage` cache.
- Pages: dashboard, environments, environment detail, health, tickets, my-tickets, in-use,
  not-tracked, users, settings.
- **Granular** mutation routes: `claims`, `notes`, `servers`, `accounts`, `directory`, `settings` —
  each touching the rows it names, inside a transaction.
- `POST /api/state` is not reimplemented. There is no endpoint that replaces the board.

**Exit:** every page renders from Postgres; two browsers editing different environments concurrently
both keep their change (the pre-existing clobber bug is gone); a `member` role's attempt to change
settings is refused by the server, not merely hidden; no route accepts more than the entity it names.

---

## Phase 6 — Jira and scheduled work

- `lib/jira/client.ts` + `sync.ts` ported. Keep the two subtleties that are easy to lose:
  - the `OR key IN (…held keys…)` clause, without which a ticket that reaches `DONE` holds its
    environment forever;
  - **claims are sticky** — only a *releasing* or terminal status frees one; every other status leaves
    it alone.
- `jira_issues` / `jira_skipped` / `jira_sync_state` are now **persisted**, because there is no process
  memory to hold them (see [02-DATA-MODEL.md](02-DATA-MODEL.md) §2).
- Cron routes under `app/api/cron/`, declared in `vercel.json`, each rejecting a request without
  `CRON_SECRET`.
- Jira config moves from `config/jira-config.json` to env vars. The settings UI shows the fields
  read-only, as the README already describes for deployments. **The token is never returned to the
  client, masked or otherwise, beyond what the current config route already does.**
- ✅ **Q1 applied (2026-08-21).** No on-prem agent was needed — every configured URL is public, so
  `lib/health/check.ts` probes them from the function itself and writes `server_repos.health` and
  `health_checked_at`. Cron (`/api/cron/health`), an hourly timer on the Health page, and a **Check
  servers** button all trigger the same pass. The UI still says *"not checked"* rather than
  `offline` for anything unmeasured, because that rule is about honesty, not about who does the
  measuring — the whole board would otherwise paint red and `issue` would outrank real claim state.

**Exit:** a cron-triggered sync produces the same claims the old sync produces from the same Jira data;
an unauthenticated call to any cron route is refused; the Not-tracked page lists the same skip reasons;
health state is either genuinely reported or honestly labelled as unknown.

---

## Phase 7 — Pusher foundation, board events only

Chat is still not started. This phase proves the realtime layer on the feature that already exists.

- `lib/realtime/{server,channels,events}.ts` — typed publish, channel builders/parsers, the event union.
- `/api/pusher/auth` with default-deny parsing (`private-board` and `presence-org` only for now).
- `PusherProvider` with a strict singleton guard, and a visible connection-state indicator replacing
  the old sync dot.
- Publish the board events from Phase 5's routes and Phase 6's crons — **after commit**.
- Implement **catch-up on `connected`** now, not later. It is the mechanism that stops the app losing
  updates across a reconnect, and retrofitting it after chat exists means shipping a chat that drops
  messages.
- Batch or coalesce the health cron's publishes.

**Exit:** a change in one browser appears in another within a second without a reload; killing the
network for 30 seconds and restoring it leaves both browsers consistent (catch-up works); the auth
endpoint refuses a hand-crafted subscription to a channel the user should not see; one health cron pass
publishes a small bounded number of messages, not one per repo.

---

## Phase 8 — Chat API

- Routes: `conversations` (list, create), `conversations/:id/messages` (paginate, send),
  `conversations/:id/read`, `typing`.
- Membership check on **every** read and write. Rate limits from
  [03-REALTIME-SPEC.md](03-REALTIME-SPEC.md) §10.
- Send is one transaction — insert with `ON CONFLICT (conversation_id, client_msg_id) DO NOTHING`,
  bump `last_message_at`, advance the sender's own watermark — then publish.
- DM creation relies on the `dm_key` unique index and handles the conflict by returning the existing
  conversation rather than erroring.
- Add the `chat` capability to `AUTH_ROLES` per the **Q2** decision.

**Exit:** a non-member is refused on read, write and subscribe; posting the same `clientMsgId` twice
creates one row; keyset pagination returns a stable ordering with no gaps or repeats across pages;
sending 30 messages in 10 seconds is rate-limited.

---

## Phase 9 — Chat UI

- `app/(app)/chat/page.tsx` and `chat/[conversationId]/page.tsx`; one nav entry.
- `ConversationList`, `MessageList`, `Composer`, `TypingRow`, `PresenceDot`.
- **The message list keeps its own append-only local state**, reconciling optimistic sends by
  `clientMsgId`. It must not be inside whatever refresh mechanism the rest of the page uses — a
  wholesale re-render on each incoming message destroys scroll position, selection and the composer.
- Escape every message body. Chat is the first place users type text other users read; the old
  codebase centralised escaping in `H.esc` and React gives it by default — but any
  `dangerouslySetInnerHTML` for link or markdown rendering re-opens it. If rich text is wanted, that
  is a sanitiser decision, not a `dangerouslySetInnerHTML` decision.

**Exit:** two browsers hold a conversation with sub-second delivery; scroll position survives incoming
messages; a message pasted with `<img onerror=…>` renders as text; reloading mid-conversation restores
the same thread at the same place.

---

## Phase 10 — Presence, typing, read receipts

- `presence-org` drives online/offline; `PresenceDot` on avatars.
- Pusher webhook → `/api/pusher/webhook`, **signature verified**, updating `auth_users.last_seen_at`.
- Typing: 3-second client throttle, 4-second receiver timeout, no stop event.
- Read state: watermark advanced on view; `read.changed` published; unread counts derived.

**Exit:** closing a laptop marks the user offline within Pusher's timeout and "last seen" persists; a
user with three tabs appears once; unread counts survive a reload and match a fresh DB query.

---

## Phase 11 — Attachments (Vercel Blob)

- `POST /api/chat/attachments/upload-url` mints a short-lived client-upload token; capability check,
  MIME allowlist and size cap live **here**, not in the browser.
- Browser uploads **directly to Blob** — the serverless body limit makes any server-proxied upload a
  dead end for real files.
- Insert `chat_attachments` and the `kind = 'attachment'` message in one transaction after upload.
- Apply the **Q6** decision on Blob privacy. Blob URLs are unguessable but publicly readable, so a URL
  is a capability that outlives conversation membership. If that is unacceptable, never hand out the
  raw URL — proxy through `/api/chat/attachments/[id]` behind a membership check.
- Retention cron deletes blobs for hard-deleted messages, or they accumulate as billable orphans.

**Exit:** a 20 MB file uploads and renders; a non-member cannot fetch it (or the capability-URL
trade-off is written down and accepted); an oversized or disallowed type is refused server-side even
when the client is bypassed; deleting a message removes its blob.

---

## Phase 12 — Notifications

- `private-user-<id>`: `unread.changed`, `conversation.added`, `session.revoked`.
- Unread badges reuse the existing nav-badge pattern; document title flash when the tab is hidden.
- Coalesce `unread.changed` — published naively it is one message per non-sender per message, which
  multiplies a group chat's cost by its member count.

**Exit:** an unread badge appears without a reload; `session.revoked` returns the tab to the sign-in
screen immediately on a role change; a 10-person group chat message does not fan out to 10+ separate
notification publishes.

---

## Phase 13 — Tests, cutover, decommission

The current repo has **zero tests** and `npm test` is a stub, so this is greenfield. Prioritise the
places where a bug is a privacy incident rather than a glitch:

1. `/api/pusher/auth` — channel parsing and membership. Highest value test in the codebase.
2. `requireUser(capability)` across all four roles × every route.
3. Idempotent send (duplicate `clientMsgId`).
4. Keyset pagination boundaries.
5. Watermark and unread arithmetic.
6. Occupancy derivation against fixtures taken from the current board.
7. Jira sync stickiness and the held-keys clause.

**Cutover:**

- [ ] Freeze the old app (announce it; make it read-only if practical).
- [ ] Re-run the import against production Neon; check the reconciliation summary.
- [ ] Walk the [parity checklist](#parity-checklist) on the deployed app.
- [ ] Switch the team over. Everyone signs in again (sessions were not imported).
- [ ] Keep the old app **and its `shared-data/` snapshot** available, untouched, for one sprint.
- [ ] Only then delete `server/`, `public/index.html`, `public/js/`, `shared/`, `config/`, and archive `shared-data/`. Preserve `public/`: the PWA uses `sw.js`, `offline.html` and `icons/`.
- [ ] Write the `DEPLOY.md` that `README.md` already links to and that has never existed.

---

## Parity checklist

Nothing ships to the team until every line passes on the deployed app.

| # | Behaviour |
|---|---|
| 1 | A non-allowlisted address gets a bare `403` on every path — API, static assets, and the login page |
| 2 | The four roles grant exactly the capabilities in doc 00 |
| 3 | Role change, password change or deactivation ends every open session **immediately** |
| 4 | Login lockout: 8 failures then 10 minutes, surviving a redeploy |
| 5 | Occupancy is derived, and an offline repo outranks claim state |
| 6 | A partly-free environment renders as partial, per repo |
| 7 | Jira matching is Account Name + Branch + Repository, case-insensitive exact, no fuzzy matching |
| 8 | Unmatchable tickets appear on Not tracked with the reason and the fix |
| 9 | Claims are sticky: only a releasing or terminal status frees one |
| 10 | A ticket at `DONE` releases its environment (the held-keys clause works) |
| 11 | Time-based expiry only acts when `onExpiry = auto-release` |
| 12 | A `member` cannot change settings, accounts, environments or the directory — refused server-side |
| 13 | The Jira API token never reaches the client |
| 14 | My tickets resolves through the account → directory-person link, not a stored copy |
| 15 | One person, one login — a second login for the same person is refused |
| 16 | Concurrent edits to different entities do not clobber each other |
| 17 | A change in one browser reaches another within a second, without a reload |
| 18 | A 30-second network outage leaves every browser consistent afterwards |
| 19 | Health state is either genuinely reported or honestly labelled unknown — never a false `offline` |
| 20 | A private message is never delivered to a non-member of its conversation |
