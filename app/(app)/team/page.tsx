import Link from "next/link";
import { TeamTable } from "@/components/team/TeamTable";
import { TicketTable } from "@/components/TicketTable";
import { Card, Notice, Page, PageHead, StatTile } from "@/components/ui/Layout";
import { requireUser } from "@/lib/auth/require";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { listAuthUsers } from "@/lib/db/queries/auth";
import { getBoard, getJiraIssues } from "@/lib/db/queries/board";
import { describeJiraConfig } from "@/lib/jira/client";
import { boardRows, claimRows } from "@/lib/shared/view-model";
import {
  availabilityCounts,
  buildRoster,
  filterWorkloadRows,
  sortWorkloadRows,
  OVERLOADED_AT,
} from "@/lib/shared/workload";
import { AVAILABILITY } from "@/lib/shared/tokens";

/**
 * Team — the board organised by person instead of by environment.
 *
 * The question this answers is the one a lead asks before handing out work and
 * that no other page here can: not "who holds environment 4", but "what is
 * Jerome on, and is anybody free". Everything on it is derived from claims and
 * the Jira cache — see lib/shared/workload.ts for how, and why the roster is a
 * pure function rather than an aggregate query.
 *
 * ── Who can see it ──
 *
 * `oversee`, held by `superadmin` alone (ADR-012). The nav entry is gated on the
 * same capability, but **hiding is courtesy** — requireUser() below is the
 * boundary, and the drill-down checks it again for itself.
 *
 * ── What it deliberately does not show ──
 *
 * Chat. Holding `oversee` gives no access to any conversation: membership is
 * still the boundary, per docs/06-OPEN-QUESTIONS.md Q5, which also says that
 * whatever the answer is, the UI has to say it. The footnote at the bottom is
 * that sentence, and it is not decoration — a page called "Team" that a lead
 * opens to look at people should be honest about where it stops.
 *
 * ── Everyone appears, not just people with logins ──
 *
 * The roster is driven by the directory, so the majority of the board — who can
 * be assigned a ticket and cannot sign in — is on it. A login only adds
 * presence. Confusing those two identity spaces is the most common bug in this
 * app; see CLAUDE.md.
 */
export const metadata = { title: "Team · Glophics Portal" };

type Search = { availability?: string; q?: string; sort?: string; dir?: string };

function href(base: Search, patch: Search): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...patch };

  for (const [key, value] of Object.entries(merged)) {
    // "all" and empty are the default view, so they are left out rather than
    // written — an unfiltered roster has a clean URL.
    if (value && value !== "all") params.set(key, value);
  }
  const query = params.toString();
  return query ? `/team?${query}` : "/team";
}

