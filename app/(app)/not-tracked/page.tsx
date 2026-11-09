import { PeopleCell } from "@/components/ui/Avatar";
import { JiraChip } from "@/components/ui/Chips";
import { Icon } from "@/components/ui/Icon";
import { TicketLink } from "@/components/ui/JiraLinks";
import { Notice, Page, PageHead } from "@/components/ui/Layout";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { TicketTitle } from "@/components/ui/TicketCell";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { getBoard, getJiraSkipped } from "@/lib/db/queries/board";
import { describeJiraConfig } from "@/lib/jira/client";
import { agoText } from "@/lib/shared/format";
import { peopleOf } from "@/lib/shared/view-model";

/**
 * Tickets the sync could not place, with the reason and the fix.
 *
 * This page exists so a mis-filled ticket is *visible* rather than silently
 * missing. Matching is exact on Account Name + Branch + Repository and never
 * guesses, so anything unmatched lands here by design rather than by failure.
 */
export const metadata = { title: "Not tracked · Glophics Portal" };

/**
 * The reason strings are produced by lib/jira/matching.ts, so the advice can be
 * specific rather than a generic "check the ticket".
 */
function fixFor(reason: string): string {
  const text = reason.toLowerCase();
  if (text.includes("account name is empty")) return "Fill in the ticket's Account Name field.";
  if (text.includes("branch is empty")) return "Fill in the ticket's Branch field.";
  if (text.includes("no account named")) return "Add that account under Settings, or correct the ticket.";
  if (text.includes("no environment named")) return "Add that environment under Settings, or correct the Branch.";
  if (text.includes("repository field is empty")) return "Fill in the ticket's Repository field.";
  if (text.includes("match any repo")) return "Use storefront, backend or admin — or an accepted synonym.";
  return "Correct the ticket in Jira, then sync again.";
}

export default async function NotTrackedPage() {
  const [skipped, { directory }, avatars] = await Promise.all([
    getJiraSkipped(),
    getBoard(),
    avatarVersions(),
  ]);
  const jiraBaseUrl = describeJiraConfig().baseUrl;

  return (
    <Page>
      <PageHead
        title="Not tracked"
        sub={
          skipped.length
            ? `${skipped.length} ticket${skipped.length === 1 ? "" : "s"} could not be matched to an environment`
            : "Every ticket the last sync saw was matched"
        }
      />

      {skipped.length ? (
        <Notice tone="warn" title="These tickets are holding nothing">
          Each one reached an occupying status but could not be matched, so the environment it meant to
          claim still reads as free. Fix the ticket in Jira and the next sync picks it up.
        </Notice>
      ) : null}

      <Table
        isEmpty={!skipped.length}
        empty="Nothing was skipped — every ticket matched an environment."
        minWidth="min-w-[1000px]"
        head={
          <>
            <Th className="w-[30%]">Ticket</Th>
            <Th>Status</Th>
            <Th>Assignees</Th>
            <Th>Account / branch on the ticket</Th>
            <Th className="w-[30%]">Why it was skipped</Th>
          </>
        }
      >
        {skipped.map((row) => {
          const people = peopleOf([row], directory, avatars);

          return (
            <Tr key={row.key}>
              <Td className="align-top">
                {/* The fix for every row on this page is "correct the ticket in
                    Jira", so the key is the way there. Everything here came out of
                    a Jira query by definition — there are no manual claims to
                    guard against. */}
                <div className="max-w-[28rem]">
                  <TicketLink
                    ticketKey={row.key}
                    jiraBaseUrl={jiraBaseUrl}
                    className="text-xs font-bold text-brand-fg"
                  />
                  <div className="mt-1">
                    <TicketTitle claim={{ summary: row.summary, note: null, source: "jira" }} />
                  </div>
                  {row.jiraUpdatedAt ? (
                    <p className="mt-1 text-[10px] text-faint">Updated {agoText(row.jiraUpdatedAt)} ago</p>
                  ) : null}
                </div>
              </Td>
              <Td className="align-top">{row.status ? <JiraChip status={row.status} /> : "—"}</Td>
              <Td className="align-top">
                <div className="max-w-[13rem]">
                  <PeopleCell people={people} />
                </div>
              </Td>
              <Td className="align-top">
                {/* Shown as typed on the ticket — exact matching means the
                    difference between this and the real name IS the bug. */}
                <p className="text-sm text-body">
                  {row.accountName || <span className="italic text-bad">Account Name empty</span>}
                </p>
                <p className="mt-1 inline-flex rounded bg-subtle-2 px-1.5 py-0.5 font-mono text-[10px] text-body">
                  {row.branch || <span className="italic text-bad">Branch empty</span>}
                </p>
              </Td>
              <Td className="align-top">
                <p className="text-sm font-medium text-bad">{row.reason}</p>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
                  <Icon name="chevron" className="mt-0.5 h-3 w-3 shrink-0" />
                  {fixFor(row.reason)}
                </p>
              </Td>
            </Tr>
          );
        })}
      </Table>
    </Page>
  );
}
