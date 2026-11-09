import Link from "next/link";
import { HealthActions } from "@/components/health/HealthActions";
import { Dash, HealthChip, Muted } from "@/components/ui/Chips";
import { Notice, Page, PageHead, StatTile } from "@/components/ui/Layout";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { getBoard } from "@/lib/db/queries/board";
import { agoText } from "@/lib/shared/format";
import { HEALTH_CHECK_INTERVAL_MS, isStale, newestCheck } from "@/lib/shared/health";
import { HEALTH } from "@/lib/shared/tokens";
import {
  filterRepoRows,
  isRepoSort,
  repoFilterCounts,
  repoRows,
  sortRepoRows,
  type RepoSort,
} from "@/lib/shared/view-model";
import type { RepoHealth } from "@/lib/types";

/**
 * Is each repository actually up?
 *
 * Something writes this now. lib/health/check.ts probes every repository that
 * has a URL and records both the verdict AND the time it was taken; a pass is
 * triggered daily by Vercel Cron, by the "Check servers" button here, and hourly
 * by a timer in the header pill (components/shell/HealthButton.tsx). That pill
 * is in the app shell, so the schedule follows you around the app instead of
 * living on this page — which also makes it the scheduler `npm run dev` has,
 * since cron only exists on a deployment.
 *
 * Two things this page must keep doing regardless:
 *
 *   - NEVER present a stale or absent check as `offline`. An offline repository
 *     outranks everything in the derived status, so a reporting outage would
 *     otherwise paint the whole board red — a louder failure than admitting the
 *     board does not know. `health_checked_at` is what makes the difference
 *     sayable: "not checked" is a different statement from "down".
 *
 *   - Say when the data was measured. On an hourly cadence a repository can be
 *     down for most of an hour before this page notices, so the age of the
 *     result is part of the result.
 *
 * ⚠ Every URL configured today is a public dev domain, which is why a Vercel
 * function can reach them at all. An environment on an internal hostname would
 * read `offline` from the cloud while being perfectly healthy — see
 * docs/06-OPEN-QUESTIONS.md Q1.
 *
 * ── Filters and sorting ──
 *
 * Both live in the URL, following the Environments page: a narrowed view is
 * shareable ("here are the four that are down"), survives a reload, and the back
 * button works. Every control is a plain link, so the whole page stays server
 * rendered — the only client JavaScript here is the Check servers button.
 */
export const metadata = { title: "Health · Glophics Portal" };

type Search = { health?: string; repo?: string; account?: string; sort?: string; dir?: string };

function href(base: Search, patch: Search): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...patch };

  for (const [key, value] of Object.entries(merged)) {
    // "all" and empty are the default view, so they are left out rather than
    // written — an unfiltered board has a clean URL.
    if (value && value !== "all") params.set(key, value);
  }
  const query = params.toString();
  return query ? `/health?${query}` : "/health";
}

