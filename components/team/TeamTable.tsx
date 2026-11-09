import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, Dash, Muted } from "@/components/ui/Chips";
import { Icon } from "@/components/ui/Icon";
import { TicketLink } from "@/components/ui/JiraLinks";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { TicketTitle } from "@/components/ui/TicketCell";
import { PresenceCell } from "@/components/users/PresenceCell";
import { AVAILABILITY } from "@/lib/shared/tokens";
import { isUrgent, leftText } from "@/lib/shared/view-model";
import { isTeamSort, type TeamSort, type WorkloadRow } from "@/lib/shared/workload";

/**
 * The roster table. A Server Component, like TicketTable — the only client
 * JavaScript on this page is the presence cell, which has to be live.
 *
 * Every column that can be sorted sorts through the URL, so a view is
 * shareable and the back button works. Same reasoning, and the same shape, as
 * the Health page.
 */

/** How many ticket keys to spell out in a cell before summarising the rest. */
const KEYS_SHOWN = 3;

export function AvailabilityChip({ row }: { row: WorkloadRow }) {
  const token = AVAILABILITY[row.availability];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${token.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${token.dot}`} />
      {token.label}
    </span>
  );
}

function SortTh({
  href,
  sort,
  dir,
  column,
  label,
  className = "",
}: {
  href: (patch: { sort?: string; dir?: string }) => string;
  sort: string | undefined;
  dir: string | undefined;
  column: TeamSort;
  label: string;
  className?: string;
}) {
  const active = isTeamSort(sort) && sort === column;
  const descending = active && dir === "desc";

  return (
    <Th className={className} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
      <Link
        href={href({ sort: column, dir: active && !descending ? "desc" : "asc" })}
        className={`inline-flex items-center gap-1 transition hover:text-brand-fg ${active ? "text-brand-fg" : ""}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "text-faintest"}>
          {active ? (descending ? "↓" : "↑") : "↕"}
        </span>
      </Link>
    </Th>
  );
}

/**
 * Tickets, linked to Jira, each with its title on the same line, and the tail
 * summarised rather than wrapped. One line each, not the two a ticket table
 * gives a title: a roster row carries up to six of these, and the drill-down
 * is one click away for the full text.
 */
function TicketKeys({
  rows,
  jiraBaseUrl,
}: {
  rows: WorkloadRow["holding"];
  jiraBaseUrl: string | null;
}) {
  if (!rows.length) return <Dash />;

  const shown = rows.slice(0, KEYS_SHOWN);

  return (
    <ul className="space-y-1">
      {shown.map((row) => (
        <li key={row.claim.id} className="flex max-w-[20rem] items-baseline gap-2">
          <TicketLink
            ticketKey={row.claim.id}
            jiraBaseUrl={jiraBaseUrl}
            source={row.claim.source}
            icon={false}
            className="shrink-0 text-[11px] font-bold text-brand-fg"
          />
          <span className="min-w-0 flex-1">
            <TicketTitle claim={row.claim} lines={1} className="text-[11px] text-body" />
          </span>
        </li>
      ))}
      {rows.length > shown.length ? (
        <li className="text-[11px] text-faint">+{rows.length - shown.length} more</li>
      ) : null}
    </ul>
  );
}

export function TeamTable({
  rows,
  href,
  sort,
  dir,
  jiraBaseUrl,
  empty,
  /** Off for the unmatched-names table: a raw Jira label has no page to open,
   *  no job role, and no login to be present on. */
  linkRows = true,
}: {
  rows: WorkloadRow[];
  href: (patch: { sort?: string; dir?: string }) => string;
  sort?: string;
  dir?: string;
  jiraBaseUrl: string | null;
  empty: string;
  linkRows?: boolean;
}) {
  return (
    <Table
      isEmpty={!rows.length}
      empty={empty}
      head={
        <>
          {linkRows ? (
            <SortTh href={href} sort={sort} dir={dir} column="name" label="Person" />
          ) : (
            <Th>Name on the ticket</Th>
          )}
          <Th>Status</Th>
          {linkRows ? (
            <SortTh href={href} sort={sort} dir={dir} column="load" label="Holding" />
          ) : (
            <Th>Holding</Th>
          )}
          <Th>Also assigned</Th>
          {linkRows ? (
            <SortTh href={href} sort={sort} dir={dir} column="frees" label="Frees in" className="text-right" />
          ) : (
            <Th className="text-right">Frees in</Th>
          )}
          {linkRows ? <Th className="whitespace-nowrap">Presence</Th> : null}
          <Th className="text-right" />
        </>
      }
    >
      {rows.map((row) => {
        const urgent = isUrgent(row.soonestFree);

        return (
          <Tr key={row.person.id}>
            <Td>
              <div className="flex items-center gap-3">
                <Avatar person={row.person} size="h-9 w-9" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{row.person.name}</p>
                  <p className="truncate text-[11px] text-faint">
                    {row.person.unmatched ? (
                      <span className="text-warn">No one on the board answers to this name</span>
                    ) : (
                      row.jobRole || "No role set"
                    )}
                  </p>
                </div>
              </div>
            </Td>

            <Td>
              <AvailabilityChip row={row} />
              {row.overdue ? (
                <p className="mt-1 text-[10px] font-bold text-warn">
                  {row.overdue} overdue
                </p>
              ) : null}
            </Td>

            <Td>
              {row.holding.length ? (
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-body">
                    {row.environments.join(", ") || "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {row.holding.length} ticket{row.holding.length === 1 ? "" : "s"} ·{" "}
                    {row.repoCount} repositor{row.repoCount === 1 ? "y" : "ies"}
                  </p>
                  <div className="mt-1">
                    <TicketKeys rows={row.holding} jiraBaseUrl={jiraBaseUrl} />
                  </div>
                </div>
              ) : (
                <Muted>No environment held</Muted>
              )}
            </Td>

            <Td>
              {row.open.length ? (
                <div className="min-w-0">
                  <p className="text-[11px] text-faint">
                    {row.open.length} live ticket{row.open.length === 1 ? "" : "s"}
                  </p>
                  <div className="mt-1">
                    <TicketKeys rows={row.open} jiraBaseUrl={jiraBaseUrl} />
                  </div>
                </div>
              ) : row.doneCount ? (
                // Worth saying rather than leaving blank: "free" reads
                // differently when somebody closed four tickets this week.
                <Muted>
                  {row.doneCount} finished
                </Muted>
              ) : (
                <Dash />
              )}
            </Td>

            <Td className="text-right">
              {row.soonestFree === null ? (
                <Dash />
              ) : (
                <span
                  className={`whitespace-nowrap text-xs font-semibold ${urgent ? "text-warn" : "text-body"}`}
                >
                  {leftText(row.soonestFree)}
                </span>
              )}
            </Td>

            {linkRows ? (
              <Td>
                {/* Presence keys on the LOGIN, not the person: it is a
                    connection that is online, and most of the board has no
                    login to be connected with. */}
                {row.loginId ? (
                  <PresenceCell userId={row.loginId} lastSeenAt={row.lastSeenAt} />
                ) : (
                  <span className="text-[11px] text-faintest" title="No sign-in account">
                    —
                  </span>
                )}
              </Td>
            ) : null}

            <Td className="text-right">
              {linkRows ? (
                <Link
                  href={`/team/${encodeURIComponent(row.person.id)}`}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-muted ring-1 ring-line-2 transition hover:text-brand-fg hover:ring-brand-soft"
                >
                  Tickets
                  <Icon name="chevron" className="h-3 w-3" />
                </Link>
              ) : (
                <Chip className="bg-warn-soft text-warn">Unmatched</Chip>
              )}
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
