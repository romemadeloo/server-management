"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toaster";
import { realtimeHeaders } from "@/lib/realtime/client";
import { agoText } from "@/lib/shared/format";
import { isPassDue, isStale } from "@/lib/shared/health";

/**
 * "Checked 12m ago" — and pressing it checks the servers.
 *
 * The move SyncButton made for Jira freshness, made for health freshness: the
 * moment you notice the board might be wrong about what is up is the moment you
 * want to re-measure, and until now that meant navigating to /health to find the
 * one button that could. This puts it wherever you already are.
 *
 * ── Why this is a SECOND pill and not folded into SyncButton ──
 *
 * Topbar's own argument, extended by one. "Live", "Synced Nm ago" and "Checked
 * Nm ago" are three different measurements that fail independently — Jira can be
 * hours stale while every environment is up, and every environment can be
 * unmeasured while Jira is perfectly fresh. One combined timestamp would hide
 * which of them broke, which is the distinction `health_checked_at` exists to
 * make sayable at all.
 *
 * There is a cost argument too, and it is the stronger one. A Jira sync is one
 * API call with a one-minute floor. A health pass is ~90 outbound requests aimed
 * at other people's dev boxes and takes about seven seconds — see the
 * `health.check` comment in lib/rate-limit.ts, which is deliberately tight
 * because it protects those boxes as much as us. Sharing a control would mean
 * sharing a cadence, and Jira's cadence would win.
 *
 * ── Why the timer lives here ──
 *
 * Because Topbar is in the app shell, this ticks on EVERY page behind the gate
 * rather than only while somebody has /health open — and /health is not a page
 * anybody leaves open. Vercel's Hobby tier schedules a cron at most once a day
 * (see app/api/cron/health/route.ts), so in practice this IS the hourly schedule
 * and the daily cron is the backstop for when nobody is signed in.
 *
 * Same division of labour as JiraAutoSync on the dashboard: the tab asks, the
 * SERVER decides. The automatic path does not force, so the five-minute floor in
 * lib/shared/health.ts collapses several open tabs into one pass instead of one
 * each — and there are more of them to collapse now that every page carries this
 * pill. The press forces, because somebody pressing it wants a measurement
 * rather than the server's opinion of whether one is needed.
 *
 * HealthActions on /health kept its button for exactly that reason and gave up
 * its timer to this one; the note there says why two would have been worse than
 * one.
 *
 * `attemptedAt` records the ATTEMPT and not the result, so a pass the server
 * skipped, or one that failed outright, still counts as "this tab tried" and
 * cannot spin into a retry loop.
 */

/** How often the tab reconsiders whether a pass is due. It is a comparison, and
 *  only a due check costs a request — a repeating tick survives a sleeping
 *  laptop that would silently stretch one long timeout. It doubles as the clock
 *  that keeps the "Nm ago" label honest between navigations. */
const TICK_MS = 60_000;

interface CheckResponse {
  ok?: boolean;
  error?: string;
  skipped?: boolean;
  online?: number;
  offline?: number;
  changed?: unknown[];
}

function outcomeText(data: CheckResponse): string {
  if (data.skipped) return "Checked a moment ago — showing that result";
  return (
    `${data.online ?? 0} online, ${data.offline ?? 0} offline` +
    // A pass that changed nothing is the normal case, and silence about it reads
    // as the button not having worked.
    (data.changed?.length ? ` · ${data.changed.length} changed` : " · no changes")
  );
}

