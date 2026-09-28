# AGENTS.md

Context for AI sessions in this repo. Read this first, then the doc it points you at.

## What this project is

**Glophics** — a board tracking which QA/staging environments are free and which are held by a
Jira ticket, so nobody has to ask in chat before deploying.

Accounts (clients) own environments; each environment has repository slots (`storefront`, `backend`,
`admin`); a Jira ticket claims one or more repos of one environment, so an environment can be *partly
free*.

## Current state — read this before assuming anything

There are **two codebases in this repo**, and mixing them up is the main hazard.

| | Where | State |
|---|---|---|
| **New — build here** | `app/`, `lib/`, `components/`, `middleware.ts`, `scripts/` | Next.js 15 + TypeScript + Neon Postgres. Board, auth, Jira and cron are ported and building. |
| **Legacy — do not extend** | `server/`, `public/`, `shared/`, `shared-data/`, `config/` | The original zero-dependency Node app. Still runnable with `npm run legacy`. Kept only as a reference and a data source until cutover. |

**Default to the new codebase.** The legacy tree is deleted at Phase 13 of
`docs/04-MIGRATION-PLAN.md`; anything added to it is thrown away. Read the old files freely — they are
the best documentation of intended behaviour — but write in `app/` and `lib/`.

### What is done, and what is not

| Phase | |
|---|---|
| 1–6 | ✅ Scaffold, schema, import script, auth + gate, board read/write, Jira sync + cron |
| 7 | ✅ Pusher realtime — board, per-user and per-conversation channels, reconnect catch-up |
| 8–9 | ✅ Chat: DMs, groups, message reactions, read watermarks, typing, unread badge + toasts |
| 10 | ✅ Presence, avatars (people and groups) |
| 11 | ✅ Attachments, reply threads, clickable links with previews, live ordering, @mentions |
| 12 | 🟡 Notification centre/history and live toasts are done; scheduled digests remain |
| — | ✅ Team task viewer (`/team`), gated on the new `oversee` capability |
| 13 | ⬜ Cutover and deleting the legacy tree |

**Chat is real and worth reading before touching.** Attachments and reply threads are the newest part;
reactions and group management came just before them:

- **Reactions** are `chat_message_reactions`, keyed `(message, user, emoji)` — the primary key *is* the
  duplicate prevention, and the toggle is one `DELETE … RETURNING` so two taps cannot race into two
  rows. The allowed emoji live in `lib/chat/reactions.ts` and nowhere else. Deleting a message
  soft-deletes the message and **hard**-deletes its reactions.
- **Groups** were half-present from the start (`chat_conversations.kind`, `chat_members.member_role`);
  what 0004 added is the `admin` tier, a one-owner-per-group index, a group avatar, and system
  messages. Permissions are pure functions in `lib/chat/groups.ts`, called by the browser to hide a
  control and by every mutation to refuse one.
- **System messages** ("Alex added Jamie") are ordinary `chat_messages` rows with `kind = 'system'`, so
  they inherit ordering, pagination, unread and the list preview. Their text is baked at write time on
  purpose — see `docs/02-DATA-MODEL.md`.
- **Attachments** are `chat_attachments` — metadata in Postgres, bytes in Vercel Blob. The thing to
  understand before touching them: **`message_id IS NULL` means "staged, not sent"**. A file uploads
  the moment it is picked (so the composer can show progress and a failure while you can still act on
  it), which means it exists before its message does. `claimAttachments` attaches it inside the send
  transaction, and the retention cron sweeps whatever was abandoned. All four of that function's
  `WHERE` conditions are load-bearing — read the comment before editing it.
