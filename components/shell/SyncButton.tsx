"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { requestJiraSync } from "@/lib/jira/sync-now-client";
import { agoText } from "@/lib/shared/format";

/**
 * "Synced 3m ago" — and pressing it syncs.
 *
 * This was a read-only pill in the header. Making the freshness indicator the
 * button that refreshes it is the whole point: the moment you notice the number
 * is stale is the moment you want to act on it, and until now that meant
 * navigating to Settings to find **Sync now**.
 *
 * The request itself, and the wording of every outcome it can have, live in
 * lib/jira/sync-now-client.ts — including why a forced sync is the right thing
 * for a button and why `view` is enough to press one. My tickets has a second
 * button onto the same call, and the two must say the same things.
 */

export function SyncButton({
  jiraEnabled,
  lastSyncAt,
}: {
  jiraEnabled: boolean;
  lastSyncAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const label = !jiraEnabled
    ? "Jira off"
    : busy
      ? "Syncing…"
      : lastSyncAt
        ? `Synced ${agoText(lastSyncAt)} ago`
        : "Not synced yet";

  async function syncNow() {
    if (busy || !jiraEnabled) return;
    setBusy(true);

    const outcome = await requestJiraSync();

    setBusy(false);

    // One key for all of them, so a run of impatient presses replaces its own
    // toast instead of stacking four.
    toast.show({ key: "jira:sync-now", title: outcome.title, body: outcome.body });
    if (!outcome.ok) return;

    // The board renders from Postgres and the sync wrote to Postgres, so a
    // refresh is how this tab sees it. Other tabs get the realtime event.
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      // Busy does NOT disable it: `disabled:opacity-50` on a spinning icon and a
      // "Syncing…" label greys out the one thing worth reading. The handler
      // guards instead, so a second press while one is in flight is a no-op.
      disabled={!jiraEnabled}
      aria-busy={busy}
      aria-label={jiraEnabled ? "Sync Jira now" : "Jira integration is off"}
      title={
        !jiraEnabled
          ? "Jira integration is off"
          : busy
            ? "Syncing with Jira…"
            : `${label} — click to sync now`
      }
      className="flex h-9 max-w-[170px] items-center gap-2 rounded-xl bg-subtle px-3 text-xs font-semibold text-muted ring-1 ring-line-soft transition hover:bg-subtle-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-subtle disabled:hover:text-muted"
    >
      <Icon name="refresh" className={`h-3.5 w-3.5 shrink-0 text-faint ${busy ? "animate-spin" : ""}`} />
      {/* The label is the first thing to go when the header runs out of room;
          the icon alone still reads as "sync". */}
      <span className="hidden truncate lg:inline">{label}</span>
    </button>
  );
}
