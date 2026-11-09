import Link from "next/link";
import { PeopleCell } from "@/components/ui/Avatar";
import { JiraAutoSync } from "@/components/dashboard/JiraAutoSync";
import { Chip, Dash, JiraChip } from "@/components/ui/Chips";
import { Icon } from "@/components/ui/Icon";
import { ClaimRepoLinks, TicketLink } from "@/components/ui/JiraLinks";
import { Empty, Page, StatTile } from "@/components/ui/Layout";
import { RepoStrip } from "@/components/ui/RepoStrip";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingBar, TicketCell, TicketTitle } from "@/components/ui/TicketCell";
import { can, currentUserOrNull } from "@/lib/auth/require";
import { getBoard, getJiraIssues } from "@/lib/db/queries/board";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { describeJiraConfig, issueUrl } from "@/lib/jira/client";
import { boardSummary } from "@/lib/shared/occupancy";
import { jiraActivity } from "@/lib/shared/activity";
import { formatDateTime } from "@/lib/shared/format";
import { jiraBranchConflicts, type JiraBranchConflict } from "@/lib/shared/jira-conflicts";
import { ENV_STATE, TONE, shortRepo } from "@/lib/shared/tokens";
import type { Claim, DirectoryUser, Environment } from "@/lib/types";
import {
  boardRows,
  claimRows,
  envRows,
  isUrgent,
  leftText,
  minutesLeft,
  nullsLast,
  peopleOf,
  type EnvRow,
  type TicketRow,
} from "@/lib/shared/view-model";

/** Overview of the pool: what's free, what's held, and what frees up next. */
export const metadata = { title: "Dashboard · Glophics Portal" };

const TABLE_LIMIT = 5;

