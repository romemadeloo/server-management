"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormError, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { realtimeHeaders } from "@/lib/realtime/client";
import { AUTH_ROLES } from "@/lib/shared/roles";
import type { AuthUser, DirectoryUser } from "@/lib/types";

/**
 * Dialogs for the Users page. Two different records, deliberately kept distinct:
 *
 *   a "person"  is a directory entry — assignable to a claim, no login
 *   a "login"   is an auth account — can sign in, optionally linked to a person
 *
 * Most of the board is only ever the first. Conflating them is the single most
 * common source of bugs in this app, so even the dialog titles say which.
 */

async function send(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { ...realtimeHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: string[] };
  return {
    ok: res.ok && data.ok !== false,
    message: [data.error, ...(data.errors ?? [])].filter(Boolean).join(" "),
  };
}

function useAction(onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<{ ok: boolean; message: string }>, fallback: string) {
    setError(null);
    setPending(true);
    const result = await work();
    setPending(false);

    if (!result.ok) {
      setError(result.message || fallback);
      return false;
    }
    onDone();
    return true;
  }

  return { pending, error, run, setError };
}

const ROLE_OPTIONS = AUTH_ROLES.map((r) => ({ value: r.id, label: r.label }));

// ---------- people ----------

export function PersonDialogButton({
  person,
  label,
  variant = "quiet",
  size = "sm",
}: {
  person?: DirectoryUser;
  label: string;
  variant?: "quiet" | "ghost" | "dark";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(person?.name ?? "");
  const [jobRole, setJobRole] = useState(person?.jobRole ?? "");
  const [jiraNames, setJiraNames] = useState((person?.jiraNames ?? []).join(", "));

  const { pending, error, run } = useAction(() => {
    setOpen(false);
    router.refresh();
  });

  async function submit() {
    await run(
      () =>
        send(person ? `/api/directory/${encodeURIComponent(person.id)}` : "/api/directory", {
          name,
          jobRole,
          jiraNames,
        }),
      "Couldn't save that person.",
    );
  }

  return (
    <>
      <Button variant={variant} size={size} className="whitespace-nowrap" onClick={() => setOpen(true)}>
        {label}
      </Button>

      {open ? (
        <Modal
          title={person ? `Edit ${person.name}` : "Add a person"}
          subtitle="Someone who can be assigned a claim. This does not give them a login."
          submitLabel={person ? "Save person" : "Add person"}
          pending={pending}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-4">
            <Field
              label="Display name"
              placeholder="[QA]_Jerome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Field
              label="Job role"
              placeholder="QA, Backend, Frontend…"
              value={jobRole}
              onChange={(e) => setJobRole(e.target.value)}
            />
            <Field
              label="Jira assignee labels"
              placeholder="[QA]_Jerome, [QA]_Jerome_C"
              value={jiraNames}
              onChange={(e) => setJiraNames(e.target.value)}
            />
            <p className="text-[11px] leading-relaxed text-faint">
              Comma separated. These are matched against a ticket&apos;s <strong>Ticket Assignee</strong>{" "}
              field, so they decide whose tickets these are. Leave blank to use the display name. A label
              can only belong to one person — two people answering to the same one would make matching a
              coin toss.
            </p>
          </div>
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

export function RemovePersonButton({ person, heldTickets }: { person: DirectoryUser; heldTickets: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction(() => {
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button variant="danger" size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        Remove
      </Button>

      {open ? (
        <Modal
          title={`Remove ${person.name}?`}
          submitLabel="Remove person"
          variant="danger"
          pending={pending}
          onSubmit={() =>
            run(
              () => send(`/api/directory/${encodeURIComponent(person.id)}`, undefined, "DELETE"),
              "Couldn't remove that person.",
            )
          }
          onClose={() => setOpen(false)}
        >
          <p className="text-sm text-body">
            {heldTickets
              ? `${heldTickets} ticket${heldTickets === 1 ? "" : "s"} name them. Those claims stay, but nobody will be listed as holding them.`
              : "They hold nothing, so nothing else is affected."}
          </p>
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

// ---------- logins ----------

export function LoginDialogButton({
  login,
  people,
  presetPersonId,
  label,
  variant = "quiet",
  size = "sm",
}: {
  login?: AuthUser;
  people: DirectoryUser[];
  presetPersonId?: string;
  label: string;
  variant?: "quiet" | "ghost" | "dark";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(login?.username ?? "");
  const [displayName, setDisplayName] = useState(login?.displayName ?? "");
  const [role, setRole] = useState<string>(login?.role ?? "member");
  const [password, setPassword] = useState("");
  const [directoryUserId, setDirectoryUserId] = useState(login?.directoryUserId ?? presetPersonId ?? "");
  const [active, setActive] = useState(login?.active ?? true);

  const { pending, error, run } = useAction(() => {
    setOpen(false);
    router.refresh();
  });

  // A person who already has a login cannot take another — one person, one
  // account, or each would be shown the other's tickets as their own.
  const personOptions = [
    { value: "", label: "Nobody — not on the board" },
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ];

  async function submit() {
    await run(
      () =>
        send(login ? `/api/auth/users/${encodeURIComponent(login.id)}` : "/api/auth/users", {
          username,
          displayName,
          role,
          directoryUserId: directoryUserId || null,
          ...(login ? { active } : { password }),
        }),
      "Couldn't save that login.",
    );
  }

  return (
    <>
      <Button variant={variant} size={size} className="whitespace-nowrap" onClick={() => setOpen(true)}>
        {label}
      </Button>

      {open ? (
        <Modal
          title={login ? `Login @${login.username}` : "Give someone a login"}
          subtitle="A login can sign in. Point it at a person so their own tickets show up under My tickets."
          submitLabel={login ? "Save login" : "Create login"}
          pending={pending}
          wide
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Username"
              placeholder="jerome"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <Field
              label="Display name"
              placeholder="Jerome"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />

            {!login ? (
              <Field
                label="Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                span
              />
            ) : null}
          </div>

          <div className="mt-5 space-y-4">
            <Select
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
            <Select
              label="This login is"
              options={personOptions}
              value={directoryUserId}
              onChange={(e) => setDirectoryUserId(e.target.value)}
            />
            {login ? (
              <Select
                label="Access"
                options={[
                  { value: "yes", label: "Active" },
                  { value: "no", label: "Deactivated" },
                ]}
                value={active ? "yes" : "no"}
                onChange={(e) => setActive(e.target.value === "yes")}
              />
            ) : null}
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-faint">
            Changing the role or deactivating the account ends every session that person has
            immediately — an open tab loses the access it had rather than keeping it until reload.
          </p>

          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

export function ResetPasswordButton({ login }: { login: AuthUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const { pending, error, run } = useAction(() => {
    setOpen(false);
    setPassword("");
    router.refresh();
  });

  return (
    <>
      <Button variant="quiet" size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        Reset password
      </Button>

      {open ? (
        <Modal
          title={`Reset the password for @${login.username}`}
          subtitle="They are signed out everywhere and will need the new password."
          submitLabel="Set password"
          pending={pending}
          onSubmit={() =>
            run(
              () => send(`/api/auth/users/${encodeURIComponent(login.id)}/password`, { password }),
              "Couldn't reset that password.",
            )
          }
          onClose={() => setOpen(false)}
        >
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

export function RemoveLoginButton({ login }: { login: AuthUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction(() => {
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button variant="danger" size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        Remove login
      </Button>

      {open ? (
        <Modal
          title={`Remove @${login.username}?`}
          submitLabel="Remove login"
          variant="danger"
          pending={pending}
          onSubmit={() =>
            run(
              () => send(`/api/auth/users/${encodeURIComponent(login.id)}`, undefined, "DELETE"),
              "Couldn't remove that login.",
            )
          }
          onClose={() => setOpen(false)}
        >
          <p className="text-sm text-body">
            They lose access immediately and any open session of theirs is dropped. They stay on the
            board as a person, so their claims and tickets are untouched — this only takes away the
            login.
          </p>
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}