- **GIFs skip the optimiser, and must keep doing so.** It returns a STATIC WebP for an animated GIF
  (verified against the live service), and refuses anything over 4 MB — so GIFs were being flattened
  to their first frame, renamed `.webp`, or failing outright. `isStoredVerbatim()` in
  `lib/chat/attachments.ts` is the switch. Two consequences: nothing decodes the bytes any more, so
  the route checks the magic number itself (`looksLikeGif`) and reads dimensions from the header
  (`gifDimensions`); and since nothing shrinks them, GIFs have their own 12 MB cap.
- **Attachment bytes are never served from the store.** It is a *private* Blob store: a blob URL
  answers 403 unauthenticated, so downloads go through `/api/chat/attachments/[id]`, which re-checks
  membership on every read. `blob_url` must never reach a client. This is the answer to Q6, and it
  came from probing the live store — see `docs/06-OPEN-QUESTIONS.md` **Q6**.
- **Links are clickable, and carry an Open Graph card.** Linkifying does NOT use
  `dangerouslySetInnerHTML` and must never start to: `lib/chat/links.ts` splits a body
  into text/link segments and the renderer emits React children, so invariant 7 holds
  unchanged. Only http and https become anchors — checked on a *parsed* URL's protocol,
  so `javascript:` renders as text.
- **The preview fetcher is the app's SSRF surface.** `lib/link-preview/fetch.ts` fetches a
  URL a *user* supplied. Read its header before touching it: scheme allowlist, DNS
  resolution with a private/loopback/link-local IP check, **manual** redirect following that
  re-checks every hop, a byte cap, a timeout, and HTML-only. The remote `og:image` is never
  given to a browser — it goes through `/api/chat/link-preview/image` so no third-party host
  gets a read receipt for your conversations. Run `npm run verify:link-preview` (51 checks).
- **Conversation ordering is live, and merged — not refetched.** `lib/chat/ordering.ts` folds the
  activity collected from `unread.changed` over the server's rows. Two things to know before
  touching it: `notificationTargets` now returns **every** member tagged `muted`/`isSender` rather
  than filtering them out, because a muted thread and the sender's own second tab both have to
  reorder — mute moved to the client, which can tell "don't interrupt me" from "don't tell me". And
  the sender's *own* tab is excluded from its Pusher fan-out by socket id, so it calls `bump()`
  directly; without that the conversation rises for everyone except the person who wrote in it.
- **Mentions store an id, not a name.** The **stored body** carries `@[Display Name](uuid)`, but the **composer never does** — it holds plain `@Name` plus a list of ranges, serialised only at send (`insertMention`/`adjustMentions`/`serializeMentions`), because a textarea shows whatever is in it and nobody should be shown a uuid
  (`lib/chat/mentions.ts`), so the rendered name follows a rename; the name in the token is only a
  fallback for somebody who has left. Anything that MEASURES or SUMMARISES a body must use
  `plainText()` first — the length limit, the list preview and the toast all do, or a uuid nobody
  typed gets counted and displayed. `chat_message_mentions` exists to answer "which messages mention
  me" without a LIKE over every body. **Every place that previews or measures a body must call
  `plainText()`** — the conversation list, the reply quote, the toast and the length check all do,
  and each one was a separate bug that showed a raw uuid to somebody. Non-members are filtered server-side in `sendMessage`; the
  picker only offering members is courtesy. Run `npm run verify:chat:mentions` (15 checks).
- **Desktop notifications are the Notification API, not Web Push.** `lib/notify/desktop.ts`, opt-in
  from the account menu, permission requested only on the click. They fire while a tab is open —
  background, minimised, behind other windows — and **not** when the site is closed. Notifying a
  closed site needs a Service Worker plus Web Push/VAPID and a stored per-device subscription; the
  toggle says "Only while a tab is open" so the setting is not read as more than it is.
- **Read receipts are Messenger-style faces, not ticks.** `lib/chat/receipts.ts` turns the
  one-number-per-member watermark (ADR-006) into a position: each person's avatar appears **once**, on
  the newest loaded message at or below their watermark. A watermark above the page lands on the
  newest message shown; one below the page shows nothing rather than guessing. The single ✓ now means
  only "sent, nobody has caught up".
