"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, Field, FormError, TextArea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { realtimeHeaders } from "@/lib/realtime/client";
import { shortRepo } from "@/lib/shared/tokens";
import type { DirectoryUser, Settings } from "@/lib/types";

/**
 * The interactive parts of the environment detail page: claiming repositories,
 * force-freeing, and per-repo notes.
 *
 * Each action posts to a granular endpoint and then calls `router.refresh()`,
 * which re-runs the Server Components and repaints with the server's own view.
 * No client-side copy of the board is kept, so there is nothing to get out of
 * step — which is what the legacy `appData` mirror kept getting wrong.
 */

async function post(url: string, body?: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    // realtimeHeaders() carries this tab's Pusher socket id, so the server can
    // exclude it from the fan-out. Without it this tab receives an echo of its
    // own change and refreshes twice.
    headers: { ...realtimeHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: string[] };
  return { ok: res.ok && data.ok !== false, message: [data.error, ...(data.errors ?? [])].filter(Boolean).join(" ") };
}

/** Local datetime string for an <input type="datetime-local">, which wants no
 *  timezone suffix and minute precision. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------- assign ----------

export function AssignButton({
  serverId,
  freeRepos,
  directory,
  settings,
  disabled,
}: {
  serverId: string;
  freeRepos: string[];
  directory: DirectoryUser[];
  settings: Settings;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Claiming is per-repo, but most bookings take the whole environment" — so
  // when assignWholeEnv is on, every free repo starts ticked.
  const [repos, setRepos] = useState<string[]>(settings.assignWholeEnv ? freeRepos : []);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [ticket, setTicket] = useState("");
  const [note, setNote] = useState("");

  const now = new Date();
  const [start, setStart] = useState(toLocalInput(now));
  const [end, setEnd] = useState(
    toLocalInput(new Date(now.getTime() + settings.defaultBookingHours * 3600_000)),
  );

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function submit() {
    setError(null);
    setPending(true);

    const result = await post("/api/claims", {
      serverId,
      repos,
      userIds,
      jiraTicket: ticket.trim() || null,
      note: note.trim() || null,
      // datetime-local has no zone, so it is read in the browser's zone and
      // sent as a real instant. Storing a naive string would make "frees in
      // 40m" wrong for anyone in a different timezone.
      startTime: start ? new Date(start).toISOString() : null,
      endTime: end ? new Date(end).toISOString() : null,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.message || "Couldn't create that claim.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="dark" onClick={() => setOpen(true)} disabled={disabled}>
        Assign
      </Button>

      {open ? (
        <Modal
          title="Claim repositories"
          subtitle={
            settings.jira.requireTicket
              ? "A Jira ticket key is required by your settings."
              : "Leave the ticket blank for a manual claim."
          }
          submitLabel="Claim"
          pending={pending}
          wide
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-semibold text-muted">Repositories</p>
              {freeRepos.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {freeRepos.map((repo) => {
                    const on = repos.includes(repo);
                    return (
                      <button
                        key={repo}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setRepos((r) => toggle(r, repo))}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                          on ? "bg-accent text-on-accent" : "bg-surface text-muted ring-1 ring-line-2 hover:text-ink"
                        }`}
                      >
                        {shortRepo(repo)} · {repo}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-warn">
                  Every repository here is already held. Force free one first.
                </p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold text-muted">Assign to</p>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-subtle p-3">
                {directory.length ? (
                  directory.map((person) => (
                    <Checkbox
                      key={person.id}
                      label={person.name}
                      hint={person.jobRole || undefined}
                      checked={userIds.includes(person.id)}
                      onChange={() => setUserIds((u) => toggle(u, person.id))}
                    />
                  ))
                ) : (
                  <p className="text-xs text-faint">
                    Nobody is on the board yet — add people under Users first.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Jira ticket"
                placeholder="PROJ-1234"
                value={ticket}
                onChange={(e) => setTicket(e.target.value)}
                autoCapitalize="characters"
                spellCheck={false}
              />
              <div />
              <Field
                label="From"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <Field label="Until" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>

            <TextArea
              label="Note (optional)"
              rows={2}
              placeholder="What is being tested?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

// ---------- force free ----------

export function ForceFreeServerButton({
  serverId,
  serverName,
  claimCount,
}: {
  serverId: string;
  serverName: string;
  claimCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    const result = await post(`/api/servers/${encodeURIComponent(serverId)}/claims`, undefined, "DELETE");
    setPending(false);

    if (!result.ok) {
      setError(result.message || "Couldn't free that environment.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} disabled={!claimCount}>
        Force free all
      </Button>

      {open ? (
        <Modal
          title="Force free this environment?"
          submitLabel="Force free all"
          variant="danger"
          pending={pending}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <p className="text-sm text-body">
            This drops all {claimCount} active claim{claimCount === 1 ? "" : "s"} on{" "}
            <strong>{serverName}</strong>. A live Jira ticket still at an occupying status may be
            re-claimed on the next sync.
          </p>
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

export function ForceFreeClaimButton({
  claimId,
  repos,
  holders,
}: {
  claimId: string;
  repos: string[];
  holders: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    const result = await post(`/api/claims/${encodeURIComponent(claimId)}`, undefined, "DELETE");
    setPending(false);

    if (!result.ok) {
      setError(result.message || "Couldn't free that claim.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="danger" size="sm" className="whitespace-nowrap" onClick={() => setOpen(true)}>
        Force free
      </Button>

      {open ? (
        <Modal
          title="Force free this claim?"
          submitLabel="Force free"
          variant="danger"
          pending={pending}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <p className="text-sm text-body">
            <strong>{claimId}</strong> holds {repos.join(", ")}
            {holders ? ` for ${holders}` : ""}. If the ticket is still at an occupying status, the next
            sync may re-claim it.
          </p>
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}

// ---------- notes ----------

export function NoteButton({
  serverId,
  repoName,
  note,
}: {
  serverId: string;
  repoName: string;
  note: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(note ?? "");

  async function submit() {
    setPending(true);
    const result = await post(`/api/servers/${encodeURIComponent(serverId)}/notes`, {
      repoName,
      text,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.message || "Couldn't save that note.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <IconButton
        icon="note"
        title={note ? "Edit note" : "Add a note"}
        className={note ? "text-brand-fg ring-brand-soft" : ""}
        onClick={() => setOpen(true)}
      />

      {open ? (
        <Modal
          title={`Note on ${repoName}`}
          subtitle="Anyone on the board can see this. Clearing it removes the note."
          submitLabel="Save note"
          pending={pending}
          onSubmit={submit}
          onClose={() => setOpen(false)}
        >
          <TextArea
            label="Note"
            rows={4}
            placeholder="e.g. mid-migration, do not redeploy"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <FormError>{error}</FormError>
        </Modal>
      ) : null}
    </>
  );
}
