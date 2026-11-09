"use client";

import { useRouter } from "next/navigation";
import { realtimeHeaders } from "@/lib/realtime/client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { FormError, Select, Toggle } from "@/components/ui/Form";
import { Card } from "@/components/ui/Layout";
import { JIRA_STATUS_VOCABULARY, JIRA_TERMINAL_STATUSES } from "@/lib/jira/matching";
import { agoText } from "@/lib/shared/format";
import type { JiraSettings as JiraSettingsShape } from "@/lib/types";

/**
 * The Jira integration: whether it runs, how often, and which statuses take and
 * release an environment.
 *
 * Credentials are NOT editable here. They are environment variables now, so the
 * connection panel is read-only — which is what the legacy README already
 * described for deployments.
 */
export function JiraSettings({
  jira,
  connection,
  lastSyncAt,
  lastError,
}: {
  jira: JiraSettingsShape;
  connection: { configured: boolean; baseUrl: string | null; email: string | null };
  lastSyncAt: string | null;
  lastError: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "test" | "sync">(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save(patch: Partial<JiraSettingsShape>) {
    setError(null);
    setBusy("save");

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { ...realtimeHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ jira: patch }),
    }).catch(() => null);

    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; errors?: string[] };
    setBusy(null);

    if (!res?.ok || data.ok === false) {
      setError(data.errors?.join(" ") ?? "Couldn't save that setting.");
      return;
    }
    router.refresh();
  }

  async function test() {
    setTestResult(null);
    setBusy("test");
    const res = await fetch("/api/jira/test", { method: "POST", headers: realtimeHeaders() }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      account?: string;
    };
    setBusy(null);
    setTestResult(data.ok ? `Connected as ${data.account}` : (data.error ?? "Couldn't reach Jira."));
  }

  async function syncNow() {
    setBusy("sync");
    await fetch("/api/jira/sync-now", { method: "POST", headers: realtimeHeaders() }).catch(() => {});
    setBusy(null);
    router.refresh();
  }

  /**
   * A status belongs to at most one of the two lists. Clicking it in one removes
   * it from the other, because a status that both takes and frees an environment
   * would claim on one pass and release on the next, forever.
   */
  function toggleStatus(list: "occupyingStatuses" | "releasingStatuses", status: string) {
    const other = list === "occupyingStatuses" ? "releasingStatuses" : "occupyingStatuses";
    const inList = jira[list].some((s) => s.toLowerCase() === status.toLowerCase());

    save({
      [list]: inList
        ? jira[list].filter((s) => s.toLowerCase() !== status.toLowerCase())
        : [...jira[list], status],
      [other]: jira[other].filter((s) => s.toLowerCase() !== status.toLowerCase()),
    } as Partial<JiraSettingsShape>);
  }

  /** Toggles a status in the hide list — read by Active tickets, not by the sync. */
  function toggleIgnored(status: string) {
    const inList = jira.ignoredStatuses.some((s) => s.toLowerCase() === status.toLowerCase());
    save({
      ignoredStatuses: inList
        ? jira.ignoredStatuses.filter((s) => s.toLowerCase() !== status.toLowerCase())
        : [...jira.ignoredStatuses, status],
    });
  }

  const has = (list: string[], status: string) =>
    list.some((s) => s.toLowerCase() === status.toLowerCase());

  return (
    <div className="space-y-4">
      <Card title="Jira connection" sub="Read from environment variables — set them in your deployment.">
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-body">Status</dt>
            <dd>
              {connection.configured ? (
                <Chip className="bg-ok-soft text-ok">Configured</Chip>
              ) : (
                <Chip className="bg-warn-soft text-warn">Not configured</Chip>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-body">Site</dt>
            <dd className="truncate text-xs text-muted">{connection.baseUrl ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-body">Account</dt>
            <dd className="truncate text-xs text-muted">{connection.email ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-body">API token</dt>
            <dd className="text-xs text-faint">Never shown</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button onClick={test} disabled={busy !== null || !connection.configured}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button variant="dark" onClick={syncNow} disabled={busy !== null || !jira.enabled}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
          {lastSyncAt ? (
            <span className="text-xs text-faint">Last synced {agoText(lastSyncAt)} ago</span>
          ) : (
            <span className="text-xs text-faint">Never synced</span>
          )}
        </div>

        {testResult ? <p className="mt-3 text-xs font-medium text-body">{testResult}</p> : null}

        {lastError ? (
          <p className="mt-3 rounded-xl bg-bad-soft px-3.5 py-2.5 text-xs text-bad">
            Last sync failed: {lastError}
          </p>
        ) : null}

        {!connection.configured ? (
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Set <code className="font-mono">JIRA_BASE_URL</code>,{" "}
            <code className="font-mono">JIRA_EMAIL</code> and{" "}
            <code className="font-mono">JIRA_API_TOKEN</code> in your deployment, then redeploy.
          </p>
        ) : null}
      </Card>

      <Card title="Sync" sub="Whether tickets drive the board, and how often it is checked.">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-body">Enable Jira</p>
              <p className="mt-0.5 text-xs text-faint">
                Off, the board is entirely manual and no ticket claims anything.
              </p>
            </div>
            <Toggle
              on={jira.enabled}
              label="Enable Jira"
              disabled={busy !== null}
              onChange={(next) => save({ enabled: next })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-body">Sync on a schedule</p>
              <p className="mt-0.5 text-xs text-faint">
                Off, only the Sync now button pulls from Jira.
              </p>
            </div>
            <Toggle
              on={jira.autoSync}
              label="Sync on a schedule"
              disabled={busy !== null}
              onChange={(next) => save({ autoSync: next })}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-body">Require a ticket to claim</p>
              <p className="mt-0.5 text-xs text-faint">
                Off, somebody can book an environment without naming a ticket.
              </p>
            </div>
            <Toggle
              on={jira.requireTicket}
              label="Require a ticket to claim"
              disabled={busy !== null}
              onChange={(next) => save({ requireTicket: next })}
            />
          </div>

          <p className="rounded-xl bg-subtle px-3.5 py-2.5 text-[11px] leading-relaxed text-muted">
            The scheduled sync now runs about once a minute, set in{" "}
            <code className="font-mono">vercel.json</code> rather than here — a hosted cron cannot go
            below that. The legacy 20-second tick is gone; use <strong>Sync now</strong> when you need
            an answer immediately.
          </p>
        </div>
      </Card>

      <Card
        title="Status rules"
        sub="Which statuses take an environment, and which give it back. Anything unlisted leaves an existing claim alone."
      >
        <div className="space-y-5">
          <div>
            <p className="text-[11px] font-semibold text-muted">Occupies a server</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {JIRA_STATUS_VOCABULARY.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy !== null || JIRA_TERMINAL_STATUSES.includes(status as never)}
                  title={
                    JIRA_TERMINAL_STATUSES.includes(status as never)
                      ? "A finished ticket can never take an environment"
                      : undefined
                  }
                  onClick={() => toggleStatus("occupyingStatuses", status)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide transition disabled:opacity-40 ${
                    has(jira.occupyingStatuses, status)
                      ? "bg-warn-strong text-white"
                      : "bg-subtle-2 text-muted hover:text-ink"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted">Frees the server</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {JIRA_STATUS_VOCABULARY.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => toggleStatus("releasingStatuses", status)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide transition disabled:opacity-40 ${
                    has(jira.releasingStatuses, status) || JIRA_TERMINAL_STATUSES.includes(status as never)
                      ? "bg-ok-strong text-white"
                      : "bg-subtle-2 text-muted hover:text-ink"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              {JIRA_TERMINAL_STATUSES.join(", ")} always free the environment, whatever this list says —
              a cancelled or closed ticket is nobody&apos;s work in progress, and leaving a box held in
              its name is a booking nothing will ever come back to clear.
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted">Hidden from Active tickets</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {JIRA_STATUS_VOCABULARY.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => toggleIgnored(status)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide transition disabled:opacity-40 ${
                    has(jira.ignoredStatuses, status)
                      ? "bg-accent text-on-accent"
                      : "bg-subtle-2 text-muted hover:text-ink"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              A ticket parked at one of these is not being worked on, so it is left off{" "}
              <strong>Active tickets</strong> — which asks what is in progress, not what exists.
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              It is still <em>fetched</em>, and still on <strong>My tickets</strong>. This list used
              to be cut out of the Jira query itself, which meant a person could not see their own
              closed or not-yet-started work anywhere in the app. Hiding a row and never reading it
              are different things, and only the first of them belongs to a preference.
            </p>
          </div>
        </div>

        <FormError>{error}</FormError>
      </Card>
    </div>
  );
}
