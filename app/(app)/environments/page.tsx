import Link from "next/link";
import { AvatarStack, PeopleCell } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Dash, JiraChip, StatusChip } from "@/components/ui/Chips";
import { TicketLink } from "@/components/ui/JiraLinks";
import { Page, PageHead } from "@/components/ui/Layout";
import { RepoStrip } from "@/components/ui/RepoStrip";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingBar, TicketTitle } from "@/components/ui/TicketCell";
import { formatDateTime } from "@/lib/shared/format";
import { can, currentUserOrNull } from "@/lib/auth/require";
import { AddEnvironmentButton } from "@/components/settings/EnvironmentsCard";
import { getBoard } from "@/lib/db/queries/board";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { describeJiraConfig } from "@/lib/jira/client";
import { myClaims } from "@/lib/shared/mine";
import { ENV_STATE } from "@/lib/shared/tokens";
import {
  envRows,
  filterEnvRows,
  isUrgent,
  leftText,
  minutesLeft,
  normalizeEnvView,
  statusCounts,
  type EnvRow,
} from "@/lib/shared/view-model";
import type { Account, EnvStatus } from "@/lib/types";

/**
 * Every environment, free or held.
 *
 * Filters live in the URL rather than in memory, which the legacy version could
 * not do — so a filtered view is now shareable, survives a reload, and the back
 * button works. Each chip is a plain link, so the whole page stays server
 * rendered with no client JavaScript.
 */
export const metadata = { title: "Environments · Glophics Portal" };

type Search = { status?: string; account?: string; q?: string; mine?: string; view?: string };

function href(base: Search, patch: Search): string {
  const params = new URLSearchParams();
  const merged = { ...base, ...patch };

  for (const [key, value] of Object.entries(merged)) {
    // "all" and empty are the default, so they are omitted rather than written —
    // a clean URL for the unfiltered view.
    if (value && value !== "all") params.set(key, value);
  }
  const query = params.toString();
  return query ? `/environments?${query}` : "/environments";
}

