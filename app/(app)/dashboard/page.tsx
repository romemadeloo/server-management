import Link from "next/link";
import { PeopleCell } from "@/components/ui/Avatar";
import { JiraAutoSync } from "@/components/dashboard/JiraAutoSync";
import { Chip, Dash, JiraChip } from "@/components/ui/Chips";
import { Icon } from "@/components/ui/Icon";
import { ClaimRepoLinks, TicketLink } from "@/components/ui/JiraLinks";
import { ButtonLink } from "@/components/ui/Button";
import { Empty, Page, PageHead, SectionHead, StatTile } from "@/components/ui/Layout";
import { RepoStrip } from "@/components/ui/RepoStrip";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingBar, TicketCell, TicketTitle } from "@/components/ui/TicketCell";
import { can, currentUserOrNull } from "@/lib/auth/require";
import { getBoard, getJiraIssues } from "@/lib/db/queries/board";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { describeJiraConfig, issueUrl } from "@/lib/jira/client";
import { boardSummary, type BoardSummary } from "@/lib/shared/occupancy";
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
      className="mb-4 flex gap-3 rounded-lg bg-warn-soft px-4 py-3.5 text-warn ring-1 ring-warn-soft"
      role="status"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface">
        <Icon name="alert" className="h-4 w-4" />
      </span>
      <div className="min-w-0 text-xs leading-5">
        <p className="font-semibold">
          Branch conflict detected in {ticket_ids.length} ticket{ticket_ids.length === 1 ? "" : "s"}
        </p>
        <p className="text-warn/90">
          Tickets in In Progress or QA Testing (Stg) share the same account, branch, and{" "}
          {repos.map(shortRepo).join(", ")} repository. Assign a different branch to the affected tickets.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] font-semibold">Affected tickets</span>
          {ticket_ids.map((ticket_id) =>
            jira_base_url ? (
              <a
                key={ticket_id}
                href={issueUrl(jira_base_url, ticket_id)}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${ticket_id} in Jira`}
                className="inline-flex items-center gap-1 rounded-md bg-surface/80 px-2 py-1 text-[11px] font-semibold text-warn ring-1 ring-warn-soft transition hover:bg-surface hover:ring-warn"
              >
                {ticket_id}
                <Icon name="external" className="h-2.5 w-2.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <strong
                key={ticket_id}
                className="rounded-md bg-surface/80 px-2 py-1 text-[11px] ring-1 ring-warn-soft"
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
/**
 * The pool at a glance: one bar, split into free, partly free and fully held.
 *
 * Offline is deliberately not a fourth segment — it is not a share of the pool
 * but a property that cuts across all three (a free environment can be down),
 * so it is the "Needs attention" tile's job instead.
 */
function DashboardHero({ summary }: { summary: BoardSummary }) {
  const held = Math.max(0, summary.total - summary.free - summary.partial);
  const parts = [
    { key: "free", label: "Free", value: summary.free, bar: "bg-ok" },
    { key: "partial", label: "Partly free", value: summary.partial, bar: "bg-brand-300" },
    { key: "held", label: "Fully held", value: held, bar: "bg-warn" },
  ];
  const total = Math.max(1, summary.total);

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {/* The spotlight: the one number the dashboard is opened for, on a
          mint-lit pane. The light is a radial wash from the corner rather than
          a flat fill, so it reads as glass catching light, not a coloured box. */}
      <div className="glass relative overflow-hidden rounded-[24px] border border-brand-500/25 bg-surface p-6 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-32 h-80 w-80 rounded-full bg-brand-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 right-0 h-72 w-96 rounded-full bg-brand-500/10 blur-3xl"
        />
        <div className="relative">
          <p className="text-[13px] font-medium text-brand-fg">Available now</p>
          <p className="mt-2 flex items-baseline gap-3">
            <span className="text-[56px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
              {summary.free}
            </span>
            <span className="text-lg font-medium text-muted">of {summary.total} environments free</span>
          </p>
          <p className="mt-3 max-w-md text-sm text-body">
            {summary.free === 0
              ? "Every environment is taken. Free one up, or wait for the next booking to end."
              : "Claim one before your ticket reaches QA — the board updates for everyone the moment you do."}
          </p>

          <div className="mt-6 flex h-2.5 gap-1 overflow-hidden rounded-full bg-subtle-2" role="presentation">
            {parts.map((part) =>
              part.value ? (
                <span
                  key={part.key}
                  className={`h-full rounded-full ${part.bar}`}
                  style={{ width: `${(part.value / total) * 100}%` }}
                  title={`${part.label}: ${part.value}`}
                />
              ) : null,
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
            {parts.map((part) => (
              <li key={part.key} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${part.bar}`} />
                {part.label}
                <span className="font-semibold tabular-nums text-ink">{part.value}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink href="/environments" variant="primary" size="lg">
              Browse environments
            </ButtonLink>
            <ButtonLink href="/in-use" variant="ghost" size="lg">
              See what is held
            </ButtonLink>
          </div>
        </div>
      </div>

      <PoolGauge summary={summary} />
    </section>
  );
}

/**
 * How much of the pool is usable right now, as a 270° gauge. "Usable" is
 * free plus partly free — a partly free environment can still take a deploy
 * to its open repositories, which is the question this answers.
 */