function JiraConflictNotice({
  conflicts,
  jira_base_url,
}: {
  conflicts: Map<string, JiraBranchConflict>;
  jira_base_url: string | null;
}) {
  if (!conflicts.size) return null;

  const ticket_ids = [...conflicts.keys()].sort();
  const repos = [...new Set([...conflicts.values()].flatMap((conflict) => conflict.repos))];

  return (
    <div
      className="mb-4 flex gap-3 rounded-2xl bg-warn-soft px-4 py-3.5 text-warn ring-1 ring-warn-soft"
      role="status"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface/70">
        <Icon name="alert" className="h-4 w-4" />
      </span>
      <div className="min-w-0 text-xs leading-5">
        <p className="font-bold">
          Branch conflict detected in {ticket_ids.length} ticket{ticket_ids.length === 1 ? "" : "s"}
        </p>
        <p className="text-warn/90">
          Tickets in In Progress or QA Testing (Stg) share the same account, branch, and{" "}
          {repos.map(shortRepo).join(", ")} repository. Assign a different branch to the affected tickets.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[10px] font-bold uppercase tracking-wide">Affected tickets</span>
          {ticket_ids.map((ticket_id) =>
            jira_base_url ? (
              <a
                key={ticket_id}
                href={issueUrl(jira_base_url, ticket_id)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${ticket_id} in Jira`}
                className="inline-flex items-center gap-1 rounded-md bg-surface/80 px-2 py-1 text-[10px] font-bold text-warn ring-1 ring-warn-soft transition hover:bg-surface hover:ring-warn"
              >
                {ticket_id}
                <Icon name="external" className="h-2.5 w-2.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <strong
                key={ticket_id}
                className="rounded-md bg-surface/80 px-2 py-1 text-[10px] ring-1 ring-warn-soft"
              >
                {ticket_id}
              </strong>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

/** How many held tickets a card lists before summarising the rest. Three is
 *  what fits beside two other cards without one card towering over the row. */
const CARD_TICKETS = 3;

/**
 * An environment that is not free, as a card that answers the questions people
 * open the dashboard with: which tickets are on it, what they ARE (the title,
 * not just the key), who has them, what state they are in, and when it frees.
 *
 * It used to show the environment and a comma-separated line of bare keys, so
 * every card was a click into Jira before it told you anything.
 */
function HeldCard({
  row,
  jira_base_url,
  directory,
  avatars,
}: {
  row: EnvRow;
  jira_base_url: string | null;
  directory: DirectoryUser[];
  avatars: Map<string, string>;
}) {
  const token = ENV_STATE[row.state];
  const tone = TONE[token.tone];
  const minutes = row.soonest ? minutesLeft(row.soonest) : null;
  const tickets = [...row.claims].sort(
    (a, b) => nullsLast(minutesLeft(a)) - nullsLast(minutesLeft(b)) || a.id.localeCompare(b.id),
  );
  const shown = tickets.slice(0, CARD_TICKETS);
  const more = tickets.length - shown.length;
  const href = `/environments/${encodeURIComponent(row.id)}`;

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-line transition hover:shadow-md">
      <div className={`p-4 ${tone.soft}`}>
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-surface/70 px-2.5 py-1 text-[10px] font-bold backdrop-blur ${tone.fg}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${token.dot}`} />
            {token.label}
          </span>
          <span className="truncate rounded-md bg-surface/70 px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted">
            {row.accountName.toUpperCase()}
          </span>
        </div>
        <Link href={href} className="mt-2.5 block truncate text-[15px] font-bold hover:underline">
          {row.name}
        </Link>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <RepoStrip env={row.env} claims={row.claims} />
          <span className="whitespace-nowrap text-[11px] font-semibold text-body">
            {row.freeRepos.length} of {row.repos.length} free
          </span>
        </div>
      </div>

      <div className="flex-1 divide-y divide-line-soft px-4">
        {shown.length ? (
          shown.map((claim) => {
            const people = peopleOf([claim], directory, avatars);
            const left = minutesLeft(claim);
            return (
              <div key={claim.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <TicketLink
                      ticketKey={claim.id}
                      source={claim.source}
                      jiraBaseUrl={jira_base_url}
                      className="text-xs font-bold text-brand-fg"
                      iconClassName="h-2.5 w-2.5 opacity-60"
                    />
                    <JiraChip status={claim.status} />
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {claim.repos.map((repo) => (
                      <span
                        key={repo}
                        title={repo}
                        className="rounded bg-subtle-2 px-1.5 py-0.5 text-[9px] font-bold text-muted"
                      >
                        {shortRepo(repo)}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="mt-1.5">
                  <TicketTitle claim={claim} lines={2} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <PeopleCell people={people} max={2} />
                  </div>
                  <span
                    className={`shrink-0 whitespace-nowrap text-[11px] font-semibold ${
                      left !== null && left <= 0 ? "text-bad" : isUrgent(left) ? "text-warn" : "text-muted"
                    }`}
                  >
                    {left === null ? "No end time" : left <= 0 ? "Overdue" : leftText(left)}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <p className="py-4 text-[12px] text-faint">
            {row.offline.length
              ? `${row.offline.map(shortRepo).join(", ")} offline — nothing is booked on it`
              : "No active claim"}
          </p>
        )}
      </div>

      <div className="border-t border-line-soft bg-subtle/60 px-4 py-3">
        {row.soonest ? (
          <>
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={isUrgent(minutes) ? "font-semibold text-warn" : "text-muted"}>
                {minutes !== null && minutes <= 0
                  ? "Booking overdue"
                  : `First repo frees in ${leftText(minutes)}`}
              </span>
              <span className="whitespace-nowrap text-faint">{formatDateTime(row.soonest.endTime)}</span>
            </div>
            <BookingBar claim={row.soonest} minutes={minutes} className="mt-1.5 w-full" />
          </>
        ) : (
          <p className="text-[11px] text-faint">{row.claims.length ? "No end time set" : "Nothing booked"}</p>
        )}
        <div className="mt-2.5 flex items-center justify-between text-[11px]">
          <span className="text-faint">
            {more > 0
              ? `+${more} more ticket${more === 1 ? "" : "s"}`
              : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
          </span>
          <Link href={href} className="inline-flex items-center gap-1 font-semibold text-brand-fg hover:underline">
            Open environment
            <Icon name="chevron" className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </article>
  );
}

/** One row of the Latest Jira updates panel — Ticket (+ activity badge and
 *  message), Summary, Assignee, Status, Branch, Repos. */
function JiraUpdateRow({
  row,
  activity,
  jira_base_url,
  environments,
  claims,
}: {
  row: TicketRow;
  activity: ReturnType<typeof jiraActivity>;
  jira_base_url: string | null;
  environments: Environment[];
  claims: Claim[];
}) {
  return (
    <Tr className="group">
      <Td className="w-[40%] align-top">
        <TicketCell
          claim={row.claim}
          jiraBaseUrl={jira_base_url}
          showUpdated
          badge={activity ? <Chip className={activity.chipClassName}>{activity.badge}</Chip> : null}
        />
        {activity ? (
          <p className="mt-1.5 max-w-[30rem] whitespace-normal break-words border-l-2 border-line-2 pl-2 text-[11px] leading-4 text-muted">
            {activity.message}
          </p>
        ) : null}
      </Td>
      <Td className="w-[16%] align-top">
        <div className="max-w-[13rem]">
          <PeopleCell people={row.people} max={3} />
        </div>
      </Td>
      <Td className="w-[14%] align-top">
        <JiraChip status={row.claim.status} />
      </Td>
      <Td className="w-[18%] align-top">
        {row.serverId ? (
          <Link
            href={`/environments/${encodeURIComponent(row.serverId)}`}
            className="block truncate text-xs font-semibold text-ink-2 hover:text-brand-fg hover:underline"
          >
            {row.env}
          </Link>
        ) : null}
        <p className="mt-1 inline-flex max-w-[12rem] whitespace-normal break-all rounded-lg bg-subtle-2 px-2 py-1 font-mono text-[11px] font-medium text-body">
          {row.claim.branch ?? row.env}
        </p>
      </Td>
      <Td className="w-[12%] align-top">
        {row.claim.repos.length ? (
          <ClaimRepoLinks
            repos={row.claim.repos}
            environment={environments.find((env) => env.id === row.serverId)}
            claims={claims}
          />
        ) : (
          <Dash />
        )}
      </Td>
    </Tr>
  );
}

export default async function DashboardPage() {
  const jira_base_url = describeJiraConfig().baseUrl;
  const [{ accounts, environments, claims, directory, settings }, issues, user, avatars] = await Promise.all([
    getBoard(),
    getJiraIssues(),
    currentUserOrNull(),
    avatarVersions(),
  ]);

  const summary = boardSummary(environments, claims);
  const rows = envRows(environments, accounts, claims, directory, avatars);

  // The three closest to freeing up, of whatever is not free.
  const held = rows
    .filter((r) => r.state !== "free")
    .sort((a, b) => nullsLast(minutesLeft(a.soonest ?? {})) - nullsLast(minutesLeft(b.soonest ?? {})))
    .slice(0, 3);

  const tickets = claimRows(environments, accounts, claims, directory, avatars);

  // Every Jira-sourced ticket touched recently, holding a repository or not —
  // most recently updated first. Nothing here is a diff against a previous
  // sync (see lib/shared/activity.ts); it's just recency.
  const jira_rows = [...tickets, ...boardRows(issues, environments, accounts, directory, avatars)].filter(
    (row) => row.claim.source === "jira",
  );
  const branch_conflicts = jiraBranchConflicts(
    jira_rows.map((row) => ({
      ticketId: row.claim.id,
      status: row.claim.status,
      accountName: row.accountName,
      branch: row.claim.branch,
      repos: row.claim.repos,
    })),
  );
  const jiraUpdates = jira_rows
    .filter((row) => row.claim.jiraUpdatedAt)
    .sort((a, b) => new Date(b.claim.jiraUpdatedAt!).getTime() - new Date(a.claim.jiraUpdatedAt!).getTime())
    .slice(0, TABLE_LIMIT);

  const repoOffline = environments.reduce(
    (n, env) => n + env.repos.filter((r) => r.health === "offline").length,
    0,
  );

  return (
    <Page>
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 px-8 py-7 text-white">
        <svg
          className="pointer-events-none absolute -right-6 top-1/2 h-56 w-56 -translate-y-1/2 text-white/15"
          viewBox="0 0 100 100"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M50 4c2 26 18 42 44 46-26 4-42 20-46 46-4-26-20-42-46-46 26-4 42-20 48-46z" />
        </svg>

        <p className="text-[11px] font-bold tracking-[0.16em] text-white/70">ENVIRONMENT POOL</p>
        <h1 className="mt-2 max-w-lg text-[27px] font-bold leading-tight tracking-tight">
          {summary.free === 0 ? (
            "Every environment is taken"
          ) : (
            <>
              {summary.free} environment{summary.free === 1 ? " is" : "s are"} free
              <br />
              and ready to book
            </>
          )}
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/75">
          {summary.free === 0
            ? "Free one up, or wait for the next booking to end."
            : "Claim one before your ticket reaches QA testing."}
        </p>

        {/* text-on-accent is explicit: the section sets text-white, which would
            otherwise be inherited onto a button that goes light in dark mode. */}
        <Link
          href="/environments"
          className="mt-5 inline-flex items-center gap-2.5 rounded-full bg-accent py-2.5 pl-5 pr-2.5 text-sm font-semibold text-on-accent transition hover:bg-accent-2"
        >
          Browse environments
          <span className="grid h-6 w-6 place-items-center rounded-full bg-on-accent/15">
            <Icon name="chevron" className="h-3 w-3" />
          </span>
        </Link>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          tone="ok"
          label="Available now"
          value={summary.free}
          sub={`of ${summary.total} environments`}
          icon="check"
        />
        <StatTile
          tone="warn"
          label="In use"
          value={summary.inuse}
          sub={`${summary.claimsCount} active claim${summary.claimsCount === 1 ? "" : "s"}`}
          icon="clock"
        />
        <StatTile
          tone="bad"
          label="Needs attention"
          value={summary.needsAttention}
          sub={`${repoOffline} endpoint${repoOffline === 1 ? "" : "s"} offline`}
          icon="alert"
        />
        <StatTile
          tone="brand"
          label="Freeing up soon"
          value={summary.freeingSoon}
          sub="within 2 hours"
          icon="clock"
        />
      </section>

      <section className="mt-7">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold tracking-tight">Held right now</h2>
          <Link href="/in-use" className="text-xs font-semibold text-brand-fg hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {held.length ? (
            held.map((row) => (
              <HeldCard
                key={row.id}
                row={row}
                jira_base_url={jira_base_url}
                directory={directory}
                avatars={avatars}
              />
            ))
          ) : (
            <Empty message="Nothing is held — every environment is free." />
          )}
        </div>
      </section>

      <section className="mt-7">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-3 pb-4">
            <div>
              <h2 className="text-[17px] font-bold tracking-tight">Latest Jira updates</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs text-faint">Most recently updated tickets, synced from Jira</p>
                {settings.jira.enabled && settings.jira.autoSync ? (
                  <JiraAutoSync interval_minutes={settings.jira.pollIntervalMinutes} />
                ) : null}
              </div>
            </div>
            {/* Courtesy, same as the nav entry: /tickets refuses without
                `all-tickets` anyway, and a link that 403s is worse than no
                link. The table above it stays — a preview of recent Jira
                activity is not the same thing as the whole backlog. */}
            {can(user, "all-tickets") ? (
              <Link href="/tickets" className="text-xs font-semibold text-brand-fg hover:underline">
                See all
              </Link>
            ) : null}
          </div>

          <JiraConflictNotice conflicts={branch_conflicts} jira_base_url={jira_base_url} />

          <Table
            className="flex-1"
            isEmpty={!jiraUpdates.length}
            empty="Nothing from Jira yet — run a sync."
            minWidth="min-w-[1100px]"
            head={
              <>
                <Th className="w-[40%]">Ticket</Th>
                <Th className="w-[16%]">Assignee</Th>
                <Th className="w-[14%]">Status</Th>
                <Th className="w-[18%]">Environment / branch</Th>
                <Th className="w-[12%]">Repos</Th>
              </>
            }
          >
            {jiraUpdates.map((row) => (
              <JiraUpdateRow
                key={`${row.claim.id}::${row.serverId ?? "none"}`}
                row={row}
                activity={jiraActivity(row, directory, user)}
                jira_base_url={jira_base_url}
                environments={environments}
                claims={claims}
              />
            ))}
          </Table>
        </div>
      </section>
    </Page>
  );
}