/** One value of one filter. Reads as a solid pill when it is the active cut. */
function FilterLink({
  search,
  param,
  value,
  label,
  count,
  dot,
}: {
  search: Search;
  param: "health" | "repo";
  value: string;
  label: string;
  count: number;
  dot?: string;
}) {
  const active = (search[param] ?? "all") === value;
  return (
    <Link
      href={href(search, { [param]: value })}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
        active ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line-2 hover:text-ink"
      }`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      {label} {count}
    </Link>
  );
}

/**
 * A sortable column heading.
 *
 * Clicking an inactive column sorts by it; clicking the active one reverses it.
 * The arrow is decorative — `aria-sort` on the cell is what a screen reader
 * reads, which is why Th spreads its props.
 */
function SortTh({
  search,
  column,
  label,
  className = "",
}: {
  search: Search;
  column: RepoSort;
  label: string;
  className?: string;
}) {
  const active = isRepoSort(search.sort) && search.sort === column;
  const descending = active && search.dir === "desc";

  return (
    <Th className={className} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
      <Link
        href={href(search, { sort: column, dir: active && !descending ? "desc" : "asc" })}
        className={`inline-flex items-center gap-1 transition hover:text-brand-fg ${
          active ? "text-brand-fg" : ""
        }`}
      >
        {label}
        <span aria-hidden className={active ? "" : "text-faintest"}>
          {active ? (descending ? "↓" : "↑") : "↕"}
        </span>
      </Link>
    </Th>
  );
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const { accounts, environments, claims } = await getBoard();
  const all = repoRows(environments, accounts, claims);

  const filters = { health: search.health, repo: search.repo, account: search.account };
  const rows = sortRepoRows(filterRepoRows(all, filters), search.sort, search.dir);
  const counts = repoFilterCounts(all, filters);

  const filtered = rows.length !== all.length;
  const account = counts.account.find((a) => a.id === search.account);

  // The tiles summarise the BOARD, not the current cut — "how are we doing?" is
  // a different question from "what am I looking at?", and the sub-line above
  // already says which rows are on screen.
  const offline = all.filter((r) => r.health === "offline");
  const online = all.filter((r) => r.health === "online");
  const unconfigured = all.filter((r) => r.health === "unconfigured");

  // Repositories with a URL are the ones a pass can measure; the rest are
  // `unconfigured` and carry no timestamp, which would otherwise drag the
  // "checked" figures down for ever.
  const checkable = all.filter((r) => r.url);
  const newest = newestCheck(all.map((r) => r.healthCheckedAt));

  const noChecksYet = !newest && checkable.length > 0;
  const stale = isStale(newest);

  return (
    <Page>
      <PageHead
        title="Health"
        sub={
          <>
            {newest
              ? `Last checked ${agoText(newest)} ago · every ${Math.round(HEALTH_CHECK_INTERVAL_MS / 60_000)} min`
              : "No endpoint has been checked yet"}
            {filtered ? ` · showing ${rows.length} of ${all.length}` : ""}
            {account ? ` · ${account.name}` : ""}
          </>
        }
        actions={
          <HealthActions
            // No `lastCheckedAt` any more: this is now purely the forcing
            // button, and only the timer needed to know when the last pass was.
            // That timer lives in the header — components/shell/HealthButton.tsx
            // — where it covers every page instead of just this one.
            checkableCount={checkable.length}
          />
        }
      />

      {noChecksYet ? (
        <Notice tone="warn" title="No health checks have run yet">
          Every repository below shows its last imported state, not a measured one — these are
          <em> unknown</em>, not down. Press <strong>Check servers</strong> to take a real reading.
        </Notice>
      ) : stale ? (
        <Notice tone="warn" title="Health data is stale">
          The most recent check was {agoText(newest!)} ago — more than two scheduled passes back, so
          the checks have stopped running rather than merely being late. The states below may no
          longer be true. <strong>Check servers</strong> takes a reading now; if that works, the cron
          job (<code>/api/cron/health</code>) is what needs looking at.
        </Notice>
      ) : null}

      <section className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile tone="bad" label="Offline" value={offline.length} sub="need attention" icon="alert" />
        <StatTile tone="ok" label="Online" value={online.length} sub="responding" icon="check" />
        <StatTile
          tone="neutral"
          label="No URL set"
          value={unconfigured.length}
          sub="nothing to check"
          icon="plug"
        />
        <StatTile tone="brand" label="Endpoints" value={all.length} sub="across every account" icon="servers" />
      </section>

      <div className="flex flex-wrap items-center gap-2 pb-5">
        <FilterLink search={search} param="health" value="all" label="All" count={counts.totals.health} />
        {(["offline", "online", "unconfigured"] as RepoHealth[]).map((key) => (
          <FilterLink
            key={key}
            search={search}
            param="health"
            value={key}
            label={HEALTH[key].label}
            count={counts.health[key]}
            dot={HEALTH[key].dot}
          />
        ))}

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        <FilterLink search={search} param="repo" value="all" label="Every repo" count={counts.totals.repo} />
        {counts.repo.map((entry) => (
          <FilterLink
            key={entry.name}
            search={search}
            param="repo"
            value={entry.name}
            label={entry.name}
            count={entry.count}
          />
        ))}

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        {/* Ten accounts is too many for a chip row, and a <select> would need
            client JavaScript to navigate on change. <details> is a disclosure
            widget the browser opens on its own, so the account picker costs
            nothing and still works with JS off. */}
        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 text-[11px] font-semibold text-muted ring-1 ring-line-2 transition hover:text-ink [&::-webkit-details-marker]:hidden">
            {account ? account.name : "Every account"}
            <span aria-hidden className="text-faintest">
              ▾
            </span>
          </summary>
          <div className="absolute left-0 z-20 mt-1.5 max-h-80 w-60 overflow-y-auto rounded-xl bg-surface p-1 shadow-lg ring-1 ring-line">
            <Link
              href={href(search, { account: "all" })}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition hover:bg-subtle ${
                account ? "text-muted" : "text-brand-fg"
              }`}
            >
              Every account
              <span className="text-[10px] text-faint">{counts.totals.account}</span>
            </Link>
            {counts.account.map((entry) => (
              <Link
                key={entry.id}
                href={href(search, { account: entry.id })}
                className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs font-semibold transition hover:bg-subtle ${
                  entry.id === search.account ? "text-brand-fg" : "text-body"
                }`}
              >
                <span className="truncate">{entry.name}</span>
                <span className="text-[10px] text-faint">{entry.count}</span>
              </Link>
            ))}
          </div>
        </details>

        {filtered || isRepoSort(search.sort) ? (
          <Link href="/health" className="ml-1 text-[11px] font-semibold text-brand-fg hover:underline">
            Reset
          </Link>
        ) : null}
      </div>

      <Table
        isEmpty={!rows.length}
        empty={filtered ? "No repository matches these filters." : "No repositories configured yet."}
        head={
          <>
            <SortTh search={search} column="repo" label="Repository" />
            <SortTh search={search} column="account" label="Account" />
            <SortTh search={search} column="env" label="Environment" />
            <SortTh search={search} column="health" label="Health" />
            <SortTh search={search} column="checked" label="Checked" />
            <Th>URL</Th>
            <Th>Held by</Th>
          </>
        }
        minWidth="min-w-[1040px]"
      >
        {rows.map((row) => (
          <Tr key={`${row.serverId}::${row.repo}`}>
            <Td>
              <p className="text-sm font-semibold">{row.repo}</p>
            </Td>

            <Td>
              {/* Clicking an account narrows to it — the filter people actually
                  reach for is "everything belonging to this client". */}
              <Link
                href={href(search, { account: row.accountId })}
                className="text-xs text-muted hover:text-brand-fg hover:underline"
              >
                {row.accountName}
              </Link>
            </Td>

            <Td>
              <Link
                href={`/environments/${encodeURIComponent(row.serverId)}`}
                className="text-sm font-medium text-body hover:text-brand-fg hover:underline"
              >
                {row.env}
              </Link>
            </Td>

            <Td>
              <HealthChip health={row.health} />
            </Td>

            <Td>
              {row.healthCheckedAt ? (
                <span className="whitespace-nowrap text-xs text-body">
                  {agoText(row.healthCheckedAt)} ago
                </span>
              ) : (
                <Muted>Never</Muted>
              )}
            </Td>

            <Td>
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted hover:text-brand-fg hover:underline"
                >
                  {row.url}
                </a>
              ) : (
                <Muted>No URL configured</Muted>
              )}
            </Td>

            <Td>
              {row.claims.length ? (
                <span className="text-xs font-semibold text-brand-fg">
                  {row.claims.map((c) => c.id).join(", ")}
                </span>
              ) : (
                <Dash />
              )}
            </Td>
          </Tr>
        ))}
      </Table>
    </Page>
  );
}