- **Replies** needed no schema change: `reply_to_id` has been there since 0001. The quote is resolved
  on **read**, deliberately — the opposite of system messages, whose text is baked at write time. Both
  choices are explained in `docs/02-DATA-MODEL.md`.

Verify against a real database with `npm run verify:chat:social` (61), `npm run verify:chat:files`
(52, hits the real blob store), `npm run verify:chat:mentions` (15) and `npm run verify:link-preview`
(51, makes real outbound requests); `npm run verify:chat` (32) covers the DM, pagination and
notification-target behaviour none of them must have broken.

**The ticket tables are paged by Postgres, not by JavaScript.** `/tickets` and `/my-tickets` take
`?page=N` and ask `lib/db/queries/tickets.ts` for ten rows, so neither page fetches the whole Jira
cache any more. Three things to know before touching it:

- **The list is two tables concatenated** — every claim holding a repository, then every other issue
  the last sync saw. The sync keeps `claims` and `jira_issues` **disjoint** (the `record()` versus
  `toClaim.push()` branches in `lib/jira/sync.ts`), and because every claim sorts before every issue a
  page is a slice of one block or the tail of one plus the head of the other. That is why there is a
  count query and some arithmetic rather than a UNION ALL — and why page 1 never touches
  `jira_issues` at all.
- **Every ORDER BY ends in a unique column, and that is load-bearing.** Most rows have no `end_time`,
  and every claim written by one sync pass shares `claimed_at` to the millisecond — two of them do on
  the current board. Without the final `id` / `key` tiebreak those ties make OFFSET show one row twice
  and lose another. The old unpaged `ORDER BY claimed_at DESC` left them genuinely undetermined.
- **`mine` is the one rule written twice.** The filter has to sit next to LIMIT or the count and the
  page disagree, so the SQL reimplements `claimIsMine`. Only the *matching* is duplicated —
  `identityValues()` still runs in JS and its strings are passed down as a parameter.

- **`/my-tickets` also filters by status, and the chips are counted in SQL.** `?status=` goes down
  next to LIMIT for the same reason `mine` does. The per-status counts come from one `GROUP BY` that
  also produces the pager's totals, so a chip reading 13 cannot sit above a pager reading 12 — and the
  chips are deliberately *not* narrowed by the filter, or picking a second status would be impossible.
  `statusKey()` is the one place a status is normalised; the SQL spells the same thing as
  `lower(COALESCE(NULLIF(btrim(status), ''), 'Unknown'))`.

- **`/tickets` is gated; `/my-tickets` is not.** Active tickets needs the `all-tickets` capability —
  `superadmin` and `admin` (`docs/05-DECISIONS.md` **ADR-016**). It is the team's backlog, which is a
  lead's view; a member gets My tickets, the board and the environments. `requireUser("all-tickets")`
  runs before any query on that page, the nav entry is gated on the same capability, and reusing
  `configure` — held by exactly those two roles today — was rejected for ADR-012's reason.

- **The two pages differ in one argument, and it matters.** `/tickets` passes
  `hideStatuses: settings.jira.ignoredStatuses`; `/my-tickets` passes nothing and shows every status.
  That list used to be a `status NOT IN (…)` clause in the sync's JQL — so those tickets were never
  fetched, and My tickets was structurally unable to answer "everything assigned to me". It is now a
  property of one read (`docs/05-DECISIONS.md` **ADR-014**), and the Settings label says *Hidden from
  Active tickets* rather than *Never fetched*.

Run `npm run verify:tickets` (~170 checks, the count follows the data): it walks every page against
the unpaged result, checks the SQL filter against `claimIsMine` ticket by ticket for every account
that can sign in, checks every status chip against the rows it claims to count, and checks that hiding
a status removes exactly the rows at it and drops exactly its chip.

