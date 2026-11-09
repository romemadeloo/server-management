import Link from "next/link";
import { notFound } from "next/navigation";
import { PeopleCell } from "@/components/ui/Avatar";
import { Dash, HealthChip, JiraChip, Muted, StatusChip } from "@/components/ui/Chips";
import { ClaimRepoLinks, TicketLink } from "@/components/ui/JiraLinks";
import { Card, Notice, Page, PageHead } from "@/components/ui/Layout";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { BookingCell, TicketCell, TicketTitle } from "@/components/ui/TicketCell";
import { AssignButton, ForceFreeClaimButton, ForceFreeServerButton, NoteButton } from "@/components/env/EnvActions";
import { currentUserOrNull, can } from "@/lib/auth/require";
import { getBoard } from "@/lib/db/queries/board";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { describeJiraConfig } from "@/lib/jira/client";
import { agoText, formatDateTime } from "@/lib/shared/format";
import { shortRepo } from "@/lib/shared/tokens";
import { envRow, isUrgent, leftText, minutesLeft, peopleOf } from "@/lib/shared/view-model";
import { repoClaims } from "@/lib/shared/occupancy";

/**
 * One environment, broken down per repository — which repos are free, and which
 * ticket holds each of the others.
 *
 * The legacy app expanded this inline inside the environments table. A real route
 * is better: it is linkable, the back button works, and the table above does not
 * have to carry expansion state.
 */
