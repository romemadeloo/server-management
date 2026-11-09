import Link from "next/link";
import { notFound } from "next/navigation";
import { TicketTable } from "@/components/TicketTable";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, Muted } from "@/components/ui/Chips";
import { Notice, Page, PageHead, StatTile } from "@/components/ui/Layout";
import { Pagination } from "@/components/ui/Pagination";
import { PresenceCell } from "@/components/users/PresenceCell";
import { requireUser } from "@/lib/auth/require";
import { listAuthUsers } from "@/lib/db/queries/auth";
import { avatarVersions } from "@/lib/db/queries/avatars";
import { getBoard } from "@/lib/db/queries/board";
import { getTicketPage } from "@/lib/db/queries/tickets";
import { describeJiraConfig } from "@/lib/jira/client";
import { directoryIdentityValues } from "@/lib/shared/mine";
import { pageNumber, pageWindow } from "@/lib/shared/pagination";
import { boardRows, claimRows, personAvatarUrl } from "@/lib/shared/view-model";

/**
 * One person's tickets — the drill-down from the roster.
 *
 * This is My tickets pointed at somebody else, and almost literally so:
 * getTicketPage() takes the identity STRINGS rather than a user id, which
 * lib/db/queries/tickets.ts says is deliberate so that "deciding who somebody
 * is" stays in one function. Handing it a directory person's strings instead of
 * the signed-in account's is the whole of this page, and it inherits the paging,
 * the ordering and the 103 checks that already cover that query.
 *
 * The strings come from directoryIdentityValues() — the same rule the roster
 * buckets with, so the count here and the count on the roster cannot drift.
 *
 * Gated on `oversee` again rather than trusting the roster to have checked:
 * every protected Server Component is its own boundary, and a URL is guessable.
 */

type Params = { personId: string };
type Search = { page?: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { personId } = await params;
  const { directory } = await getBoard();
  const person = directory.find((entry) => entry.id === decodeURIComponent(personId));
  return { title: person ? `${person.name} · Team · Glophics Portal` : "Team · Glophics Portal" };
}

export default async function TeamPersonPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  await requireUser("oversee");

  const [{ personId: raw }, search] = await Promise.all([params, searchParams]);
  // Decoded the way the environment detail page decodes its id: today's
  // directory ids are URL-safe slugs, but the id is data, not a guarantee.
  const personId = decodeURIComponent(raw);
  const jiraBaseUrl = describeJiraConfig().baseUrl;

  const [board, logins, avatars] = await Promise.all([getBoard(), listAuthUsers(), avatarVersions()]);
  const { accounts, environments, claims, directory } = board;

  const person = directory.find((entry) => entry.id === personId);
  // A directory id that is not in the directory is a 404, not an empty roster
  // row: the roster only links ids it just read, so this is a stale link or a
  // typed URL, and "this person has no tickets" would be a lie.
  if (!person) notFound();

  const values = directoryIdentityValues(person);
  const page = await getTicketPage({ page: pageNumber(search.page), mine: [...values] });

  const rows = [
    ...claimRows(environments, accounts, page.claims, directory, avatars),
    ...boardRows(page.issues, environments, accounts, directory, avatars),
  ];

  const login = logins.find((entry) => entry.directoryUserId === person.id) ?? null;

  function pageHref(n: number): string {
    return n === 1 ? `/team/${encodeURIComponent(personId)}` : `/team/${encodeURIComponent(personId)}?page=${n}`;
  }

  return (
    <Page>
      <PageHead
        title={person.name}
        sub={
          <>
            {person.jobRole || "No role set"} ·{" "}
            {page.position.total
              ? `${page.position.total} ticket${page.position.total === 1 ? "" : "s"}`
              : "nothing assigned"}
          </>
        }
        actions={
          <Link
            href="/team"
            className="inline-flex items-center rounded-xl px-3.5 py-2 text-xs font-semibold text-muted ring-1 ring-line-2 transition hover:text-brand-fg hover:ring-brand-soft"
          >
            Back to the team
          </Link>
        }
      />

      <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3.5 rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line">
          <Avatar
            person={{
              id: person.id,
              name: person.name,
              avatarUrl: personAvatarUrl(person, avatars),
            }}
            size="h-11 w-11"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{person.name}</p>
            {/* Presence keys on the LOGIN, because it is a connection that is
                online. Most of the board has no login at all. */}
            {login ? (
              <PresenceCell userId={login.id} lastSeenAt={login.lastSeenAt} />
            ) : (
              <Muted>No sign-in account</Muted>
            )}
          </div>
        </div>

        <StatTile
          tone={page.holdingTotal ? "brand" : "ok"}
          label="Holding"
          value={page.holdingTotal}
          sub={page.holdingTotal ? "tickets occupying a repository" : "no environment held"}
          icon="servers"
        />
        <StatTile
          tone="alt"
          label="Other tickets"
          value={page.issueTotal}
          sub="seen by the last Jira sync"
          icon="list"
        />
      </section>

      {person.jiraNames.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-faint">
            Answers to
          </span>
          {person.jiraNames.map((name) => (
            <Chip key={name} className="bg-subtle-2 text-muted">
              {name}
            </Chip>
          ))}
        </div>
      ) : (
        // Not a warning about this page so much as about the board: matching is
        // exact (invariant 6), so a person with no label only ever gets tickets
        // that name their directory id or spell their display name exactly.
        <Notice tone="warn" title={`${person.name} has no Jira assignee name`}>
          Only tickets whose assignee matches their display name exactly can be recognised as theirs.
          Add the spelling Jira uses under{" "}
          <Link href="/users" className="font-semibold underline">
            Users
          </Link>
          .
        </Notice>
      )}

      <TicketTable
        rows={rows}
        showHolding
        environments={environments}
        claims={claims}
        jiraBaseUrl={jiraBaseUrl}
        empty={`Nothing on the board is assigned to ${person.name}.`}
      />
      <Pagination
        {...page.position}
        label="tickets"
        href={pageHref}
        window={pageWindow(page.position.page, page.position.pageCount)}
      />
    </Page>
  );
}