**The sync has two shapes of pass, and no status filter.** Every status now reaches the cache, and
what pays for it is that most passes ask for far less of Jira than they used to
(`docs/05-DECISIONS.md` **ADR-015**). `planPass()` in `lib/jira/pass.ts` — pure, unit-tested in
`tests/jira-pass.test.ts` — picks between them:

- **delta**, the once-a-minute poll from an open tab: `updated >= -Nm` since the last successful pass
  plus a five-minute overlap, **reconciled per key**. It upserts what it saw, drops newly-claimed keys
  from `jira_issues` (this is what keeps the two tables disjoint), and clears `jira_skipped` for
  anything it saw that is no longer skipped. What it did not see is left alone.
- **full**, from the daily cron and both Refresh buttons: `updated >= -30d` and the truncate-and-
  rebuild every pass used to do. It is the **only** pass that can notice a ticket deleted in Jira, so
  a deletion can linger for up to a day.

The window is relative (`-Nm`) so Jira evaluates it against its own clock — there is no timezone to
get wrong. Editing `applySync()`'s transaction means editing two write paths now; the delta one fails
*stale* rather than *wrong*, which is harder to spot.

**The sync writes in batches — never add a row-at-a-time loop to it.** Round trips are the entire
cost of a pass: writing one row per query took a full pass to 21.6s (against 1.5s for the Jira fetch)
and timed out `POST /api/jira/sync-now` on Vercel's 60s budget. `lib/db/batch.ts` holds the helpers;
one multi-row statement per table took it to 3.0s. Two things to know before editing those writes:
`lastByKey()` is not optional in front of an `ON CONFLICT … DO UPDATE` — the same key twice in one
statement is a hard error, and a paged Jira search can return one — and a new column has to be added
to the column list, the `casts` array and the value tuple together. See `docs/05-DECISIONS.md`
**ADR-018**.

**One mistyped date must not stop the board.** `claims_time_order` requires `end_time > start_time`,
and `applySync()` writes in one transaction — so a ticket whose due date precedes its start date used
to roll back the entire pass with nothing but a constraint name to show for it. `bookingWindow()` in
`lib/jira/booking.ts` (pure, property-tested) always returns a row the constraint accepts: when Jira's
own dates contradict it drops the **end**, and when only the invented "started now" fallback collides
it drops **ours** and keeps Jira's due date. The offending ticket is named in a `console.warn`, because
the fix is in Jira. See `docs/05-DECISIONS.md` **ADR-017**.

**A Jira sync that returns nothing is refused, not applied.** `/rest/api/3/search/jql` answers **200
with an empty page** when credentials are rejected, not 401 — so an expired token used to read as
"Jira has no tickets", truncate the whole cache, and report success. `assertJiraAnswered()` in
`lib/jira/sync.ts` refuses a pass that returned none of the held keys it asked for by name (or, on a
**full** pass only, nothing at all over a non-empty cache — on a delta pass an empty reply is the
normal case), probes `/myself` to say which it was, and leaves the board standing with the reason in
`last_error`. See `docs/05-DECISIONS.md` **ADR-013**.

**The team roster is the board asked by person, and it is superadmin-only.** `/team` answers "what is
Jerome on, and is anybody free" — the question no environment- or ticket-shaped page can. Four things
to know before touching it:

- **It is gated on a capability, not a role.** `oversee`, held by `superadmin` alone
  (`docs/05-DECISIONS.md` **ADR-012**). Reusing `manage-users` would have been free and wrong: the day
  `admin` is given that, this page widens with it and nobody reviewing the change would see it coming.
  Widening is deliberately one array entry in `AUTH_ROLES`.
