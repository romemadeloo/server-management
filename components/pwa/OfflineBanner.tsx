"use client";

import { useEffect, useState } from "react";
import { useRealtime } from "@/components/providers/PusherProvider";

const OFFLINE_DELAY_MS = 5_000;

export function OfflineBanner() {
    const { state, enabled } = useRealtime();
    const [network_offline, setNetworkOffline] = useState(false);
    const [connection_lost, setConnectionLost] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        function updateNetwork() {
            setNetworkOffline(!navigator.onLine);
        }
        updateNetwork();
        window.addEventListener("online", updateNetwork);
        window.addEventListener("offline", updateNetwork);
        return () => {
            window.removeEventListener("online", updateNetwork);
            window.removeEventListener("offline", updateNetwork);
        };
    }, []);

    useEffect(() => {
        if (!enabled || state === "connected") setConnectionLost(false);
        else if (state === "unavailable" || state === "failed") setConnectionLost(true);
        // Once lost, keep the warning through retrying/connecting until connected.
        // A routine initial connection or laptop wake should not flash a warning.
    }, [enabled, state]);

    const offline = network_offline || connection_lost;
    useEffect(() => {
        if (!offline) {
            setVisible(false);
            return;
        }
        const timer = window.setTimeout(() => setVisible(true), OFFLINE_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [offline]);

    if (!visible) return null;
    return (
        <div role="status" className="shrink-0 border-b border-line bg-warn-soft px-5 py-3 text-sm text-warn-strong">
            You&apos;re offline. The board may be out of date. Don&apos;t rely on it before deploying.
        </div>
    );
}