export function HealthButton({
  lastCheckedAt,
  checkableCount,
}: {
  lastCheckedAt: string | null;
  /** Repositories with a URL — the ones a pass can actually probe. Zero means
   *  there is nothing to measure and the automatic path must stay off, or it
   *  would ask for ever: with no URLs anywhere, no pass can ever set a
   *  `health_checked_at` for it to be satisfied by. */
  checkableCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Bumped by the tick purely to re-render, so "Checked 12m ago" keeps counting
  // while somebody sits on one page without navigating.
  const [, setTick] = useState(0);

  // Set BEFORE the request, so the automatic path cannot start a second pass
  // while the first is still in flight.
  const attemptedAt = useRef<number>(0);
  const inFlight = useRef(false);

  const run = useCallback(
    async (force: boolean) => {
      if (inFlight.current || checkableCount === 0) return;
      inFlight.current = true;
      attemptedAt.current = Date.now();
      setBusy(true);

      const response = await fetch(`/api/health/check${force ? "?force=1" : ""}`, {
        method: "POST",
        headers: realtimeHeaders(),
      }).catch(() => null);
      const data = (await response?.json().catch(() => null)) as CheckResponse | null;

      inFlight.current = false;
      setBusy(false);

      // Only a press talks. An automatic pass firing a toast would mean landing
      // on any page after an hour away greets you with a notification you did
      // not ask for — and on /health, two of them. A failed automatic pass is
      // silent for the same reason: the label going stale is the honest signal,
      // and the next tick will try again.
      //
      // One toast key for all of them, so a run of impatient presses replaces
      // its own toast instead of stacking four.
      if (!response || !data?.ok) {
        if (force) {
          toast.show({
            key: "health:check",
            title: "Server check didn't run",
            body: data?.error ?? "Couldn't reach the server.",
          });
        }
        return;
      }

      if (force) {
        toast.show({ key: "health:check", title: "Servers checked", body: outcomeText(data) });
      }

      // The results are in Postgres and these pages render from Postgres, so a
      // refresh is how this tab sees them. Other tabs get the server.health
      // event, which PusherProvider turns into a refresh of their own.
      router.refresh();
    },
    [router, toast, checkableCount],
  );

  useEffect(() => {
    if (checkableCount === 0) return;

    const tick = () => {
      setTick((n) => n + 1);
      if (document.visibilityState === "hidden") return;
      // Whichever is later wins. A stamp from somebody else's pass means the
      // data is current; an attempt of our own means we have already asked.
      const latest = Math.max(
        attemptedAt.current,
        lastCheckedAt ? new Date(lastCheckedAt).getTime() : 0,
      );
      if (isPassDue(latest ? new Date(latest).toISOString() : null)) void run(false);
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    const onVisible = () => tick();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [lastCheckedAt, checkableCount, run]);

  const nothingToCheck = checkableCount === 0;
  // Old enough that presenting it as current would be a lie. This is the whole
  // reason the check TIME is recorded and not just the verdict, so it has to be
  // visible rather than merely available. `isStale` reads a missing timestamp as
  // "not stale" on purpose — a board nobody has ever checked says so in words.
  const stale = isStale(lastCheckedAt);

  const label = nothingToCheck
    ? "No URLs"
    : busy
      ? "Checking…"
      : lastCheckedAt
        ? `Checked ${agoText(lastCheckedAt)} ago`
        : "Not checked yet";

  return (
    <button
      type="button"
      onClick={() => void run(true)}
      // Busy does NOT disable it: `disabled:opacity-50` on a pulsing icon and a
      // "Checking…" label greys out the one thing worth reading. The handler
      // guards instead, so a second press while one is in flight is a no-op.
      disabled={nothingToCheck}
      aria-busy={busy}
      aria-label={nothingToCheck ? "No repository has a URL to check" : "Check servers now"}
      title={
        nothingToCheck
          ? "No repository has a URL to check"
          : busy
            ? "Checking servers…"
            : stale
              ? `${label} — old enough to be out of date. Click to check now.`
              : `${label} — click to check now`
      }
      className={`flex h-9 max-w-[170px] items-center gap-2 rounded-xl bg-subtle px-3 text-xs font-semibold ring-1 transition hover:bg-subtle-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-subtle ${
        stale ? "text-warn ring-warn/30" : "text-muted ring-line-soft disabled:hover:text-muted"
      }`}
    >
      <Icon
        name="pulse"
        className={`h-3.5 w-3.5 shrink-0 ${stale ? "text-warn" : "text-faint"} ${busy ? "animate-pulse" : ""}`}
      />
      {/* The label is the first thing to go when the header runs out of room;
          the icon alone still reads as "server health". */}
      <span className="hidden truncate lg:inline">{label}</span>
    </button>
  );
}