function PoolGauge({ summary }: { summary: BoardSummary }) {
  const usable = summary.free + summary.partial;
  const share = summary.total ? usable / summary.total : 0;
  const radius = 64;
  const arc = 2 * Math.PI * radius * 0.75;
  const verdict = share >= 0.6 ? "Plenty free" : share >= 0.3 ? "Getting busy" : "Nearly full";
  const stroke = share >= 0.6 ? "var(--color-brand-500)" : share >= 0.3 ? "var(--color-warn)" : "var(--color-bad)";

  return (
    <div className="glass flex flex-col rounded-[24px] border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-ink">Pool health</p>
          <p className="mt-0.5 text-[13px] text-muted">Free or partly free right now</p>
        </div>
        <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium tabular-nums text-body ring-1 ring-inset ring-line-2">
          {summary.claimsCount} claim{summary.claimsCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="relative mx-auto mt-4 grid h-44 w-44 place-items-center">
        <svg viewBox="0 0 160 160" className="absolute inset-0 h-full w-full rotate-[135deg]" aria-hidden="true">
          <circle
            cx="80" cy="80" r={radius} fill="none" stroke="var(--color-subtle-2)" strokeWidth="12"
            strokeLinecap="round" strokeDasharray={`${arc} ${2 * Math.PI * radius}`}
          />
          <circle
            cx="80" cy="80" r={radius} fill="none" stroke={stroke} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${arc * share} ${2 * Math.PI * radius}`}
            style={{ filter: `drop-shadow(0 0 10px ${stroke})` }}
          />
        </svg>
        <div className="text-center">
          <p className="text-[40px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
            {Math.round(share * 100)}
            <span className="text-xl text-muted">%</span>
          </p>
          <p className="mt-1.5 text-[13px] font-medium text-body">{verdict}</p>
        </div>
      </div>

      <dl className="mt-auto grid grid-cols-2 gap-2 pt-4 text-xs">
        <div className="rounded-2xl bg-subtle px-3 py-2.5 ring-1 ring-inset ring-line">
          <dt className="text-muted">People holding</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">{summary.peopleCount}</dd>
        </div>
        <div className="rounded-2xl bg-subtle px-3 py-2.5 ring-1 ring-inset ring-line">
          <dt className="text-muted">Repos held</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">{summary.reposHeld}</dd>
        </div>
      </dl>
    </div>
  );
}

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
    <article className="glass relative flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface transition-colors hover:border-line-2">
      {/* The state is a 3px top edge and a chip, not a tinted header: a page of
          amber cards made "in use" — the normal state of a busy board — look
          like a page of warnings. */}
      <span aria-hidden className={`absolute inset-x-10 top-0 h-px ${token.dot} opacity-80`} />
      <span aria-hidden className={`pointer-events-none absolute -top-16 left-1/2 h-24 w-2/3 -translate-x-1/2 rounded-full ${token.dot} opacity-[0.12] blur-2xl`} />
      <div className="relative border-b border-line-soft px-5 pb-4 pt-5">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs text-muted">{row.accountName}</span>
          <span
            className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ring-current/25 ${tone.soft} ${tone.fg}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${token.dot}`} />
            {token.label}
          </span>
        </div>
        <Link href={href} className="mt-1.5 block truncate text-[17px] font-semibold tracking-[-0.01em] text-ink hover:underline">
          {row.name}
        </Link>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <RepoStrip env={row.env} claims={row.claims} />
          <span className="whitespace-nowrap text-xs font-semibold text-body">
            {row.freeRepos.length} of {row.repos.length} free
          </span>
        </div>
      </div>

      <div className="flex-1 divide-y divide-line-soft px-5">
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
                      className="text-xs font-semibold text-brand-fg"
                      iconClassName="h-2.5 w-2.5 opacity-60"
                    />
                    <JiraChip status={claim.status} />
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {claim.repos.map((repo) => (
                      <span
                        key={repo}
                        title={repo}
                        className="rounded-full bg-subtle-2 px-2 py-0.5 text-[10px] font-semibold text-muted"
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
                    className={`shrink-0 whitespace-nowrap text-xs font-semibold ${
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

      <div className="border-t border-line-soft bg-subtle px-5 py-3.5">
        {row.soonest ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs">
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
          <p className="text-xs text-faint">{row.claims.length ? "No end time set" : "Nothing booked"}</p>
        )}
        <div className="mt-2.5 flex items-center justify-between text-xs">
          <span className="text-faint">
            {more > 0
              ? `+${more} more ticket${more === 1 ? "" : "s"}`
              : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}
          </span>
          <Link href={href} className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-brand-fg transition-colors hover:bg-brand-soft">
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
          <p className="mt-1.5 max-w-[30rem] whitespace-normal break-words border-l-2 border-line-2 pl-2 text-xs leading-4 text-muted">
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
        <p className="mt-1 inline-flex max-w-[12rem] whitespace-normal break-all rounded-lg bg-subtle-2 px-2 py-1 font-mono text-xs font-medium text-body">
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
      <PageHead title="Dashboard" sub="The environment pool, what is held, and what Jira changed last." />

      <DashboardHero summary={summary} />

      <section className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {/* Not "Available now": the spotlight above already says that, in
            larger type. Partly free is the number it only shows as a sliver. */}
        <StatTile
          tone="brand"
          label="Partly free"
          value={summary.partial}
          sub="some repositories still open"
          icon="servers"
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

      <section className="mt-8">
        <SectionHead
          title="Held right now"
          sub="Environments with at least one repository claimed, soonest to free first"
          action={
            <Link href="/in-use" className="text-[13px] font-medium text-brand-fg hover:underline">
              See all
            </Link>
          }
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

      <section className="mt-8">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
            <div>
              <h2 className="text-[15px] font-semibold leading-6 text-ink">Latest Jira updates</h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[13px] text-muted">Most recently updated tickets, synced from Jira</p>
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
              <Link href="/tickets" className="text-[13px] font-medium text-brand-fg hover:underline">
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
