# 05 — Decision record

Short ADRs. Each records what was decided, why, and **what it costs** — the consequences section is the
part worth reading in six months.

---

## ADR-001 — Move to Next.js + Vercel + Neon + Pusher + Vercel Blob

**Status:** Accepted (team directive)

**Context.** The app today is a zero-dependency Node process serving vanilla JS, storing JSON on local
disk, pushing state over its own SSE stream. It works, and it is unusually well-documented internally.
But it needs a host running a persistent process, it has no build step (Tailwind compiles in the
browser from a CDN), no tests, and a whole-board last-write-wins write path. Chat, media and presence
are on the roadmap.

**Decision.** Rebuild on Next.js (App Router, TypeScript) hosted on Vercel, with Neon Postgres as the
only source of truth, Pusher Channels for realtime, and Vercel Blob for media.

**Consequences — good.**
- Postgres replaces whole-board replacement with row-level writes, which **removes the app's worst
  existing bug** (concurrent edits clobbering each other) as a side effect.
- A real build step retires the runtime Tailwind CDN compile the README already flags as
  non-production.
- TypeScript makes the "one capability list, enforced twice" pattern a compile-time guarantee rather
  than a convention.
- Managed realtime removes four latent SSE defects at once: no addressing, no heartbeat, no replay, no
  re-authentication of an open stream.

