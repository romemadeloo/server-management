"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { realtimeHeaders } from "@/lib/realtime/client";

type SyncState = "idle" | "syncing" | "retrying";

/**
 * Keeps the dashboard's Jira panel fresh while somebody is looking at it.
 *
 * The server still owns the cadence check. That matters when several people
 * have the dashboard open: every tab may ask, but Jira is only called after the
 * configured interval has elapsed.
 */
export function JiraAutoSync({ interval_minutes }: { interval_minutes: number }) {
    const router = useRouter();
    const syncing_ref = useRef(false);
    const [sync_state, setSyncState] = useState<SyncState>("idle");
    const interval_ms = Math.max(1, interval_minutes) * 60_000;

    const sync = useCallback(async () => {
        if (syncing_ref.current || document.visibilityState === "hidden") return;

        syncing_ref.current = true;
        setSyncState("syncing");

        const response = await fetch("/api/jira/auto-sync", {
            method: "POST",
            headers: realtimeHeaders(),
        }).catch(() => null);
        const result = (await response?.json().catch(() => null)) as
            | { ok?: boolean; reason?: string }
            | null;

        syncing_ref.current = false;

        if (!response?.ok || result?.reason === "error") {
            setSyncState("retrying");
            return;
        }

        setSyncState("idle");
        if (result?.ok) router.refresh();
    }, [router]);

    useEffect(() => {
        void sync();

        const timer = window.setInterval(() => void sync(), interval_ms);
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") void sync();
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [interval_ms, sync]);

    const label =
        sync_state === "syncing"
            ? "Syncing Jira…"
            : sync_state === "retrying"
              ? "Auto-sync retrying"
              : `Auto-sync every ${interval_minutes} min`;

    return (
        <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                sync_state === "retrying" ? "text-warn" : "text-faint"
            }`}
            role="status"
        >
            <Icon name="refresh" className={`h-3 w-3 ${sync_state === "syncing" ? "animate-spin" : ""}`} />
            {label}
        </span>
    );
}
