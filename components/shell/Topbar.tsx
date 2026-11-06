"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ConnectionDot } from "./ConnectionDot";
import { NotificationCenter } from "./NotificationCenter";
import { SyncButton } from "./SyncButton";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { HealthButton } from "./HealthButton";

/**
 * Search, freshness, connection status, and appearance controls.
 *
 * The three indicators are deliberately separate. "Live" is whether *other
 * people's* changes reach this tab; "Synced Nm ago" is how fresh the Jira data
 * is; "Checked Nm ago" is when anything last measured whether the environments
 * are actually up. Any one of them can be fine while another is not — Jira can
 * be hours stale with every box healthy, and every box can be unmeasured with
 * Jira perfectly current — and a single combined light would hide which.
 *
 * Two of them are pressable, and only those two can be: staleness is something
 * you can go and fix, so each freshness indicator is the button that fixes
 * itself. A dropped realtime connection is not — it reconnects on its own — so
 * the dot stays a light.
 *
 * Putting the health check here rather than only on /health is the point of it:
 * you notice the board looks wrong from wherever you happen to be, and the fix
 * should not be a navigation. It also means the hourly automatic pass rides the
 * shell, so it runs on every page instead of only while somebody has /health
 * open — see HealthButton.
 */
export function Topbar({
  jiraEnabled,
  lastSyncAt,
  healthCheckedAt,
  checkableRepoCount,
}: {
  jiraEnabled: boolean;
  lastSyncAt: string | null;
  healthCheckedAt: string | null;
  checkableRepoCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep the field in step when navigation changes the query from elsewhere
  // (a cleared filter, a link with its own ?q=).
  useEffect(() => {
    setTerm(params.get("q") ?? "");
  }, [params]);

  // Debounced, and it navigates rather than holding filter state: the URL is
  // then shareable and survives a reload, which the legacy in-memory filter
  // could not do.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (term === current) return;

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (term.trim()) next.set("q", term.trim());
      else next.delete("q");
      router.push(`/environments?${next.toString()}`);
    }, 250);

    return () => clearTimeout(timer);
  }, [term, params, router]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.matches("input, textarea, select, [contenteditable='true']");
      if (event.key !== "/" || typing || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      searchRef.current?.focus();
    }

    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, []);

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-transparent px-4 sm:px-6 lg:px-8">
      <label className="group relative min-w-0 flex-1 sm:max-w-xl">
        <span className="sr-only">Search environments, tickets, or people</span>
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint transition-colors group-focus-within:text-brand-fg">
          <Icon name="search" className="h-4 w-4" />
        </span>
        <input
          ref={searchRef}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search environments, tickets, people…"
          className="h-10 w-full rounded-full border border-line-2 bg-subtle pl-10 pr-10 text-[13px] text-ink transition-[border-color,box-shadow,background-color] placeholder:text-faint hover:border-line-2 focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-brand-500/15"
        />
        {term ? (
          <button
            type="button"
            onClick={() => setTerm("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-subtle-2 hover:text-ink"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden h-5 min-w-5 -translate-y-1/2 place-items-center rounded-md border border-line-2 bg-surface px-1 font-mono text-[11px] text-muted xl:grid">
            /
          </kbd>
        )}
      </label>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center lg:flex">
          <ConnectionDot />
        </div>
        {/* Outside the lg-only group on purpose: the freshness labels can go
            when the header is tight, but the ways to act on them should not.
            Both pills drop to their icon below lg for exactly that reason. */}
        <SyncButton jiraEnabled={jiraEnabled} lastSyncAt={lastSyncAt} />
        <HealthButton lastCheckedAt={healthCheckedAt} checkableCount={checkableRepoCount} />
        <NotificationCenter />
        <ThemeSwitcher />
      </div>
    </header>
  );
}