export async function generateMetadata({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const { environments } = await getBoard();
  const env = environments.find((e) => e.id === decodeURIComponent(serverId));
  return { title: env ? `${env.name} · Glophics Portal` : "Environment · Glophics Portal" };
}

export default async function EnvironmentDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const id = decodeURIComponent(serverId);
  const jiraBaseUrl = describeJiraConfig().baseUrl;

  const [board, user, avatars] = await Promise.all([
    getBoard(),
    currentUserOrNull(),
    avatarVersions(),
  ]);
  const { accounts, environments, claims, directory, settings } = board;

  const env = environments.find((e) => e.id === id);
  if (!env) notFound();

  const row = envRow(env, accounts, claims, directory, avatars);
  const mayClaim = can(user, "claim");

  return (
    <Page>
      <div className="pb-2">
        <Link href="/environments" className="text-xs font-semibold text-muted hover:text-brand-fg hover:underline">
          ← All environments
        </Link>
      </div>

      <PageHead
        title={row.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.accountName}</span>
            <StatusChip status={row.state} />
          </span>
        }
        actions={
          mayClaim ? (
            <>
              <AssignButton
                serverId={row.id}
                freeRepos={row.freeRepos}
                directory={directory}
                settings={settings}
                disabled={!row.freeRepos.length}
              />
              <ForceFreeServerButton
                serverId={row.id}
                serverName={row.name}
                claimCount={row.claims.length}
              />
            </>
          ) : (
            <Muted>Your role can look but not book.</Muted>
          )
        }
      />

      {row.offline.length ? (
        <Notice tone="bad" title={`${row.offline.length} repository is not reachable`}>
          {row.offline.join(", ")} — an offline repository outranks claim state, which is why this
          environment reads as <strong>Server down</strong> regardless of what is booked.
        </Notice>
      ) : null}

      {/* ---- per-repository breakdown ---- */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {row.repos.map((repo) => {
          const holders = repoClaims(claims, row.id, repo.repoName);
          const people = peopleOf(holders, directory, avatars);

          return (
            <Card key={repo.repoName}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {/* The badge is the same button as everywhere else on the
                        board: it opens the repository. The full address is
                        spelled out below, for copying. */}
                    {repo.url ? (
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${repo.repoName}\n${repo.url}`}
                        className="rounded-md bg-subtle-2 px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted transition hover:brightness-110 hover:ring-2 hover:ring-brand-300"
                      >
                        {shortRepo(repo.repoName)}
                      </a>
                    ) : (
                      <span
                        title={`${repo.repoName}: no URL configured`}
                        className="rounded-md bg-subtle-2 px-2 py-0.5 text-[10px] font-bold tracking-wide text-muted"
                      >
                        {shortRepo(repo.repoName)}
                      </span>
                    )}
                    <h3 className="truncate text-sm font-bold">{repo.repoName}</h3>
                  </div>
                  <div className="mt-2">
                    <HealthChip health={repo.health} />
                  </div>
                </div>
                {mayClaim ? (
                  <NoteButton serverId={row.id} repoName={repo.repoName} note={repo.note} />
                ) : null}
              </div>

              <div className="mt-4 space-y-2 border-t border-line-soft pt-3.5">
                {repo.url ? (
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-muted hover:text-brand-fg hover:underline"
                  >
                    {repo.url}
                  </a>
                ) : (
                  <Muted>No URL configured — nothing to check</Muted>
                )}

                {repo.healthCheckedAt ? (
                  <p className="text-[11px] text-faint">Checked {agoText(repo.healthCheckedAt)} ago</p>
                ) : (
                  <p className="text-[11px] text-faint">Never checked</p>
                )}
              </div>

              <div className="mt-3.5 border-t border-line-soft pt-3.5">
                {holders.length ? (
                  <>
                    <PeopleCell people={people} />
                    <ul className="mt-3 space-y-2.5">
                      {holders.map((holder) => {
                        const left = minutesLeft(holder);
                        return (
                          <li key={holder.id} className="rounded-xl bg-subtle px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <TicketLink
                                ticketKey={holder.id}
                                source={holder.source}
                                jiraBaseUrl={jiraBaseUrl}
                                className="text-[11px] font-bold text-brand-fg"
                                iconClassName="h-2.5 w-2.5 opacity-60"
                              />
                              <JiraChip status={holder.status} />
                              <span
                                className={`ml-auto whitespace-nowrap text-[11px] font-semibold ${
                                  left !== null && left <= 0
                                    ? "text-bad"
                                    : isUrgent(left)
                                      ? "text-warn"
                                      : "text-muted"
                                }`}
                              >
                                {left === null ? "No end time" : left <= 0 ? "Overdue" : leftText(left)}
                              </span>
                            </div>
                            <div className="mt-1">
                              <TicketTitle claim={holder} lines={2} className="text-xs leading-4 text-body" />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {/* More than one claim on one repo is legal, and the legacy
                        UI called it "Shared". Worth saying out loud. */}
                    {holders.length > 1 ? (
                      <p className="mt-1.5 text-[11px] font-medium text-warn">
                        Shared by {holders.length} tickets
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs font-medium text-ok">Free — ready to book</p>
                )}
              </div>

              {repo.note ? (
                <p className="mt-3 rounded-xl bg-subtle px-3 py-2 text-xs leading-relaxed text-body">
                  {repo.note}
                </p>
              ) : null}
            </Card>
          );
        })}
      </section>

      {/* ---- claims on this environment ---- */}
      <section className="mt-7">
        <h2 className="pb-4 text-[17px] font-bold tracking-tight">
          Claims on {row.name}
          <span className="ml-2 text-xs font-semibold text-faint">{row.claims.length}</span>
        </h2>

        <Table
          isEmpty={!row.claims.length}
          empty="Nothing is holding this environment."
          minWidth="min-w-[960px]"
          head={
            <>
              <Th className="w-[36%]">Ticket</Th>
              <Th>Status</Th>
              <Th>Holders</Th>
              <Th>Repositories</Th>
              <Th>Booked</Th>
              <Th className="text-right">Frees in</Th>
              {mayClaim ? <Th className="text-right" /> : null}
            </>
          }
        >
          {row.claims.map((claim) => {
            const people = peopleOf([claim], directory, avatars);
            const minutes = minutesLeft(claim);

            return (
              <Tr key={claim.id}>
                <Td className="align-top">
                  <TicketCell claim={claim} jiraBaseUrl={jiraBaseUrl} showBranch showUpdated />
                </Td>
                <Td className="align-top">
                  <JiraChip status={claim.status} />
                </Td>
                <Td className="align-top">
                  <div className="max-w-[13rem]">
                    <PeopleCell people={people} />
                  </div>
                </Td>
                <Td className="align-top">
                  <ClaimRepoLinks repos={claim.repos} environment={env} claims={claims} />
                </Td>
                <Td className="align-top">
                  {claim.startTime || claim.endTime ? (
                    <span className="whitespace-nowrap text-[11px] text-muted">
                      {formatDateTime(claim.startTime) ?? "—"} → {formatDateTime(claim.endTime) ?? "—"}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </Td>
                <Td className="align-top text-right">
                  <BookingCell claim={claim} minutes={minutes} />
                </Td>
                {mayClaim ? (
                  <Td className="text-right">
                    <ForceFreeClaimButton
                      claimId={claim.id}
                      repos={claim.repos}
                      holders={people.map((p) => p.name).join(", ")}
                    />
                  </Td>
                ) : null}
              </Tr>
            );
          })}
        </Table>
      </section>
    </Page>
  );
}
