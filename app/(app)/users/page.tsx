import { Avatar } from "@/components/ui/Avatar";
import { Chip, Muted, RoleChip } from "@/components/ui/Chips";
import { Card, Empty, Notice, Page, PageHead, StatTile } from "@/components/ui/Layout";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { PresenceCell } from "@/components/users/PresenceCell";
import {
  LoginDialogButton,
  PersonDialogButton,
  RemoveLoginButton,
  RemovePersonButton,
  ResetPasswordButton,
} from "@/components/users/UserActions";
import { currentUserOrNull, requireUser } from "@/lib/auth/require";
import { listAuthUsers } from "@/lib/db/queries/auth";
import { getBoard, getJiraIssues } from "@/lib/db/queries/board";
import { avatarUrl, avatarVersions } from "@/lib/db/queries/avatars";
import { agoText } from "@/lib/shared/format";
import { AUTH_ROLES } from "@/lib/shared/roles";
import { roleChip } from "@/lib/shared/tokens";
import type { AuthUser, Claim, DirectoryUser } from "@/lib/types";

/**
 * Users — everyone on the board, and which of them can sign in.
 *
 * These were two lists in the original app, and both carried their own copy of
 * the Jira assignee labels — so the same person could be spelled two ways and
 * the board would quietly disagree with itself about whose ticket was whose.
 *
 * Now a login points at a directory person by id and reads their labels through
 * that link, and this page is the join: one row per person, showing their login
 * if they have one. Most rows will not — being assignable and being able to sign
 * in are different things.
 */
export const metadata = { title: "Users · Glophics Portal" };

interface Row {
  person: DirectoryUser | null;
  login: AuthUser | null;
}

/**
 * Names on tickets that no login answers to.
 *
 * Every ticket under one of them is invisible on its owner's My tickets page —
 * and since a login reads its names through the person it points at, the fix is
 * either to give that person access or to point an existing account at them.
 */
function namesWithoutLogin(
  claims: Claim[],
  extraLabels: string[][],
  directory: DirectoryUser[],
  logins: AuthUser[],
): { name: string; tickets: number }[] {
  const covered = new Set<string>();
  for (const login of logins) {
    for (const name of login.jiraNames) covered.add(name.trim().toLowerCase());
    const person = directory.find((d) => d.id === login.directoryUserId);
    if (person) {
      covered.add(person.name.trim().toLowerCase());
      for (const name of person.jiraNames) covered.add(name.trim().toLowerCase());
    }
  }

  const counts = new Map<string, { name: string; tickets: number }>();
  const note = (label: string) => {
    const key = label.trim().toLowerCase();
    if (!key || covered.has(key)) return;
    const existing = counts.get(key);
    if (existing) existing.tickets += 1;
    else counts.set(key, { name: label.trim(), tickets: 1 });
  };

  for (const claim of claims) {
    for (const label of claim.rawAssignees) note(label);
    for (const id of claim.userIds) {
      const person = directory.find((d) => d.id === id);
      if (person) note(person.name);
    }
  }
  for (const labels of extraLabels) for (const label of labels) note(label);

  return [...counts.values()].sort((a, b) => b.tickets - a.tickets);
}

