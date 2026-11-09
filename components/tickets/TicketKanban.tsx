import Link from "next/link";
import { AvatarStack } from "@/components/ui/Avatar";
import { Chip } from "@/components/ui/Chips";
import { ClaimRepoLinks } from "@/components/ui/JiraLinks";
import { BookingCell, TicketCell } from "@/components/ui/TicketCell";
import { JIRA_STATUS_VOCABULARY } from "@/lib/jira/matching";
import { statusKey, type TicketStatusCount } from "@/lib/db/queries/tickets";
import { jiraChip } from "@/lib/shared/tokens";
import type { TicketRow } from "@/lib/shared/view-model";
import type { Claim, Environment } from "@/lib/types";

/**
 * My tickets as a board: one column per Jira status, left to right in the order a
 * ticket moves.
 *
 * Every status in JIRA_STATUS_VOCABULARY gets a column even when it is empty —
 * a board that only grew columns for statuses somebody happened to be at would
 * reshuffle itself from one day to the next, and an empty "QA Testing (Stg)" is
 * itself an answer. Statuses the vocabulary does not know ("Delivery Phase")
 * follow, biggest first, which is the order `statuses` already arrives in; they
 * are not hidden, or the board would stop adding up to the list's own total.
 *
 * Server-rendered and read-only: moving a card would mean writing a status back
 * to Jira, which this app never does.
 */
export function TicketKanban({
  rows,
  statuses,
  environments,
  claims,
  jiraBaseUrl,
}: {
  rows: TicketRow[];
  /** Counts for the whole list, in workflow order — supplies the spelling and any
   *  status outside the vocabulary. */
  statuses: TicketStatusCount[];
  environments: Environment[];
  claims: Claim[];
  jiraBaseUrl: string | null;
}) {
  const labels = new Map(statuses.map((entry) => [entry.key, entry.status] as const));
  const keys = [
    ...JIRA_STATUS_VOCABULARY.map((status) => status.toLowerCase()),
    ...statuses.map((entry) => entry.key),
  ].filter((key, index, all) => all.indexOf(key) === index);

  const columns = new Map<string, TicketRow[]>(keys.map((key) => [key, []]));
  for (const row of rows) columns.get(statusKey(row.claim.status))?.push(row);

  const labelFor = (key: string) =>
    labels.get(key) ?? JIRA_STATUS_VOCABULARY.find((status) => status.toLowerCase() === key) ?? key;

  return (
    <div className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-4">
      {keys.map((key) => {
        const cards = columns.get(key) ?? [];
        const label = labelFor(key);

        return (
          <section
            key={key}
            aria-label={label}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-subtle ring-1 ring-line-2"
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <Chip className={jiraChip(label)}>{label}</Chip>
              <span className="text-[11px] font-bold text-muted">{cards.length}</span>
            </header>

            <div className="flex flex-col gap-2 px-2 pb-2">
              {cards.length ? (
                cards.map((row) => {
                  const expired = row.holding && row.minutesLeft !== null && row.minutesLeft <= 0;
                  return (
                    <article
                      key={`${row.claim.id}::${row.serverId ?? "none"}`}
                      className={`rounded-lg bg-surface p-3 ring-1 ring-line-2 ${
                        expired ? "shadow-[inset_3px_0_0_var(--color-bad)]" : ""
                      }`}
                    >
                      <TicketCell claim={row.claim} jiraBaseUrl={jiraBaseUrl} lines={3} />

                      <div className="mt-2.5 min-w-0">
                        {row.serverId ? (
                          <Link
                            href={`/environments/${encodeURIComponent(row.serverId)}`}
                            className="block truncate text-xs font-semibold hover:text-brand-fg hover:underline"
                          >
                            {row.env}
                            <span className="font-normal text-faint"> · {row.accountName}</span>
                          </Link>
                        ) : (
                          <p className="truncate text-[11px] text-warn">Not matched to an environment</p>
                        )}
                      </div>

                      {row.holding && row.claim.repos.length ? (
                        <div className="mt-2">
                          <ClaimRepoLinks
                            repos={row.claim.repos}
                            environment={environments.find((env) => env.id === row.serverId)}
                            claims={claims}
                          />
                        </div>
                      ) : null}

                      <div className="mt-3 flex items-end justify-between gap-2">
                        <AvatarStack people={row.people} />
                        <BookingCell
                          claim={row.claim}
                          minutes={row.minutesLeft}
                          holding={row.holding}
                        />
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="px-1 py-3 text-center text-[11px] text-faint">Nothing here</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
