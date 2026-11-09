"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { realtimeHeaders } from "@/lib/realtime/client";
import { HEALTH_CHECK_INTERVAL_MS } from "@/lib/shared/health";

/**
 * "Check servers" — the forcing path, for when the schedule is not soon enough.
 *
 * ── Where the schedule went ──
 *
 * This component used to carry the automatic timer as well, because a Vercel
 * Cron entry only exists on a deployment and `npm run dev` would otherwise have
 * no scheduler at all. That timer now lives in components/shell/HealthButton.tsx
 * instead, and it is strictly better placed: the Topbar is in the app shell, so
 * it ticks on every page rather than only while somebody is looking at this one
 * — and this is not a page anybody leaves open. Development still gets a
 * scheduler, just a better-covered one.
 *
 * Keeping a second timer here would have meant two of them racing on this page.
 * The five-minute floor in lib/shared/health.ts would have made the loser a
 * no-op, so nothing would break — but the loser reports `skipped`, and landing
 * on this page would greet you with "Checked a moment ago" under a button you
 * never pressed.
 *
 * What stays is the button, because it is the only control that FORCES a pass.
 * A person pressing it wants a measurement rather than the server's opinion of
 * whether one is needed; every automatic caller passes `force: false` so that
 * several open tabs coalesce into one pass instead of one each.
 */

export function HealthActions({
  checkableCount,
}: {
  /** Repositories with a URL — the ones a pass can actually probe. Zero means
   *  there is nothing to measure, so the button has nothing to do. */
  checkableCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // The button disables itself while busy, so this is belt and braces against a
  // press landing in the gap before that render commits.
  const inFlight = useRef(false);

  // Always forces. This is the only control that does — every automatic caller
  // passes false so that open tabs coalesce, and there is no automatic caller
  // left in this file.
  const run = useCallback(
    async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setMessage(null);

      const res = await fetch(`/api/health/check?force=1`, {
        method: "POST",
        headers: realtimeHeaders(),
      }).catch(() => null);

      const data = (await res?.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        skipped?: boolean;
        online?: number;
        offline?: number;
        changed?: unknown[];
      };

      inFlight.current = false;
      setBusy(false);

      if (!res || data.ok === false) {
        setMessage(data.error ?? "Couldn't run the check.");
        return;
      }

      setMessage(
        data.skipped
          ? "Checked a moment ago — showing that result"
          : `${data.online ?? 0} online, ${data.offline ?? 0} offline` +
              (data.changed?.length ? ` · ${data.changed.length} changed` : " · no changes"),
      );

      // The results are in Postgres and this page renders from Postgres, so a
      // refresh is how this tab sees them. Other tabs get the server.health
      // event and refresh themselves.
      router.refresh();
    },
    [router],
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="dark" onClick={() => void run()} disabled={busy || checkableCount === 0}>
        <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Checking…" : "Check servers"}
      </Button>
      <span className="text-[11px] text-faint" role="status">
        {/* "while this page is open" would now be wrong: the timer moved to the
            header, so it runs on every page. */}
        {message ??
          (checkableCount === 0
            ? "No repository has a URL to check"
            : `Auto-checks every ${Math.round(HEALTH_CHECK_INTERVAL_MS / 60_000)} min while you're signed in`)}
      </span>
    </div>
  );
}
