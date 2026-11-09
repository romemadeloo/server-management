"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { requestJiraSync } from "@/lib/jira/sync-now-client";

/**
 * "Refresh from Jira" on My tickets.
 *
 * ── Why a second button, when the header already has one ──
 *
 * The header pill is a freshness *indicator* that happens to be pressable, and
 * it reads as one — it is easy to look straight past when the question in your
 * head is "is this list everything I have?". That question is asked on this
 * page and nowhere else, so the answer needs a control on this page. Both go
 * through requestJiraSync(), so they force the same sync and report it in the
 * same words; only the shape differs.
 *
 * ── Why the label does not say "my tickets" ──
 *
 * It would be a lie. /api/jira/sync-now pulls the whole board in one search —
 * there is no per-person Jira query — and this page then shows your slice of
 * what came back. Naming the button after the request rather than after the
 * page keeps that visible: what it refreshes is Jira, and what it CANNOT do is
 * reach a ticket the sync's own window and ignored-status list exclude.
 */
export function RefreshTickets({
  jiraEnabled,
}: {
  /** Settings › Jira. With the integration off there is nothing to pull, and
   *  the route would answer `disabled` — better said before the press. */
  jiraEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The button disables itself while busy, so this is belt and braces against a
  // press landing in the gap before that render commits.
  const inFlight = useRef(false);

  async function refresh() {
    if (inFlight.current || !jiraEnabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);

    const outcome = await requestJiraSync();

    inFlight.current = false;
    setBusy(false);
    // No toast here, unlike the header button: this one has a line of its own
    // under it, and a toast as well would say the same thing twice.
    setMessage(outcome.ok ? outcome.body : `${outcome.title} — ${outcome.body}`);

    // The list renders from Postgres and the sync wrote to Postgres, so a
    // refresh is how this tab sees it. It also re-runs the status counts, which
    // is the half a stale render would get visibly wrong.
    if (outcome.ok) router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="dark" onClick={() => void refresh()} disabled={busy || !jiraEnabled}>
        <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Fetching…" : "Refresh from Jira"}
      </Button>
      <span className="text-[11px] text-faint" role="status">
        {message ?? (jiraEnabled ? "Pulls the board now, then reloads this list" : "Jira is switched off")}
      </span>
    </div>
  );
}