**Consequences — costs, stated plainly.**
- ~~⚠ **Health checks against `*.internal` hostnames stop working.**~~ **Did not materialise
  (2026-08-21).** No configured URL is on an internal hostname; they are all public dev domains, so a
  Vercel function reaches them. The cost that remains is cadence, not reachability: hourly from the
  page timer, daily from cron unless the plan allows better. This becomes a real outage the day an
  environment on a private hostname is added — an offline repo still outranks everything in
  `getDisplayStatus()`. [Q1](06-OPEN-QUESTIONS.md#q1).
- ⚠ **Sub-minute Jira freshness is lost.** The current 20-second poll is not achievable under cron
  scheduling. [Q10](06-OPEN-QUESTIONS.md#q10).
- The IP allowlist changes character: no hot-reload by editing a file, and it can no longer terminate
  an already-established realtime connection. [Q3](06-OPEN-QUESTIONS.md#q3).
- Data leaves the local network — Neon, Pusher and Blob all hold internal environment URLs, ticket
  keys, and (for Pusher) message bodies. That is a genuine change in posture for a tool that was
  deliberately LAN-only behind an IP gate.
- Four external services to provision, bill and monitor, each with quotas that can throttle the app.
- The `localStorage` fallback that kept the board readable when the server dropped is gone.
- Zero dependencies becomes many. The `node_modules`-free property is deliberately traded away.

**Superseded.** An earlier analysis in this repo recommended extending the existing SSE channel and
adding `node:sqlite`, preserving zero dependencies and the persistent-process model. That option is
**superseded by this ADR** and recorded here only so the reasoning is not rediscovered: it optimised
for keeping the current architecture, which the team has decided not to keep.

---

## ADR-002 — Pusher Channels, not SSE or raw WebSockets

**Status:** Accepted

**Context.** Realtime on a serverless platform. Three candidates: keep SSE, run WebSockets, or use a
hosted service.

**Decision.** Pusher Channels.

**Why.** SSE and WebSockets both require the server to **hold a connection open**, which is precisely
what a serverless function does not do — the function would have to stay alive per connected client,
billed for the duration, and would still lose every connection on redeploy. A hosted realtime service
inverts the model: the server publishes and returns immediately, and the connections live somewhere
else. On Vercel this is not a preference, it is close to a requirement.

Pusher specifically also solves the thing the old channel most lacked: **channel types that carry
authorization**. `private-` and `presence-` prefixes plus a server auth endpoint give per-conversation
access control, which is the prerequisite for any private message existing at all.

**Consequences.**
- Message payloads transit a third party. Mitigable with `private-encrypted-` channels.
  [Q7](06-OPEN-QUESTIONS.md#q7).
- **No replay.** Anything published while a client was disconnected is lost to that client, so every
  feature needs an explicit catch-up path ([03-REALTIME-SPEC.md](03-REALTIME-SPEC.md) §7). This is the
  single easiest way to ship a chat that silently drops messages.
- Connection and message quotas become a design constraint; noisy publishers (health cron, unread
  notifications, typing) must be budgeted.
- ⚠ Presence channels cap at roughly 100 members — a hard ceiling on `presence-org`.
- `/api/pusher/auth` becomes the most security-critical file in the codebase.

---

## ADR-003 — Neon Postgres as the single source of truth

**Status:** Accepted

**Decision.** All state — board, auth, chat — in Neon. Nothing on local disk.

**Why.** Vercel has no writable persistent disk and no shared process memory, so `shared-data/*.json`,
`config/auth.json` and the in-memory `Board.state` singleton all have nowhere to live. Postgres also
buys what JSON files cannot: real indexes, keyset pagination for message history, transactions, and
constraints that make invariants like "one login per person" and "one DM per pair" enforceable by the
database rather than by racy application checks.

**Consequences.**
- Every read is a network call. Server Components make this cheap (no client round trip), but the
  pooled-versus-HTTP driver choice per call site now matters, and getting it wrong exhausts Postgres
  connections under scale-out.
- `state-store.js`'s careful work — atomic rename per section, skip-if-unchanged, coalescing,
  quarantine of an unreadable board — becomes irrelevant. Worth acknowledging: that machinery existed
  for good reasons and Postgres subsumes all of them.
- The Jira-derived cache must now be **persisted** (ADR-010).

---

## ADR-004 — Opaque session tokens in Postgres, not JWTs

**Status:** Accepted

**Context.** Serverless nudges toward stateless JWTs to avoid a per-request session lookup.

**Decision.** Keep opaque random tokens, stored as **SHA-256 hashes** in `auth_sessions`, resolved by
one indexed query per request.

**Why.** The app's documented, load-bearing behaviour is that changing a password, changing a role, or
deactivating an account **immediately** ends every session that person holds — the README states it as
a feature: "an open tab loses the access it had rather than keeping it until reload." A stateless JWT
cannot be revoked before expiry without a server-side denylist, which is a session table with extra
steps and worse ergonomics.

Storing the hash rather than the token is a **strict improvement** on the current system, where
`config/auth.json` holds live plaintext tokens beside the password hashes.

**Consequences.** One indexed lookup per authenticated request — cheaper than today's
`readFileSync` + `JSON.parse` of the whole credential file per request. Session validation cannot run
in Edge middleware, which is why middleware only checks cookie *presence* and the real boundary is
`requireUser()` on the Node runtime.

---

## ADR-005 — Granular mutation endpoints; no whole-board write

**Status:** Accepted

**Decision.** `POST /api/state` is not reimplemented. Each entity gets endpoints that touch only the
rows they name, inside a transaction.

**Why.** The current write path POSTs the entire board and replaces it in one assignment — last-write-
wins with no version or ETag. Two people editing at once means one silently loses their change. It is
made worse by `setFilter` calling the same save path, so typing in the search box POSTs the whole board.

**Consequences.** More endpoints to write and authorize. In exchange, concurrent edits stop clobbering,
payloads shrink from the whole board to one entity, role enforcement becomes per-operation instead of
"strip the fields they may not touch", and realtime events become naturally granular — which is what
makes [ADR-002](#adr-002)'s small payloads possible.

---

## ADR-006 — Read state as a watermark, not a receipts table

**Status:** Accepted

**Decision.** `chat_members.last_read_message_id`. No per-message receipt rows.

**Why.** A receipts table is O(messages × members) rows to power a feature that renders as one tick and
a bold conversation title. A watermark is O(members) and answers unread counts with
`COUNT(*) WHERE id > last_read_message_id`, which the existing
`chat_messages (conversation_id, id DESC)` index already serves.

**Consequences.** You cannot show *which* specific members have read a *specific* older message —
only "read up to here". That is enough for every requirement currently on the table. If per-recipient
per-message ticks are later required, add `chat_message_receipts` then, deliberately, with the cost
understood.

---

## ADR-007 — Chat participants keyed on `auth_users.id`

**Status:** **Proposed** — pending [Q4](06-OPEN-QUESTIONS.md#q4)

**Context.** The app has two independent identity spaces: auth accounts (who can sign in) and board
directory people (who can be assigned a claim), optionally linked one-to-one. **Most people on the
board have no login at all.**

**Decision (proposed).** Chat membership, message senders and presence key on `auth_users.id`. Display
name and avatar resolve through `directory_user_id` when the link exists.

**Why.** You can only usefully chat with someone who can read it. A conversation keyed on directory
people would let you address colleagues who can never open the app — messages sent into a void, unread
counts that never clear.

**Consequences.** Giving someone chat access means giving them a login. The Users page already frames
this correctly ("No login — give access"), so the workflow exists. It does mean the reachable set for
chat is smaller than the assignable set for claims, and the UI must not imply otherwise.

---

## ADR-008 — Authorization in the application layer, not Postgres RLS

**Status:** Accepted

**Decision.** `requireUser(capability)` plus an explicit `chat_members` check. One database role, one
connection string. No row-level security.

**Why.** The app is the only client of this database, and the capability list is already shared between
client and server. RLS would mean threading a per-request identity through Neon's pooled connection
model for no gain today.

**Consequences.** A missing `WHERE` clause on `chat_messages` is a privacy incident with no second net
beneath it. Two rules become non-negotiable: no query against `chat_messages` without a proven
membership check on the same request, and `/api/pusher/auth` is that same boundary in a different
shape. **Revisit this ADR the moment a second client touches the database** — a BI tool, another
service, or direct SQL for support.

---

## ADR-009 — Typing indicators via the server, not Pusher client events

**Status:** Accepted

**Decision.** `POST /api/chat/typing`, server-published. Client events stay disabled in the Pusher app.

**Why.** Client events let any subscriber publish onto a channel it is subscribed to, invisibly to the
server. A forged `typing.start` is harmless in isolation, but the capability cannot be scoped to one
event name — enabling it enables client publishing app-wide, which is a standing hazard as the event
vocabulary grows. At this team's scale the function invocations are trivial.

**Consequences.** One invocation per typing ping, throttled to one per 3 seconds per user per
conversation. Typing remains the highest-frequency event in the system, so that throttle is what keeps
it affordable.

---

## ADR-010 — Persist the Jira-derived cache

**Status:** Accepted

**Context.** `jiraIssues`, `jiraSkipped` and `lastJiraSyncAt` are currently and **deliberately never
persisted**: they are most of the board by size, stale the moment the process stops, and refilled from
memory by the sync at boot.

**Decision.** They become `jira_issues`, `jira_skipped` and `jira_sync_state` tables.

**Why.** There is no process to hold them. The alternative is re-querying Jira on every page view that
shows a ticket table, which is slower, rate-limited, and fails when Jira does.

**Consequences.** The board's on-disk size grows substantially. These tables are a **cache, not a
source of truth**: each sync pass truncates and refills, nothing joins to them with referential
integrity, and array columns are acceptable there for exactly that reason. They must never be read as
authoritative for occupancy — `claims` is.

---

## ADR-011 — Soft-delete messages

**Status:** Accepted

**Decision.** `chat_messages.deleted_at`. Hard deletion only via the retention cron.

**Why.** `reply_to_id` targets must survive, and message ordering by `bigserial` should not develop
holes that break cursor pagination. It also makes "message deleted" renderable, which is what users
expect.

**Consequences.** Deleted content stays in the database until retention removes it, which is a real
consideration for the privacy policy [Q8](06-OPEN-QUESTIONS.md#q8) — "delete" in the UI is not
immediately "gone from the database", and saying so honestly matters. Attachment blobs must be deleted
by the same job, or they become billable orphans.

---

## ADR-012 — `oversee`: a sixth capability, for the team task viewer

**Status:** Accepted

**Context.** `/team` answers the question a project manager asks and no existing page does: not "who
holds environment 4", but "what is Jerome on, and is anybody free". It needs to be visible to a lead
and not to the team it reports on.

The obvious shortcut was to gate it on `manage-users`, which today only `superadmin` holds. That would
have been zero new surface — and wrong. `manage-users` means *can create a login and hand out a role*.
Reading everyone's workload is a different power that happens to belong to the same person right now.
Conflating them means the day `admin` is given `manage-users` — a plausible, small decision — this page
silently widens with it, and nobody reviewing that change would see it coming.

**Decision.** A new capability, `oversee`, granted to `superadmin` alone. Checked by
`requireUser("oversee")` in both `/team` Server Components and by `requires: "oversee"` on the nav
entry.

**Why a capability and not a role check.** Invariant 3: one capability list, enforced twice. A
`user.role === "superadmin"` test in a page would be a third boundary, invisible to `AUTH_ROLES`, and
the first thing to drift. Adding to the list means the Users page's role card describes the new power
without being edited.

**Scope — what this deliberately does not grant.** `/team` reads the board and the Jira cache. It shows
**no chat**, and holding `oversee` gives no access to any conversation:
[Q5](06-OPEN-QUESTIONS.md#q5) says membership is the boundary and a silent superadmin bypass is
indistinguishable from the bug that boundary exists to prevent. That answer is unchanged here. Q5 also
says *whatever the answer, say it in the UI*, so the page says in as many words that it reads tickets
and not messages.

**Consequences.** Widening to `admin` later is one array entry, which is the point. The cost is that
"superadmin" is now two separable things and somebody could grant one without the other — that is a
feature, but it does mean the capability list is the thing to read, not the role name. There is no
audit log of who looked; if that is ever wanted it is a new decision, not an extension of this one.

---

## ADR-013 — A Jira pass that returns nothing is not believed

**Status:** Accepted

**Context.** `applySync()` rebuilds the derived cache from scratch every pass: `TRUNCATE jira_issues`,
then re-insert whatever the search returned. That is deliberate (ADR-010 — the cache is not a source of
truth) and it is fine as long as the reply is an *answer*.

It is not always an answer. `/rest/api/3/search/jql` responds **200 with an empty page** when the
credentials are rejected, rather than 401. So an expired API token is indistinguishable, at the call
site, from "Jira has no tickets": the sync truncated the cache, wrote `last_sync_at = now()` and
`last_error = NULL`, and every ticket list in the app went empty with nothing anywhere saying why. The
header pill still read "Synced 1m ago". This happened; it is not a hypothetical.

Claims survived only by accident — a ticket has to be *seen* at a releasing status to be released, and
nothing was seen — so the board kept its 11 held environments while losing all 140 cached issues.

**Decision.** Before `applySync()` runs, `assertJiraAnswered()` rejects a pass that cannot be an
answer, and the sync fails with a recorded `last_error` instead of writing:

- not one of the **held keys** came back, when held keys were asked for by name; or
- **nothing at all** came back, over a cache that had rows.

Held keys are the load-bearing half. Rule 2 of the sync is that they are re-fetched **by name** every
pass whatever their status, so asking for eleven and being handed none is a failure to answer rather
than news about those eleven tickets. One deleted ticket does not trip it; all of them vanishing at
once does, and refusing to act is the safe direction either way.

When it trips, `/myself` is probed once — only in this branch, so the normal path costs what it always
did — so the recorded error can say *"Jira rejected the credentials"* rather than *"Jira returned
nothing"*.

**Why not simply "never truncate to empty".** Because an empty board is a legitimate state (a small
team, an aggressive ignored-status list), and a rule that refuses it would eventually be wrong and
unexplainable. The held-key test asks a question that has one correct answer.

**Consequences.** A genuine mass deletion in Jira now needs a human: the sync will refuse until at
least one held ticket is visible again, or until the claims holding those keys are released by hand.
That is the trade — a stuck board that says why, over an empty one that says nothing. The cost is one
extra request on the failing path.

---

## ADR-014 — `ignoredStatuses` hides rows; it no longer narrows the search

**Status:** Accepted

**Context.** The sync's JQL carried `status NOT IN ("OPEN", "TO REVIEW", "ON HOLD", "CANCELLED",
"DONE", "CLOSED")`. The setting was labelled *Never fetched*, and it meant it: a ticket at one of
those statuses was not filtered out of a page, it never entered the database.

That is fine for Active tickets, whose entire claim is "what is being worked on". It is fatal for My
tickets, whose claim is "everything assigned to you". A person's own closed, cancelled and
not-yet-started work was not hidden from that page — it had never been fetched, so no filter, chip or
button on the page could have brought it back. One page's editorial opinion was being enforced at the
data layer, where every other page inherited it.

**Decision.** The list means **"hidden from Active tickets"**. Its enforcement moves from the JQL to
`hideStatuses` on `getTicketPage()` (`lib/db/queries/tickets.ts`), which `/tickets` passes and
`/my-tickets` deliberately does not. The Settings label changes from *Never fetched* to *Hidden from
Active tickets*, and says in as many words that the tickets are still fetched and still on My tickets.

**Why not a second list.** A new "hidden" setting beside the old "ignored" one would have left two
lists that mean almost the same thing, and the first person to edit the wrong one would get a page
that disagrees with itself for a reason nothing on screen explains. There is one list; what changed is
where it is applied.

**Consequences.** The sync carries strictly more of Jira than it did, which is paid for by
[ADR-015](#adr-015--sync-passes-are-incremental-with-a-daily-full-rebuild). The rule is now a property
of a read, so it is checked like every other one: `npm run verify:tickets` asserts that hiding a status
removes exactly the rows at it and drops exactly its chip.

The remaining bound on "everything assigned to me" is the search window — a ticket Jira has not touched
in 30 days is not in the cache — and My tickets says so under its chips rather than letting an absence
speak for itself.

---

## ADR-015 — Sync passes are incremental, with a daily full rebuild

**Status:** Accepted

**Context.** Every pass re-read `updated >= -30d` and rebuilt the derived tables from the result:
`TRUNCATE jira_issues`, then re-insert. With `pollIntervalMinutes = 1` and a browser tab open, that is
several hundred issues fetched, parsed and written every sixty seconds to discover that two of them
moved.

It was affordable only because the search was also cut down to a handful of statuses — and
[ADR-014](#adr-014--ignoredstatuses-hides-rows-it-no-longer-narrows-the-search) removes that cut. Left
alone, the ordinary pass would have got heavier at exactly the moment it needed to get lighter.

**Decision.** Two shapes of pass, chosen by `planPass()` in `lib/jira/pass.ts`:

- **delta** — `updated >= -Nm`, where N is the gap since the last successful pass plus a five-minute
  overlap. It **reconciles per key**: upsert what it saw, drop from `jira_issues` anything that has
  just become a claim, drop from `jira_skipped` anything it saw that is no longer skipped. Tickets it
  did not see are left exactly as they were. This is the once-a-minute poll.
- **full** — `updated >= -30d`, and the truncate-and-rebuild that every pass used to do. The daily
  cron and both Refresh buttons ask for one, as does a first sync or one following a gap wider than
  the window itself.

The window is **relative** (`-Nm`), not an absolute timestamp, so Jira evaluates it against its own
clock and there is no timezone or format to get wrong. The five-minute overlap covers clock skew and
the seconds a pass itself takes, and closes the only hole a delta pass can have: an update landing
between one pass reading and the next one starting.

**Why a full pass still exists.** A delta pass can only add to and update what is cached. A ticket
**deleted** in Jira appears in no search, so nothing tells an incremental pass to forget it; only a
rebuild drops it. The daily cron bounds that staleness at 24 hours, and the Refresh button ends it on
demand.

**Consequences.** The ordinary pass falls from ~500 issues to however many changed in a minute — often
none but the held keys, which are asked for by name in every window. Against that, a deleted ticket can
linger for a day, and `applySync()` is now two write paths instead of one, which is the thing most
likely to rot: the delta path is where a mistake shows up as *stale* rather than as *wrong*, and stale
is harder to notice.

`planPass()` and `buildJql()` were split into `lib/jira/pass.ts` — pure, no database, no network —
precisely so this arithmetic is unit-testable without a live Jira. `tests/jira-pass.test.ts` covers
the rounding, both fallbacks and the parenthesisation of the window.

---

## ADR-016 — `all-tickets`: Active tickets is admin and above

**Status:** Accepted

**Context.** `/tickets` is the whole team's backlog — every claim holding a repository, then every
other issue the last sync saw. It answers "what is the team working on", which is a lead's question.
A member's question is "what am I working on", and `/my-tickets` answers that one.

Until now the page was open to anyone with `view`, i.e. everybody.

**Decision.** A new capability, `all-tickets`, granted to `superadmin` and `admin`. Checked by
`requireUser("all-tickets")` at the top of the page's Server Component — before any query runs — and
by `requires: "all-tickets"` on the nav entry, which takes the `claims` badge with it.

**Why not reuse `configure`.** It is held by exactly `superadmin` and `admin` today, so it would have
been a zero-line change and produced exactly the right behaviour. It is the same shortcut
[ADR-012](#adr-012--oversee-a-sixth-capability-for-the-team-task-viewer) rejected, for the same
reason: `configure` means *can change settings and credentials*. Reading the team's backlog is a
different power that happens to belong to the same people right now, and conflating them means the day
`member` is given `configure` — a plausible, small decision — this page silently widens with it and
nobody reviewing that change would see it coming.

**Why not `oversee`.** That is narrower on purpose and stays narrower: an admin may read the backlog,
but only a superadmin sees it broken down per person on `/team`. Two oversight capabilities, one tier
apart, is the shape that lets either move without dragging the other.

**Consequences.** A member or viewer following an old `/tickets` link gets a 403 from `requireUser()`,
rendered by Next's default error page — the same behaviour `/team` has had since ADR-012, and the same
place a nicer 403 page would have to be added for both. The dashboard's *See all* link is hidden for
them; the "Latest Jira updates" table above it stays, because a preview of recent Jira activity is not
the same thing as the whole backlog and nobody has asked for that to be private.

Nothing about what a member can *do* changed — they keep `view` and `claim`, so the board, the
environments and their own queue are untouched. Widening to `member` later is one array entry in
`AUTH_ROLES`, which is the point.

---

## ADR-017 — Contradictory Jira dates lose the end time, not the sync

**Status:** Accepted

**Context.** `claims_time_order` requires `end_time > start_time` unless one is null. `applySync()`
writes every ticket in ONE transaction, so a single ticket whose due date precedes its start date
rolled the whole pass back:

```
new row for relation "claims" violates check constraint "claims_time_order"
```

GLOP-1533 — start `2026-08-26`, due `2026-08-18` — did exactly that, and the board stopped updating
with nothing to show for it but a constraint name in a 500. One person mistyping a date in Jira could
stop the board for everybody. This predates the incremental sync; *In Progress* was never an ignored
status, so the ticket always reached this insert.

**Decision.** `bookingWindow()` in `lib/jira/booking.ts` derives both instants and guarantees a row the
constraint accepts. Two cases, distinguished by **whose value is wrong**, and the rule is the same
both times — never let a value we invented destroy one Jira actually gave us:

1. **Jira's own two dates disagree.** The start stands, the **end** goes. The ticket is at an
   occupying status so it *is* held; what we no longer know is when it frees. `end_time IS NULL`
   already means precisely that, and sorts last under `NULLS LAST`.
2. **Only the invented start collides.** A claim with no start date "started now", which conflicts
   with any due date in the past — an ordinary overdue ticket. Here **our** value is the wrong one, so
   the fallback gives way and Jira's due date survives.

Nothing is swapped, inferred or nudged: guessing which date the author meant would be the fuzzy
matching invariant 6 forbids.

**Why not skip the ticket to Not tracked.** Because it is not untracked — it matched an environment
and it does hold those repositories. Filing it there would leave a box that somebody is working on
reading *free*, which is the exact failure the board exists to prevent.

**Why a `console.warn` and not something on screen.** The claim is correct and complete apart from one
missing date, and the fix is in Jira, not here. A row on Not tracked would misreport it; a new UI
surface for a mistyped date is more machinery than the case earns. The warning names the ticket and
both dates, which is what somebody needs to go and fix it. If these turn out to be common, surfacing a
count in the sync result is the next step.

**Consequences.** A mistyped date now costs that one ticket its "frees in" instead of costing the
whole board its sync. `bookingWindow()` is pure and property-tested over every combination of present,
absent and contradictory dates (`tests/jira-booking.test.ts`), because the interesting inputs only
arrive by way of somebody's typo.

---

## ADR-018 — The sync writes in batches, because round trips were the whole cost

**Status:** Accepted

**Context.** `POST /api/jira/sync-now` started returning a **timeout** in production.

`applySync()` wrote one row per query — ~290 INSERTs into `jira_issues`, plus one per claim and one per
repo and per assignee, each an `await` inside the transaction — and `createJiraNotifications()` did the
same for every alert it raised. That is ~300 sequential round trips on a full pass. Measured against
the live database:

| | before |
|---|---|
| Jira fetch (289 issues, 3 pages) | **1.5 s** |
| the transaction | **~20 s** |
| full pass, end to end | **21.6 s** |

The rows are tiny; the latency is everything. It had been survivable while the sync carried ~140
tickets, and [ADR-014](#adr-014--ignoredstatuses-hides-rows-it-no-longer-narrows-the-search) roughly
doubled that by carrying every status — which is what pushed a 60-second Vercel function over the
edge. The daily cron would have hit it too, silently.

**Decision.** One multi-row statement per table, chunked at 200 rows, with the shared helpers in
`lib/db/batch.ts`. ~300 queries became about ten:

| | after |
|---|---|
| full pass | **3.0 s** (1.5 s of it still the Jira fetch) |
| delta pass | 1.3 s |

Only the PLACEHOLDER list is built by concatenation — `($1, $2::text[], now())` — and every value is
still bound as a parameter. Columns with a `DEFAULT now()` (`synced_at`, `claimed_at`) are left out of
the column list rather than repeated in every row tuple.

**The one semantic change, and it needed care.** `ON CONFLICT … DO UPDATE` is a hard ERROR when the
same key appears twice in ONE statement, where a row-at-a-time loop would simply have applied the
second write. A paged search *can* return a duplicate — an issue updated mid-scan can appear on two
pages of a `nextPageToken` cursor — so every upserted list goes through `lastByKey()` first, keeping
the last occurrence, which is exactly what writing them in order used to leave behind. The three
child tables are `DO NOTHING` and need no such treatment.

**Consequences.** Headroom, rather than a fix that only just fits: a full pass at the `MAX_PAGES` cap
of 500 issues is three chunks, not five hundred queries. The cost is that the SQL is now generated
rather than literal, so a column added to one of these tables must be added to the column list, the
`casts` array and the value tuple together — three places instead of two, and a mismatch is a runtime
error rather than a compile one.

Verified against the live database: array columns (`repos`, `user_ids`, `raw_assignees`) round-trip
intact, `jira_issues` and `claims` stay disjoint, no claim violates `claims_time_order`, and no child
row is orphaned. The notification batch was proved with a deliberate rollback — 250 rows over two
statements, table count unchanged — rather than by writing real alerts to real people.

---

## ADR-019 - The PWA caches no data

**Status:** Accepted

**Context.** Installing the portal gives it a standalone window that may stay open for days.
A stale board can show an occupied environment as free. Caching per-user HTML, RSC payloads,
API responses or chat files would also bypass the next server-side permission check, and Cache
Storage survives logout on shared machines. Those are three independent reasons to avoid it.

**Decision.** The service worker stores exactly one static file, `/offline.html`. Only GET
navigations are intercepted: network responses, including HTTP errors, pass through unchanged;
a network failure shows the offline page. API calls, attachments, avatars, previews, rendered
pages and RSC payloads are never cached by the worker. The browser's existing HTTP cache handles
hashed build assets. There is no offline mutation queue and no Web Push in this pass.

The manifest, icons, worker and offline page bypass the session redirect but retain the IP gate.
An open board warns after five seconds offline or with an unavailable/failed realtime connection;
the existing Pusher reconnect refresh catches up. Installation is opt-in in the account menu.

**Consequences.** Offline reading remains unavailable (Q11). The offline page asks users to retry
after reconnecting, rather than promising an automatic reload it cannot perform without script.
Worker activation removes older PWA caches; bump its cache version whenever the offline page
changes. Only caches owned by this worker are removed, so unrelated same-origin caches survive.
The static files in `public/` must survive the legacy cutover. Revisit offline reading only with
explicit last-updated labels and cache clearing on logout and `session.revoked`.

**Implementation.** The live account menu is in `components/shell/Sidebar.tsx`; the older
`AccountMenu.tsx` referenced by the initial plan is no longer mounted. A root install-prompt
provider captures events even before that menu mounts. The browser check uses
`npm run build`, `npm start`, then `BASE_URL=http://localhost:3000 npm run verify:pwa` from an
allowed IP. `tests/pwa-worker.test.ts` exercises the shipped worker's cache boundary and failures.