export default async function UsersPage() {
  // Reaching this page needs manage-users, and so does every route behind it.
  await requireUser("manage-users");

  const [board, logins, issues, me, avatars] = await Promise.all([
    getBoard(),
    listAuthUsers(),
    getJiraIssues(),
    currentUserOrNull(),
    avatarVersions(),
  ]);
  const { claims, directory } = board;

  const byPerson = new Map<string, AuthUser>();
  for (const login of logins) {
    if (login.directoryUserId) byPerson.set(login.directoryUserId, login);
  }

  const rows: Row[] = [
    ...[...directory]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((person) => ({ person, login: byPerson.get(person.id) ?? null })),
    // A login whose link is empty — or whose person has been removed — gets a
    // row of its own at the end. It would otherwise be invisible here, which
    // for the record that grants access is the one thing this page must never do.
    ...logins
      .filter((l) => !l.directoryUserId)
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((login) => ({ person: null, login })),
  ];

  const ticketsPerPerson = new Map<string, number>();
  for (const claim of claims) {
    for (const id of claim.userIds) {
      ticketsPerPerson.set(id, (ticketsPerPerson.get(id) ?? 0) + 1);
    }
  }

  const missing = namesWithoutLogin(
    claims,
    issues.map((i) => i.rawAssignees),
    directory,
    logins,
  );
  const missingTickets = missing.reduce((n, m) => n + m.tickets, 0);

  const withLogin = new Set(logins.map((l) => l.directoryUserId).filter(Boolean)).size;
  const active = logins.filter((l) => l.active).length;

  return (
    <Page>
      <PageHead
        title="Users"
        sub="Everyone on the board, and which of them can sign in"
        actions={
          <>
            <PersonDialogButton label="Add person" variant="ghost" size="md" />
            <LoginDialogButton label="Give someone a login" people={directory} variant="dark" size="md" />
          </>
        }
      />

      <section className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          tone="brand"
          label="People"
          value={directory.length}
          sub="assignable to a claim"
          icon="users"
        />
        <StatTile
          tone="alt"
          label="With a login"
          value={withLogin}
          sub={`of ${directory.length} can sign in`}
          icon="list"
        />
        <StatTile
          tone="ok"
          label="Active logins"
          value={active}
          sub={`${logins.length - active} deactivated`}
          icon="check"
        />
      </section>

      {missing.length ? (
        <Notice
          tone="warn"
          title={`${missingTickets} ticket${missingTickets === 1 ? " is" : "s are"} assigned to ${missing.length} name${missing.length === 1 ? "" : "s"} no login answers to`}
        >
          {missing
            .slice(0, 8)
            .map((m) => `${m.name} (${m.tickets})`)
            .join(" · ")}
          {missing.length > 8 ? ` and ${missing.length - 8} more` : ""}. Give that person a login — or
          point an existing one at them — and they will see their own tickets under My tickets.
        </Notice>
      ) : null}

      {rows.length ? (
        <Table
          isEmpty={false}
          head={
            <>
              <Th>Person</Th>
              <Th>Jira assignee</Th>
              <Th>Sign-in</Th>
              <Th className="whitespace-nowrap">Presence</Th>
              <Th className="whitespace-nowrap">Last sign-in</Th>
              <Th className="text-right" />
            </>
          }
        >
          {rows.map(({ person, login }) => {
            const isSelf = !!login && !!me && login.id === me.id;
            const label = person?.name ?? login?.displayName ?? "—";
            // A picture belongs to a login, so a person's face is read through
            // their link. Somebody with no login keeps their initials.
            const face = avatarUrl(login?.id ?? null, avatars);
            const avatarFor = person
              ? { id: person.id, name: person.name, avatarUrl: face }
              : { id: login!.id, name: login!.displayName, avatarUrl: face };

            return (
              <Tr key={person?.id ?? `login:${login!.id}`}>
                <Td>
                  <div className="flex items-center gap-3">
                    <Avatar person={avatarFor} size="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold">
                        {label}
                        {isSelf ? (
                          <span className="rounded-md bg-subtle-2 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted">
                            YOU
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[11px] text-faint">
                        {person ? (
                          person.jobRole || "No role set"
                        ) : (
                          <span className="text-warn">Not on the board</span>
                        )}
                      </p>
                    </div>
                  </div>
                </Td>

                <Td>
                  {person ? (
                    person.jiraNames.length ? (
                      <div className="flex flex-wrap gap-1">
                        {person.jiraNames.map((name) => (
                          <Chip key={name} className="bg-subtle-2 text-muted">
                            {name}
                          </Chip>
                        ))}
                      </div>
                    ) : (
                      <Muted>No Jira name</Muted>
                    )
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Td>

                <Td>
                  {login ? (
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-body">@{login.username}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <RoleChip role={login.role} />
                        {login.active ? null : (
                          <Chip className="bg-neutral-soft text-neutral">Deactivated</Chip>
                        )}
                      </div>
                    </div>
                  ) : (
                    <LoginDialogButton
                      label="No login — give access"
                      people={directory}
                      presetPersonId={person!.id}
                    />
                  )}
                </Td>

                <Td>
                  {login ? (
                    <PresenceCell userId={login.id} lastSeenAt={login.lastSeenAt} />
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Td>

                <Td>
                  {login?.lastLoginAt ? (
                    <span className="whitespace-nowrap text-xs text-body">
                      {agoText(login.lastLoginAt)} ago
                    </span>
                  ) : login ? (
                    <Muted>Never</Muted>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </Td>

                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {person ? <PersonDialogButton person={person} label="Edit person" /> : null}
                    {login ? (
                      <>
                        <LoginDialogButton login={login} people={directory} label="Login" />
                        <ResetPasswordButton login={login} />
                        {!isSelf ? <RemoveLoginButton login={login} /> : null}
                      </>
                    ) : person ? (
                      <RemovePersonButton
                        person={person}
                        heldTickets={ticketsPerPerson.get(person.id) ?? 0}
                      />
                    ) : null}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </Table>
      ) : (
        <Empty message="Nobody here yet." />
      )}

      <div className="mt-5">
        <Card title="What each role can do" sub="Roles are fixed; who holds them is not.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {AUTH_ROLES.map((role) => (
              <div key={role.id} className="rounded-xl bg-subtle p-3.5">
                <Chip className={roleChip(role.id)}>{role.label}</Chip>
                <p className="mt-2 text-xs leading-relaxed text-body">{role.description}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            A role only means anything to someone with a login. Changing it, deactivating them, or
            resetting their password ends their open sessions immediately — they do not keep the old
            access until a reload.
          </p>
        </Card>
      </div>
    </Page>
  );
}
