import Link from "next/link";
import { PeopleCell } from "@/components/ui/Avatar";
import { JiraChip } from "@/components/ui/Chips";
import { ClaimRepoLinks } from "@/components/ui/JiraLinks";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingCell, TicketCell } from "@/components/ui/TicketCell";
import { type TicketRow } from "@/lib/shared/view-model";
import type { Claim, Environment } from "@/lib/types";

/**
 * One table for every ticket list — Active tickets, My tickets, a person's
 * tickets on the team roster. Ported from public/js/ui/ticket-table.js.
 *
 * `holding` is the only thing that separates a claim from any other ticket the
 * sync saw, so both kinds render here and the column says which.
 *
 * The Ticket column carries the key AND the title (components/ui/TicketCell).
 * They used to be two columns five apart, so reading a row meant reading across
 * the whole table; the summary is what people recognise a ticket by, so it now
 * sits under the key it belongs to. The key opens the issue in Jira, each
 * repository badge opens that repository — both degrade to plain text on their
 * own terms; see components/ui/JiraLinks.tsx.
 *
 * A row whose booking is overdue gets a red rule down its left edge, and one
 * that frees within the hour an amber one — the column says the same thing, but
 * a column has to be read and an edge is seen.
 */
export function TicketTable({
  rows,
  empty,
  showHolding = false,
  environments = [],
  claims = [],
  jiraBaseUrl = null,
}: {
  rows: TicketRow[];
  empty: string;
  /** Show the "Holding" column. Off for lists that are all one kind. */
  showHolding?: boolean;
  /** Where the repository URLs and health verdicts live. Without them a badge
   *  cannot say whether the repository is up. */
  environments?: Environment[];
  /** Every claim on the board — what makes a badge able to say "occupied". */
  claims?: Claim[];
  /** From describeJiraConfig(). Null when Jira is not configured. */
  jiraBaseUrl?: string | null;
}) {
  return (
    <Table
      isEmpty={!rows.length}
      empty={empty}
      minWidth="min-w-[1040px]"
      head={
        <>
          <Th className="w-[34%]">Ticket</Th>
          <Th>Status</Th>
          <Th>Assignees</Th>
          <Th>Environment</Th>
          {showHolding ? <Th>Holding</Th> : null}
          <Th className="text-right">Frees in</Th>
        </>
      }
    >
      {rows.map((row) => {
        const expired = row.holding && row.minutesLeft !== null && row.minutesLeft <= 0;
        const urgent = row.holding && row.minutesLeft !== null && row.minutesLeft > 0 && row.minutesLeft <= 60;

        return (
          <Tr key={`${row.claim.id}::${row.serverId ?? "none"}`}>
            {/* The edge sits on the first cell, not the row: a box-shadow on a
                <tr> is not painted reliably across browsers. */}
            <Td
              className={`align-top ${
                expired
                  ? "shadow-[inset_3px_0_0_var(--color-bad)]"
                  : urgent
                    ? "shadow-[inset_3px_0_0_var(--color-warn)]"
                    : ""
              }`}
            >
              <TicketCell claim={row.claim} jiraBaseUrl={jiraBaseUrl} showBranch showUpdated />
            </Td>

            <Td className="align-top">
              <JiraChip status={row.claim.status} />
            </Td>

            <Td className="align-top">
              <div className="max-w-[14rem]">
                <PeopleCell people={row.people} />
              </div>
            </Td>

            <Td className="align-top">
              {row.serverId ? (
                <Link href={`/environments/${encodeURIComponent(row.serverId)}`} className="group block max-w-[12rem]">
                  <p className="truncate text-sm font-semibold group-hover:text-brand-fg group-hover:underline">
                    {row.env}
                  </p>
                  <p className="truncate text-[11px] text-faint">{row.accountName}</p>
                </Link>
              ) : (
                <div className="max-w-[12rem]">
                  <p className="truncate text-sm font-semibold text-muted">{row.env}</p>
                  {/* No environment matched, which is the Not-tracked case. Saying
                      so here stops the row reading as a placeholder. */}
                  <p className="truncate text-[11px] text-warn">Not matched to an environment</p>
                </div>
              )}
            </Td>

            {showHolding ? (
              <Td className="align-top">
                {row.holding && row.claim.repos.length ? (
                  <ClaimRepoLinks
                    repos={row.claim.repos}
                    environment={environments.find((env) => env.id === row.serverId)}
                    claims={claims}
                  />
                ) : (
                  <span className="text-[11px] text-faint">Nothing</span>
                )}
              </Td>
            ) : null}

            <Td className="align-top text-right">
              <BookingCell claim={row.claim} minutes={row.minutesLeft} holding={row.holding} />
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