- **`lib/shared/workload.ts` is a pure function, not a query — on purpose.** Its header says why: the
  Jira cache is hard-capped at 500 rows by `MAX_PAGES` in `lib/jira/sync.ts`, so there is nothing for
  LIMIT to save, and a SQL aggregate would have meant writing the assignee-matching rule a **third**
  time. It buckets with `claimIsMine()` itself, so the roster and the per-person drill-down cannot
  disagree — the drill-down is `getTicketPage({ mine })` fed `directoryIdentityValues(person)`, which
  is why that parameter took identity strings rather than a user id in the first place.
- **The roster is driven by the directory, so most rows have no login.** A login only adds presence.
  Two identity spaces, as ever.
- **"Still working on it" is `statusFrees()` negated** — invariant 2, not a second status list. And
  `/team` reads the board and Jira only: `oversee` grants **no chat access**, the page says so, and
  `docs/06-OPEN-QUESTIONS.md` **Q5** records that.

Run `npm run verify:team` (150 checks): it walks every person's drill-down page by page against their
roster row, checks every live ticket lands on somebody or in "unassigned", and asserts the gate itself.

**Repository health is now measured.** `lib/health/check.ts` probes every repo that has a URL and
records the verdict *and* the time it was taken. Three triggers: a daily Vercel Cron
(`/api/cron/health`), an hourly timer while somebody has `/health` open, and the **Check servers**
button (`POST /api/health/check`). Run one by hand with `npm run verify:health`.

Q1 turned out to rest on a false premise — none of the 93 configured URLs is on an internal
hostname, they are all public dev domains — so no on-prem agent was needed. The answer, and the two
caveats it carries, are in `docs/06-OPEN-QUESTIONS.md` **Q1**. The important one: an environment on a
genuinely internal hostname would read `offline` from the cloud while being perfectly healthy, and
`offline` outranks everything on the board.

## Running the new app

```bash
npm run dev
```

Needs a Neon branch. Copy `.env.example` to `.env.local`, then:

```bash
npm run db:migrate      # apply lib/db/migrations/*.sql
npm run db:import       # load shared-data/ + config/auth.json into Postgres
npm test                # 341 tests, node:test via tsx
npm run typecheck
```

`db:import` refuses rather than guesses — duplicate Jira labels and claims naming missing
environments are reported for a human. Re-run with `--truncate` after fixing them.

### Signing in

Imported accounts keep their **original** passwords: scrypt parameters are unchanged, so hashes
carried over from `config/auth.json` still verify.

**`ADMIN_PASSWORD` only seeds a first account when `auth_users` is empty.** Once any account exists it
is ignored silently — it is not a way to reset a password, deliberately, because an env var that could
overwrite a live credential would be a backdoor. Use the CLI instead:

```bash
npm run auth:list                                    # accounts, roles, lockout state
npm run auth:set-password -- <username> <password>   # min 8 chars
```

That drops the account's sessions **and** clears its failed-attempt counter — without the second part
you can set a fresh password and still be locked out for ten minutes, which reads as the new password
not working.

Two traps worth knowing: `.env.example` is a committed template and is **never read** (real values go
in `.env.local` or `.env`), and `db:import --truncate` clears `auth_sessions`, so browsers keep a
cookie that no longer resolves.

## Documentation map

| Doc | Read it when |
|---|---|
| `docs/00-CONTEXT-CURRENT-SYSTEM.md` | You need to know how anything works **today** |
| `docs/01-TARGET-ARCHITECTURE.md` | Working on the migration or the new stack |
| `docs/02-DATA-MODEL.md` | Touching the schema or any query |
| `docs/03-REALTIME-SPEC.md` | Touching Pusher, chat, presence or events |
| `docs/04-MIGRATION-PLAN.md` | Deciding what to build next |
| `docs/05-DECISIONS.md` | Tempted to do something differently — check whether it was already decided and why |
| `docs/06-OPEN-QUESTIONS.md` | Blocked on a product decision |

## Running the legacy app (reference only)

```bash
npm run legacy     # node server/index.js → http://localhost:4000
```

It reads `config/` and `shared-data/` directly, so running it will not disturb Postgres.