function FilterLink({
  search,
  value,
  label,
  count,
  dot,
}: {
  search: Search;
  value: string;
  label: string;
  count: number;
  dot?: string;
}) {
  const active = (search.availability ?? "all") === value;
  return (
    <Link
      href={href(search, { availability: value })}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
        active ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line-2 hover:text-ink"
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {label} {count}
    </Link>
  );
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<Search> }) {
  // The boundary. The nav hid this entry from everybody else; that is courtesy.
  await requireUser("oversee");

  const search = await searchParams;
  const jiraBaseUrl = describeJiraConfig().baseUrl;

  const [board, issues, logins, avatars] = await Promise.all([
    getBoard(),
    getJiraIssues(),
    listAuthUsers(),
    avatarVersions(),
  ]);
  const { accounts, environments, claims, directory, settings } = board;

  // Both halves, or the roster reports what people are holding and misses the
  // work they have been given that is not holding anything yet.
  const tickets = [
    ...claimRows(environments, accounts, claims, directory, avatars),
    ...boardRows(issues, environments, accounts, directory, avatars),
  ];

  const roster = buildRoster({ directory, tickets, jira: settings.jira, logins, avatars });

  const filters = { availability: search.availability, q: search.q };
  const rows = sortWorkloadRows(filterWorkloadRows(roster.rows, filters), search.sort, search.dir);
  const counts = availabilityCounts(roster.rows, filters);
  const filtered = rows.length !== roster.rows.length;

  const { summary } = roster;
  const unmatchedTickets = roster.unmatched.reduce(
    (total, row) => total + row.holding.length + row.open.length,
    0,
  );

  return (
    <Page>
      <PageHead
        title="Team"
        sub={
          <>
            {summary.people} {summary.people === 1 ? "person" : "people"} on the board ·{" "}
            {summary.free} free · {summary.busy} holding an environment
            {filtered ? ` · showing ${rows.length}` : ""}
          </>
        }
        actions={
          <Link
            href="/users"
            className="inline-flex items-center rounded-xl px-3.5 py-2 text-xs font-semibold text-muted ring-1 ring-line-2 transition hover:text-brand-fg hover:ring-brand-soft"
          >
            Manage people
          </Link>
        }
      />

      {/* The tiles summarise the WHOLE roster, not the current cut — "how is the
          team doing?" is a different question from "what am I looking at?", and
          the sub-line above already says which rows are on screen. */}
      <section className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          tone="ok"
          label="Free"
          value={summary.free}
          sub="nothing live assigned"
          icon="check"
        />
        <StatTile
          tone="info"
          label="Working"
          value={summary.assigned}
          sub="live tickets, no environment"
          icon="list"
        />
        <StatTile
          tone="brand"
          label="Holding"
          value={summary.busy}
          sub={
            summary.overloaded
              ? `${summary.overloaded} on ${OVERLOADED_AT}+ tickets`
              : "at least one environment"
          }
          icon="servers"
        />
        <StatTile
          tone={summary.unassignedTickets ? "warn" : "neutral"}
          label="Unassigned"
          value={summary.unassignedTickets}
          sub="live tickets nobody owns"
          icon="alert"
        />
      </section>

      {roster.unmatched.length ? (
        <Notice
          tone="warn"
          title={`${unmatchedTickets} ticket${unmatchedTickets === 1 ? " is" : "s are"} assigned to ${roster.unmatched.length} name${roster.unmatched.length === 1 ? "" : "s"} the board does not know`}
        >
          Those tickets are invisible on their real owner&rsquo;s <strong>My tickets</strong> page, and
          the roster below cannot count them against anybody. Add the name as a Jira assignee under{" "}
          <Link href="/users" className="font-semibold underline">
            Users
          </Link>{" "}
          and both fix themselves. The full list is at the bottom of this page.
        </Notice>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterLink search={search} value="all" label="Everyone" count={counts.all} />
        <FilterLink
          search={search}
          value="free"
          label={AVAILABILITY.free.label}
          count={counts.free}
          dot={AVAILABILITY.free.dot}
        />
        <FilterLink
          search={search}
          value="assigned"
          label={AVAILABILITY.assigned.label}
          count={counts.assigned}
          dot={AVAILABILITY.assigned.dot}
        />
        <FilterLink
          search={search}
          value="busy"
          label={AVAILABILITY.busy.label}
          count={counts.busyAll}
          dot={AVAILABILITY.busy.dot}
        />
        <FilterLink
          search={search}
          value="overloaded"
          label={AVAILABILITY.overloaded.label}
          count={counts.overloaded}
          dot={AVAILABILITY.overloaded.dot}
        />

        {/*
          Its own field rather than the header search, which always navigates to
          /environments. A plain GET form, so this page needs no client
          JavaScript and the narrowed view is still a shareable URL. The hidden
          inputs carry the rest of the query across the submit.
        */}
        <form action="/team" method="get" className="ml-auto flex items-center gap-2">
          {search.availability && search.availability !== "all" ? (
            <input type="hidden" name="availability" value={search.availability} />
          ) : null}
          {search.sort ? <input type="hidden" name="sort" value={search.sort} /> : null}
          {search.dir ? <input type="hidden" name="dir" value={search.dir} /> : null}
          <label className="relative">
            <span className="sr-only">Search people, roles, environments or tickets</span>
            <input
              type="search"
              name="q"
              defaultValue={search.q ?? ""}
              placeholder="Name, role, ticket…"
              className="w-52 rounded-full bg-surface px-3.5 py-1.5 text-[11px] text-body ring-1 ring-line-2 outline-none transition placeholder:text-faint focus:ring-brand-soft"
            />
          </label>
          {search.q ? (
            <Link
              href={href(search, { q: "" })}
              className="text-[11px] font-semibold text-faint transition hover:text-ink"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      <TeamTable
        rows={rows}
        href={(patch) => href(search, patch)}
        sort={search.sort}
        dir={search.dir}
        jiraBaseUrl={jiraBaseUrl}
        empty={
          search.q || (search.availability && search.availability !== "all")
            ? "Nobody matches that filter."
            : "Nobody is on the board yet."
        }
      />

      {roster.unassigned.length ? (
        <section className="mt-7">
          <Card
            title="Nobody has picked these up"
            sub={`${roster.unassigned.length} live ticket${roster.unassigned.length === 1 ? "" : "s"} with no assignee at all`}
          >
            <TicketTable
              rows={roster.unassigned}
              showHolding
              environments={environments}
              claims={claims}
              jiraBaseUrl={jiraBaseUrl}
              empty="Everything live has an owner."
            />
          </Card>
        </section>
      ) : null}

      {roster.unmatched.length ? (
        <section className="mt-7">
          <Card
            title="Names the board does not know"
            sub="A Jira assignee label that matches nobody in the people directory — the work is real, the owner is not on the board"
          >
            <TeamTable
              rows={roster.unmatched}
              href={(patch) => href(search, patch)}
              jiraBaseUrl={jiraBaseUrl}
              linkRows={false}
              empty="Every assignee resolves to somebody."
            />
          </Card>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-faint">
        This page reads the board and Jira. It shows <strong>no chat</strong>: conversations are
        readable only by their members, and holding <em>oversee</em> does not change that. Availability
        is derived from claims and live Jira tickets, so somebody with no ticket assigned reads as free
        whatever they are actually doing.
      </p>
    </Page>
  );
}

/*
 * On the availability filter and the "busy" chip: the chip counts busy AND
 * overloaded, because the tile above it does, and a number that changes meaning
 * between the tile and the filter would be worse than no number. Selecting it
 * shows both; Overloaded narrows to the subset. filterWorkloadRows() carries the
 * same special case, and that is the only place it lives.
 */
