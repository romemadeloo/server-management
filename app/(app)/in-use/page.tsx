import Link from "next/link";
import { PeopleCell } from "@/components/ui/Avatar";
import { ClaimRepoLinks } from "@/components/ui/JiraLinks";
import { Page, PageHead, StatTile } from "@/components/ui/Layout";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingCell, TicketCell } from "@/components/ui/TicketCell";
import { getBoard } from "@/lib/db/queries/board";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { describeJiraConfig } from "@/lib/jira/client";
import { isUrgent, minutesLeft, nullsLast, peopleOf } from "@/lib/shared/view-model";

/**
 * One row per (claim × repository) — what "in use" actually means.
 *
 * The ticket pages count tickets; this counts *held repositories*, which is the
 * number that decides whether anyone can deploy. A ticket holding three repos is
 * one row there and three here, deliberately.
 */
export const metadata = { title: "In use · Glophics Portal" };

export default async function InUsePage() {
  const jiraBaseUrl = describeJiraConfig().baseUrl;
  const [{ accounts, environments, claims, directory }, avatars] = await Promise.all([
    getBoard(),
    avatarVersions(),
  ]);

  const rows = claims
    .flatMap((claim) => {
      const env = environments.find((e) => e.id === claim.serverId) ?? null;
      const account = env ? accounts.find((a) => a.id === env.accountId) : null;

      return claim.repos.map((repo) => ({
        claim,
        repo,
        env_record: env,
        serverId: env?.id ?? null,
        env: env?.name ?? claim.branch ?? "—",
        accountName: account?.displayName ?? claim.accountName ?? "—",
        minutesLeft: minutesLeft(claim),
        people: peopleOf([claim], directory, avatars),
      }));
    })
    // Soonest to free first — the question people actually ask.
    .sort((a, b) => nullsLast(a.minutesLeft) - nullsLast(b.minutesLeft));

  const expiring = rows.filter((r) => isUrgent(r.minutesLeft)).length;
  const noEnd = rows.filter((r) => r.minutesLeft === null).length;

  return (
    <Page>
      <PageHead
        title="In use"
        sub={`${rows.length} repositor${rows.length === 1 ? "y is" : "ies are"} held right now`}
      />

      <section className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatTile tone="warn" label="Held" value={rows.length} sub="repositories" icon="clock" />
        <StatTile
          tone="brand"
          label="Freeing within the hour"
          value={expiring}
          sub="soonest first"
          icon="clock"
        />
        <StatTile
          tone="neutral"
          label="No end time"
          value={noEnd}
          sub="held until freed by hand"
          icon="alert"
        />
      </section>

      <Table
        isEmpty={!rows.length}
        empty="Nothing is held — every repository is free."
        minWidth="min-w-[1000px]"
        head={
          <>
            <Th>Repository</Th>
            <Th>Environment</Th>
            <Th className="w-[34%]">Ticket</Th>
            <Th>Holders</Th>
            <Th className="text-right">Frees in</Th>
          </>
        }
      >
        {rows.map((row) => (
          <Tr key={`${row.claim.id}::${row.serverId}::${row.repo}`}>
            <Td className="align-top">
              <div className="flex items-center gap-2">
                {/* One row is one held repository, so there is exactly one badge —
                    and it opens that repository. */}
                <ClaimRepoLinks
                  repos={[row.repo]}
                  environment={row.env_record ?? undefined}
                  claims={claims}
                />
                <span className="text-xs text-muted">{row.repo}</span>
              </div>
            </Td>

            <Td className="align-top">
              {row.serverId ? (
                <Link href={`/environments/${encodeURIComponent(row.serverId)}`} className="group block min-w-0">
                  <span className="block truncate text-sm font-semibold group-hover:text-brand-fg group-hover:underline">
                    {row.env}
                  </span>
                  <span className="block truncate text-[11px] text-faint">{row.accountName}</span>
                </Link>
              ) : (
                <>
                  <p className="truncate text-sm font-semibold text-muted">{row.env}</p>
                  <p className="truncate text-[11px] text-faint">{row.accountName}</p>
                </>
              )}
            </Td>

            <Td className="align-top">
              <TicketCell claim={row.claim} jiraBaseUrl={jiraBaseUrl} showStatus showBranch />
            </Td>

            <Td className="align-top">
              <div className="max-w-[13rem]">
                <PeopleCell people={row.people} />
              </div>
            </Td>

            <Td className="align-top text-right">
              <BookingCell claim={row.claim} minutes={row.minutesLeft} />
            </Td>
          </Tr>
        ))}
      </Table>
    </Page>
  );
}