## Invariants — do not break these without a decision recorded in `docs/05-DECISIONS.md`

1. **Occupancy is derived, never stored.** `free` / `partial` / `inuse` / `issue` is computed from
   live claims plus repo health. An offline repo outranks everything else.
2. **Claims are sticky.** Only a *releasing* or terminal Jira status frees a claim. Every other status
   leaves it alone — `QA FAILED` is still being worked, so it keeps the environment.
3. **One capability list, enforced twice.** `AUTH_ROLES` is read by the browser to hide and by the
   server to refuse. Hiding is courtesy; **the server is the boundary.** Never add a UI-only check.
4. **Instant revocation.** Changing a password, a role, or an account's active flag ends every session
   that person holds, immediately. This is documented behaviour, not an implementation detail.
5. **Secrets never reach the client.** The Jira API token, password hashes and session tokens are never
   part of the board and never pushed over any realtime channel.
6. **Jira matching is exact.** Account Name + Branch + Repository, case-insensitive exact match, no
   fuzzy guessing. An unmatchable ticket surfaces on **Not tracked** with the reason and the fix rather
   than silently claiming the wrong box.
7. **Escape everything users type.** Notes today, chat messages tomorrow. Centralised in
   `Format.escapeHtml` / `H.esc`.

## Two identity spaces — the most common source of bugs

| | Auth account | Directory person |
|---|---|---|
| Table | `auth_users` (was `config/auth.json`) | `directory_users` (was `shared-data/users.json`) |
| Id | `uuid` | slug — `"sem"`, `"jerome"` |
| Means | **can sign in** | **can be assigned a claim** |
| Coverage | a minority of the team | everyone on the board |

Linked optionally one-to-one via `account.directoryUserId`. **Most people on the board have no login.**
A login reads its Jira assignee labels *through* that link rather than storing its own copy.

Before writing anything that says "user", decide which of these two you mean.

## Legacy problems the migration already fixed

Do not "fix" these again; they are gone in `app/` + `lib/`.

- Whole-board `POST /api/state`, last-write-wins. Replaced by granular endpoints in transactions.
- `config/auth.json` read synchronously per request and written non-atomically. Now indexed queries.
- Live session tokens stored in plaintext. Now SHA-256 hashes in `auth_sessions`.
- In-memory login lockout. Now `auth_login_attempts`.
- Tailwind compiled in the browser from a CDN. Now a build step.
- Stale `package-lock.json`, and `npm test` as a stub. Both fixed.

Still true, and still worth knowing:

- **No CSRF tokens.** `SameSite=Lax` carries it, so **every state-changing route must stay a non-GET
  method**. A mutation on a GET silently loses the protection.
- **No rate limiting** except the login lockout. Chat will need it (`docs/03-REALTIME-SPEC.md` §10).
- `README.md` still links `DEPLOY.md`, which does not exist.

## Conventions

**New codebase.** TypeScript, App Router, Server Components by default — `"use client"` only where
there is real interaction. Reads go through `lib/db/queries/*`; those modules are the only place
snake_case appears. Mutations go through granular route handlers, each calling
`requireUser(capability)` first and a `revalidate*` helper last. Semantic colour tokens only
(`bg-surface`, `text-muted`) — no literal colours and no `dark:` variants, because dark mode is one
set of CSS variable overrides in `app/globals.css`.

**Both.** Comments explain **why**, often at length. That is this repo's main form of documentation —
match it. When porting, carry the original's reasoning across rather than just its behaviour.

## Working style

- Prefer reading the source over assuming. The legacy code is unusually well commented and the
  comments are accurate; it is the best spec for what a ported feature should do.
- Don't touch `config/` or `shared-data/` — credentials and legacy state, both gitignored. They are
  the import script's input.
- Check `docs/06-OPEN-QUESTIONS.md` before building anything that depends on a blocked decision.