function StatusFilter({
  search,
  value,
  label,
  count,
}: {
  search: Search;
  value: string;
  label: string;
  count: number;
}) {
  const active = (search.status ?? "all") === value;
  return (
    <Link
      href={href(search, { status: value })}
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors ${
        active ? "border-brand-500 bg-brand-soft text-brand-fg" : "border-line-2 bg-surface text-body hover:border-faintest hover:text-ink"
      }`}
    >
      {value !== "all" ? (
        <span className={`h-1.5 w-1.5 rounded-full ${ENV_STATE[value as EnvStatus].dot}`} />
      ) : null}
      {label} {count}
    </Link>
  );
}

function EnvironmentRow({ row, jiraBaseUrl }: { row: EnvRow; jiraBaseUrl: string | null }) {
  const token = ENV_STATE[row.state];
  const minutes = row.soonest ? minutesLeft(row.soonest) : null;
  /* The first ticket is the one the row reports on; the rest are a count, and
     the environment page lists them all. It is the soonest-to-free one when
     there is one, so the Ticket and Booked-until cells describe the same claim. */
  const first_claim = row.soonest ?? row.claims[0] ?? null;

  return (
    <Tr>
      <Td>
        <Link href={`/environments/${encodeURIComponent(row.id)}`} className="group flex items-center gap-3">
          <span className={`h-7 w-1 shrink-0 rounded-full ${token.dot}`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold group-hover:text-brand-fg group-hover:underline">
              {row.name}
            </span>
            <span className="block truncate text-xs text-faint">{row.accountName}</span>
          </span>
        </Link>
      </Td>

      <Td>
        <RepoStrip env={row.env} claims={row.claims} />
        <p className="mt-1 text-[11px] text-faint">
          {row.freeRepos.length} of {row.repos.length} free
        </p>
      </Td>

      <Td>
        <StatusChip status={row.state} />
      </Td>

      <Td>
        <div className="max-w-[12rem]">
          {row.people.length ? <PeopleCell people={row.people} /> : <Dash />}
        </div>
      </Td>

      <Td>
        {first_claim ? (
          <div className="max-w-[22rem]">
            <div className="flex flex-wrap items-center gap-1.5">
              <TicketLink
                ticketKey={first_claim.id}
                source={first_claim.source}
                jiraBaseUrl={jiraBaseUrl}
                className="text-xs font-semibold text-brand-fg"
              />
              <JiraChip status={first_claim.status} />
              {row.ticketIds.length > 1 ? (
                <span
                  className="rounded-full bg-subtle-2 px-1.5 text-[11px] font-semibold text-muted"
                  title={row.ticketIds.slice(1).join(", ")}
                >
                  +{row.ticketIds.length - 1}
                </span>
              ) : null}
            </div>
            <div className="mt-1">
              <TicketTitle claim={first_claim} lines={1} className="text-xs text-body" />
            </div>
          </div>
        ) : (
          <Dash />
        )}
      </Td>

      <Td>
        {row.soonest ? (
          <>
            <p
              className={`text-sm ${
                minutes !== null && minutes <= 0
                  ? "font-semibold text-bad"
                  : isUrgent(minutes)
                    ? "font-semibold text-warn"
                    : "text-body"
              }`}
            >
              {minutes !== null && minutes <= 0 ? "Overdue" : leftText(minutes)}
            </p>
            <BookingBar claim={row.soonest} minutes={minutes} className="mt-1.5 w-24" />
            <p className="mt-1 whitespace-nowrap text-[11px] text-faint">
              until {formatDateTime(row.soonest.endTime)}
            </p>
          </>
        ) : row.claims.length ? (
          <span className="text-xs text-faint">No end time</span>
        ) : (
          <span className="text-sm font-medium text-ok">Ready to book</span>
        )}
      </Td>

      <Td className="text-right">
        <ButtonLink
          href={`/environments/${encodeURIComponent(row.id)}`}
          size="sm"
          variant={row.freeRepos.length ? "dark" : "quiet"}
          className="whitespace-nowrap"
        >
          {row.freeRepos.length ? "Assign" : "Open"}
        </ButtonLink>
      </Td>
    </Tr>
  );
}

function ViewToggle({ search, value, label }: { search: Search; value: "table" | "matrix"; label: string }) {
  const active = normalizeEnvView(search.view) === value;

  return (
    <Link
      href={href(search, { view: value })}
      aria-pressed={active}
      className={`inline-flex h-6 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors ${
        active
          ? "bg-surface text-ink shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]"
          : "text-muted hover:text-ink"
      }`}
    >
      {value === "table" ? <span className="text-[12px]">▤</span> : <span className="text-[12px]">▦</span>}
      {label}
    </Link>
  );
}

function MatrixView({
  rows,
  accounts,
  jiraBaseUrl,
}: {
  rows: EnvRow[];
  accounts: Account[];
  jiraBaseUrl: string | null;
}) {
  const repoOrder = ["storefront", "backend", "admin"];
  const repoNames = [...new Set(rows.flatMap((row) => row.repos.map((repo) => repo.repoName)))];
  const orderedRepos = [...repoOrder.filter((repo) => repoNames.includes(repo)), ...repoNames.filter((repo) => !repoOrder.includes(repo))];
  const groups = accounts.filter((account) => rows.some((row) => row.accountId === account.id));

  const repoLabel = (repo: string) => {
    const labels: Record<string, string> = { storefront: "Frontend", backend: "API", admin: "Admin" };
    return labels[repo] ?? repo;
  };

  return (
    <div className="overflow-hidden glass rounded-[20px] bg-surface ring-1 ring-line">
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left">
          <thead>
            <tr className="border-b border-line bg-subtle text-xs font-medium text-muted">
              <Th>Account</Th>
              {orderedRepos.map((repo) => (
                <Th key={repo}>{repoLabel(repo)}</Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {groups.map((account) => {
              const accountRows = rows.filter((row) => row.accountId === account.id);

              return (
                <Tr key={account.id}>
                  <Td>
                    <div className="min-w-[180px]">
                      <p className="text-sm font-semibold">{account.displayName}</p>
                    </div>
                  </Td>

                  {orderedRepos.map((repo) => {
                    const cells = accountRows.flatMap((row) =>
                      row.claims
                        .filter((claim) => claim.repos.includes(repo))
                        .map((claim) => ({ claim, envName: row.name, people: row.people })),
                    );

                    return (
                      <Td key={`${account.id}-${repo}`} className="align-top">
                        {!cells.length ? (
                          <span className="text-xs font-medium text-ok">Free</span>
                        ) : (
                          <div className="space-y-2">
                            {cells.map(({ claim, envName, people }) => (
                              <div key={`${claim.id}-${repo}`} className="rounded-lg border border-line-soft bg-subtle-2 p-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <TicketLink
                                    ticketKey={claim.id}
                                    source={claim.source}
                                    jiraBaseUrl={jiraBaseUrl}
                                    className="text-xs font-semibold text-brand-fg"
                                    iconClassName="h-2.5 w-2.5 opacity-60"
                                  />
                                  <JiraChip status={claim.status} />
                                </div>
                                <div className="mt-1 max-w-[16rem]">
                                  <TicketTitle claim={claim} lines={2} className="text-xs leading-4 text-body" />
                                </div>
                                <div className="mt-1.5 flex items-center gap-2 min-w-0">
                                  {people.length ? <AvatarStack people={people} max={2} /> : null}
                                  {people.length ? (
                                    <span className="truncate text-[11px] text-faint" title={people.map((person) => person.name).join(", ")}>
                                      {people.slice(0, 2).map((person) => person.name).join(", ")}
                                      {people.length > 2 ? ` +${people.length - 2}` : ""}
                                    </span>
                                  ) : null}
                                </div>
                                {/* The cell used to send you to the environment
                                    from the ticket key. The key now opens the
                                    ticket, so the environment keeps its own
                                    link here rather than losing one. */}
                                <Link
                                  href={`/environments/${encodeURIComponent(claim.serverId)}`}
                                  className="mt-1 block truncate text-[11px] text-faint hover:text-brand-fg hover:underline"
                                  title={envName}
                                >
                                  {envName}
                                </Link>
                              </div>
                            ))}
                          </div>
                        )}
                      </Td>
                    );
                  })}
                </Tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function EnvironmentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const jiraBaseUrl = describeJiraConfig().baseUrl;
  const [board, user, avatars] = await Promise.all([
    getBoard(),
    currentUserOrNull(),
    avatarVersions(),
  ]);
  const { accounts, environments, claims, directory } = board;

  const all = envRows(environments, accounts, claims, directory, avatars);
  const counts = statusCounts(all);
  const view = normalizeEnvView(search.view);

  const mineIds = new Set(myClaims(claims, user, directory).map((c) => c.id));
  const showMine = search.mine === "1";

  const rows = filterEnvRows(
    all,
    { status: search.status, account: search.account, q: search.q, mine: showMine },
    mineIds,
  );

  const filtered = rows.length !== all.length;
  const account = accounts.find((a) => a.id === search.account);

  return (
    <Page>
      <PageHead
        title="Environments"
        sub={
          <>
            {all.length} environment{all.length === 1 ? "" : "s"} across {accounts.length} account
            {accounts.length === 1 ? "" : "s"}
            {account ? ` · filtered to ${account.displayName}` : ""}
          </>
        }
        actions={
          // Courtesy only: POST /api/servers is the boundary (`configure`).
          can(user, "configure") ? <AddEnvironmentButton accounts={accounts} /> : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 pb-5">
        <div className="inline-flex h-8 items-center gap-0.5 rounded-md bg-subtle-2 p-1">
          <span className="px-1.5 text-xs text-muted">View</span>
          <ViewToggle search={search} value="table" label="Table" />
          <ViewToggle search={search} value="matrix" label="Matrix" />
        </div>

        <StatusFilter search={search} value="all" label="All" count={all.length} />
        {(Object.keys(counts) as EnvStatus[]).map((key) => (
          <StatusFilter
            key={key}
            search={search}
            value={key}
            label={ENV_STATE[key].label}
            count={counts[key]}
          />
        ))}

        {/* Disabled rather than hidden when there is nothing to match on, so the
            control does not appear and disappear between users. */}
        {mineIds.size || showMine ? (
          <Link
            href={href(search, { mine: showMine ? "" : "1" })}
            className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors ${
              showMine ? "border-brand-500 bg-brand-soft text-brand-fg" : "border-line-2 bg-surface text-body hover:border-faintest hover:text-ink"
            }`}
          >
            My servers
          </Link>
        ) : (
          <span
            title="Nothing on the board is assigned to you"
            className="inline-flex h-7 cursor-not-allowed items-center rounded-md border border-line bg-subtle px-2.5 text-xs font-medium text-faint"
          >
            My servers
          </span>
        )}

        {filtered || search.q ? (
          <Link href="/environments" className="ml-1 text-xs font-semibold text-brand-fg hover:underline">
            Clear filters
          </Link>
        ) : null}
      </div>

      {view === "matrix" ? (
        <MatrixView rows={rows} accounts={accounts} jiraBaseUrl={jiraBaseUrl} />
      ) : (
        <Table
          isEmpty={!rows.length}
          empty={
            filtered || search.q
              ? "No environment matches these filters."
              : "No environments configured yet — add one in Settings."
          }
          head={
            <>
              <Th>Environment</Th>
              <Th>Repositories</Th>
              <Th>Status</Th>
              <Th>Assigned to</Th>
              <Th>Ticket</Th>
              <Th>Booked until</Th>
              <Th className="text-right" />
            </>
          }
        >
          {rows.map((row) => (
            <EnvironmentRow key={row.id} row={row} jiraBaseUrl={jiraBaseUrl} />
          ))}
        </Table>
      )}
    </Page>
  );
}
